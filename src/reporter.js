import fs from 'node:fs';
import path from 'node:path';
import { newTraceId, newSpanId } from './telemetry/ids.js';
import { createLogger } from './telemetry/logger.js';
import { buildOtlpTrace } from './telemetry/otlp.js';
import { buildMetricsRow } from './telemetry/metrics.js';

/**
 * Custom Playwright reporter.
 * Emits the full telemetry bundle sharing a single trace_id:
 * - telemetry/results.json (raw execution summary)
 * - telemetry/traces.json (OTLP standard trace payload)
 * - telemetry/metrics.json (aggregated metric row)
 * - telemetry/logs.jsonl (structured execution logs)
 */
export default class TelemetryReporter {
  constructor(options = {}) {
    this.outDir = options.outDir || 'telemetry';
    this.traceId = process.env.TRACE_ID || newTraceId();
    this.runId = process.env.RUN_ID || process.env.GITHUB_RUN_ID || String(Date.now());
    this.region = process.env.REGION || 'gha-us';
    this.checks = [];
    this.spans = [];
    this.pages = [];
    this.rootSpanId = newSpanId();
    this.logger = createLogger({
      traceId: this.traceId,
      runId: this.runId,
      region: this.region
    });
  }

  onBegin(config, suite) {
    this.startMs = Date.now();
    this.startedAt = new Date(this.startMs).toISOString();
    this.logger.info('Monitor run started', {
      total_tests: suite.allTests().length
    });
  }

  _checkId(test) {
    const ann = test.annotations?.find(a => a.type === 'check');
    return ann?.description || test.title;
  }

  onTestEnd(test, result) {
    const spanId = newSpanId();
    const status = result.status;
    let normalized;
    if (status === 'passed') {
      normalized = result.retry > 0 ? 'flaky' : 'passed';
    } else if (status === 'skipped') {
      normalized = 'skipped';
    } else {
      normalized = 'failed';
    }

    const startMs = result.startTime ? new Date(result.startTime).getTime() : Date.now();
    const endMs = startMs + (result.duration || 0);

    const screenshot = result.attachments?.find(a => a.name === 'screenshot')?.path;
    const error = result.error ? (result.error.message || String(result.error)).split('\n')[0] : undefined;

    const id = this._checkId(test);

    const project = test.parent?.project()?.name || 'unknown';
    this.checks.push({
      id,
      status: normalized,
      project,
      attempts: result.retry + 1,
      durationMs: result.duration || 0,
      error,
      screenshot,
      spanId
    });

    this.spans.push({
      spanId,
      parentSpanId: this.rootSpanId,
      name: id,
      startMs,
      endMs,
      status: normalized === 'failed' ? 'error' : 'ok',
      attributes: {
        'check.id': id,
        'check.status': normalized,
        'check.attempts': result.retry + 1,
        'project': test.parent?.project()?.name || 'unknown'
      }
    });

    if (normalized === 'failed') {
      this.logger.error(`Check failed: ${id}`, {
        check_id: id,
        status: normalized,
        duration_ms: result.duration,
        error
      });
    } else if (normalized === 'flaky') {
      this.logger.warn(`Check flaky: ${id}`, {
        check_id: id,
        status: normalized,
        duration_ms: result.duration
      });
    } else {
      this.logger.info(`Check passed: ${id}`, {
        check_id: id,
        status: normalized,
        duration_ms: result.duration
      });
    }
  }

  onEnd(result) {
    const endMs = Date.now();
    const durationMs = endMs - this.startMs;

    this.spans.unshift({
      spanId: this.rootSpanId,
      parentSpanId: null,
      name: 'monitor.run',
      startMs: this.startMs,
      endMs,
      status: this.checks.some(c => c.status === 'failed') ? 'error' : 'ok',
      attributes: {
        'run.status': result.status,
        'run.checks': this.checks.length
      }
    });

    this.logger.info('Monitor run completed', {
      duration_ms: durationMs,
      status: result.status,
      checks_total: this.checks.length,
      checks_passed: this.checks.filter(c => c.status === 'passed').length,
      checks_failed: this.checks.filter(c => c.status === 'failed').length
    });

    const resultsPayload = {
      traceId: this.traceId,
      runId: this.runId,
      region: this.region,
      startedAt: this.startedAt,
      durationMs,
      checks: this.checks,
      spans: this.spans,
      pages: this.pages
    };

    const otlpTrace = buildOtlpTrace({
      traceId: this.traceId,
      runId: this.runId,
      region: this.region,
      spans: this.spans
    });

    const metricsRow = buildMetricsRow({
      traceId: this.traceId,
      runId: this.runId,
      region: this.region,
      startedAt: this.startedAt,
      durationMs,
      checks: this.checks,
      pages: this.pages
    });

    fs.mkdirSync(this.outDir, { recursive: true });
    fs.writeFileSync(path.join(this.outDir, 'results.json'), JSON.stringify(resultsPayload, null, 2));
    fs.writeFileSync(path.join(this.outDir, 'traces.json'), JSON.stringify(otlpTrace, null, 2));
    fs.writeFileSync(path.join(this.outDir, 'metrics.json'), JSON.stringify(metricsRow, null, 2));
    fs.writeFileSync(path.join(this.outDir, 'logs.jsonl'), this.logger.toJsonl());
  }
}
