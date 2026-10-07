import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { newTraceId, newSpanId } from '../../src/telemetry/ids.js';
import { createLogger } from '../../src/telemetry/logger.js';
import { buildOtlpTrace } from '../../src/telemetry/otlp.js';
import { buildMetricsRow } from '../../src/telemetry/metrics.js';

describe('telemetry/ids', () => {
  test('newTraceId returns 32 lowercase hex chars', () => {
    const id = newTraceId();
    assert.match(id, /^[0-9a-f]{32}$/);
  });

  test('newSpanId returns 16 lowercase hex chars', () => {
    const id = newSpanId();
    assert.match(id, /^[0-9a-f]{16}$/);
  });

  test('ids are unique across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newTraceId()));
    assert.equal(ids.size, 200);
  });
});

describe('telemetry/logger', () => {
  const ctx = { traceId: 'a'.repeat(32), runId: 'run-1', region: 'gha-us' };

  test('every entry carries trace_id, run_id and region', () => {
    const logger = createLogger(ctx);
    logger.info('hello');
    logger.warn('careful', { check: 'home.sections' });
    const entries = logger.entries();

    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.trace_id, ctx.traceId);
      assert.equal(e.run_id, ctx.runId);
      assert.equal(e.region, ctx.region);
      assert.ok(e.timestamp);
    }
    assert.equal(entries[1].check, 'home.sections');
  });

  test('levels are normalized to lowercase', () => {
    const logger = createLogger(ctx);
    logger.log('ERROR', 'boom');
    assert.equal(logger.entries()[0].level, 'error');
  });

  test('toJsonl emits one parseable JSON object per line', () => {
    const logger = createLogger(ctx);
    logger.info('one');
    logger.info('two');
    logger.error('three');

    const lines = logger.toJsonl().split('\n');
    assert.equal(lines.length, 3);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
    assert.equal(JSON.parse(lines[2]).message, 'three');
  });

  test('entries() returns a copy, not the internal array', () => {
    const logger = createLogger(ctx);
    logger.info('one');
    logger.entries().push({ bogus: true });
    assert.equal(logger.entries().length, 1);
  });
});

describe('telemetry/otlp', () => {
  const traceId = 'b'.repeat(32);
  const spans = [
    {
      spanId: '1'.repeat(16),
      parentSpanId: null,
      name: 'monitor.run',
      startMs: 1_700_000_000_000,
      endMs: 1_700_000_001_500,
      status: 'ok',
      attributes: { 'run.checks': 3 }
    },
    {
      spanId: '2'.repeat(16),
      parentSpanId: '1'.repeat(16),
      name: 'home.sections',
      startMs: 1_700_000_000_100,
      endMs: 1_700_000_000_900,
      status: 'error',
      attributes: { 'check.id': 'home.sections', 'check.ok': false, 'check.ratio': 0.5 }
    }
  ];

  test('produces the ExportTraceServiceRequest nesting', () => {
    const otlp = buildOtlpTrace({ traceId, runId: 'run-1', spans });
    assert.ok(Array.isArray(otlp.resourceSpans));
    assert.equal(otlp.resourceSpans.length, 1);
    assert.equal(otlp.resourceSpans[0].scopeSpans.length, 1);
    assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans.length, 2);
  });

  test('every span carries the shared traceId', () => {
    const otlp = buildOtlpTrace({ traceId, runId: 'run-1', spans });
    for (const s of otlp.resourceSpans[0].scopeSpans[0].spans) {
      assert.equal(s.traceId, traceId);
    }
  });

  test('timestamps are nanosecond STRINGS (precision would be lost as Number)', () => {
    const [root] = buildOtlpTrace({ traceId, runId: 'run-1', spans }).resourceSpans[0].scopeSpans[0].spans;
    assert.equal(typeof root.startTimeUnixNano, 'string');
    assert.equal(root.startTimeUnixNano, '1700000000000000000');
    assert.equal(root.endTimeUnixNano, '1700000001500000000');
  });

  test('status maps ok->1 and error->2', () => {
    const out = buildOtlpTrace({ traceId, runId: 'run-1', spans }).resourceSpans[0].scopeSpans[0].spans;
    assert.equal(out[0].status.code, 1);
    assert.equal(out[1].status.code, 2);
  });

  test('attribute values are typed by JS type', () => {
    const out = buildOtlpTrace({ traceId, runId: 'run-1', spans }).resourceSpans[0].scopeSpans[0].spans;
    const attrs = Object.fromEntries(out[1].attributes.map(a => [a.key, a.value]));
    assert.deepEqual(attrs['check.id'], { stringValue: 'home.sections' });
    assert.deepEqual(attrs['check.ok'], { boolValue: false });
    assert.deepEqual(attrs['check.ratio'], { doubleValue: 0.5 });
    assert.deepEqual(attrs['region'], { stringValue: 'gha-us' });
  });

  test('root span omits parentSpanId', () => {
    const out = buildOtlpTrace({ traceId, runId: 'run-1', spans }).resourceSpans[0].scopeSpans[0].spans;
    assert.equal(out[0].parentSpanId, undefined);
    assert.equal(out[1].parentSpanId, '1'.repeat(16));
  });

  test('whole payload is JSON-serializable (no BigInt leaks)', () => {
    const otlp = buildOtlpTrace({ traceId, runId: 'run-1', spans });
    assert.doesNotThrow(() => JSON.stringify(otlp));
  });
});

