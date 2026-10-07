/**
 * Aggregates check results and page timings into a single metrics row.
 */
export function buildMetricsRow({ traceId, runId, region = 'gha-us', startedAt, durationMs, checks = [], pages = [] }) {
  const passed = checks.filter(c => c.status === 'passed').length;
  const failed = checks.filter(c => c.status === 'failed').length;
  const flaky = checks.filter(c => c.status === 'flaky').length;
  const skipped = checks.filter(c => c.status === 'skipped').length;

  return {
    timestamp: startedAt || new Date().toISOString(),
    trace_id: traceId,
    run_id: runId,
    region,
    duration_ms: durationMs,
    summary: {
      total: checks.length,
      passed,
      failed,
      flaky,
      skipped,
      success: failed === 0
    },
    checks: checks.map(c => ({
      id: c.id,
      status: c.status,
      attempts: c.attempts,
      duration_ms: c.durationMs,
      error: c.error || null,
      screenshot: c.screenshot || null
    })),
    pages: pages.map(p => ({
      page: p.page,
      ttfb_ms: p.ttfbMs,
      lcp_ms: p.lcpMs ?? null,
      cls: p.cls ?? null
    }))
  };
}
