/**
 * Check aggregation across Playwright projects.
 *
 * A single logical check (e.g. "timer.correct") runs against every configured
 * Playwright project (desktop-chrome, mobile), producing one result row each.
 * This module collapses them into a single canonical result per check ID:
 *
 *   - Status:  worst-wins  failed > flaky > passed > skipped
 *   - Duration: max across projects (longest run is the user-visible latency)
 *   - Attempts: max across projects
 *   - Error:    taken from the worst-status row
 *   - platformNote: set only when projects disagree on status (e.g. "mobile:
 *     skipped, desktop-chrome: passed") so callers can surface the divergence
 *
 * Order of results follows the first occurrence of each check ID in the input
 * (i.e. the order the Playwright reporter processed tests).
 */

const STATUS_ORDER = { failed: 0, flaky: 1, passed: 2, skipped: 3 };

/**
 * Aggregate raw per-project check results into one logical check per ID.
 * @param {Array<{id:string, status:string, project:string, durationMs?:number, attempts?:number, error?:string, screenshot?:string, spanId?:string}>} checks
 * @returns {Array<{id:string, status:string, durationMs:number, attempts:number, error?:string, screenshot?:string, spanId?:string, platformNote?:string}>}
 */
export function aggregateChecks(checks) {
  const byId = new Map();

  for (const c of checks) {
    if (!byId.has(c.id)) byId.set(c.id, []);
    byId.get(c.id).push(c);
  }

  const result = [];
  for (const [id, rows] of byId) {
    // Pick the row with the worst (lowest ORDER index) status
    const worst = rows.reduce((best, c) =>
      (STATUS_ORDER[c.status] ?? 99) < (STATUS_ORDER[best.status] ?? 99) ? c : best
    );

    // Platform note only when projects genuinely disagree on status
    const statuses = [...new Set(rows.map(r => r.status))];
    const platformNote = statuses.length > 1
      ? rows.map(r => `${r.project}: ${r.status}`).join(', ')
      : undefined;

    result.push({
      id,
      status: worst.status,
      durationMs: Math.max(...rows.map(r => r.durationMs || 0)),
      attempts: Math.max(...rows.map(r => r.attempts || 1)),
      error: worst.error,
      screenshot: worst.screenshot,
      spanId: worst.spanId,
      platformNote
    });
  }

  return result;
}