describe('telemetry/metrics', () => {
  const checks = [
    { id: 'store.reachable', status: 'passed', attempts: 1, durationMs: 120, spanId: 'a'.repeat(16) },
    { id: 'home.sections', status: 'failed', attempts: 2, durationMs: 4300, error: 'missing footer', screenshot: '/tmp/s.png', spanId: 'b'.repeat(16) },
    { id: 'nav.rules', status: 'flaky', attempts: 2, durationMs: 900, spanId: 'c'.repeat(16) },
    { id: 'video.how_to_enter', status: 'skipped', attempts: 1, durationMs: 0, spanId: 'd'.repeat(16) }
  ];
  const pages = [{ page: '/', ttfbMs: 210, lcpMs: 1800, cls: 0.001 }];
  const base = { traceId: 'c'.repeat(32), runId: 'run-9', startedAt: '2026-10-07T01:00:00.000Z', durationMs: 5320 };

  test('summary counts each status', () => {
    const row = buildMetricsRow({ ...base, checks, pages });
    assert.deepEqual(row.summary, {
      total: 4, passed: 1, failed: 1, flaky: 1, skipped: 1, success: false
    });
  });

  test('success is true only when nothing failed (flaky does not fail the run)', () => {
    const ok = buildMetricsRow({ ...base, checks: checks.filter(c => c.status !== 'failed') });
    assert.equal(ok.summary.success, true);
  });

  test('correlation fields are carried through', () => {
    const row = buildMetricsRow({ ...base, checks, pages });
    assert.equal(row.trace_id, base.traceId);
    assert.equal(row.run_id, base.runId);
    assert.equal(row.region, 'gha-us');
    assert.equal(row.timestamp, base.startedAt);
    assert.equal(row.duration_ms, 5320);
  });

  test('checks are flattened to snake_case with null fallbacks', () => {
    const row = buildMetricsRow({ ...base, checks, pages });
    assert.deepEqual(row.checks[0], {
      id: 'store.reachable', status: 'passed', attempts: 1,
      duration_ms: 120, error: null, screenshot: null
    });
    assert.equal(row.checks[1].error, 'missing footer');
    assert.equal(row.checks[1].screenshot, '/tmp/s.png');
  });

  test('page timings keep null for unmeasured LCP/CLS', () => {
    const row = buildMetricsRow({ ...base, checks, pages: [{ page: '/cart', ttfbMs: 90 }] });
    assert.deepEqual(row.pages[0], { page: '/cart', ttfb_ms: 90, lcp_ms: null, cls: null });
  });

  test('empty run produces a valid zeroed row', () => {
    const row = buildMetricsRow({ ...base, checks: [], pages: [] });
    assert.equal(row.summary.total, 0);
    assert.equal(row.summary.success, true);
    assert.deepEqual(row.checks, []);
  });
});
