const REMINDER_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Applies a new run's checks against the stored incident state.
 * Returns the new state object and any generated alert events.
 *
 * @param {Object} state - The previous state `{ incidents: { [checkId]: Incident } }`
 * @param {Array} checks - Array of CheckResult objects from the reporter
 * @param {Object} context - `{ nowMs, traceId }`
 * @returns { state: Object, events: Array }
 */
export function applyRun(state = {}, checks = [], { nowMs = Date.now(), traceId } = {}) {
  const incidents = state.incidents ? { ...state.incidents } : {};
  const events = [];

  for (const check of checks) {
    const existing = incidents[check.id];

    if (check.status === 'failed') {
      if (!existing) {
        // New incident opened
        events.push({
          type: 'opened',
          check: check.id,
          sinceMs: nowMs,
          durationMs: 0,
          error: check.error,
          firstTraceId: traceId,
          screenshot: check.screenshot
        });

        incidents[check.id] = {
          sinceMs: nowMs,
          lastAlertMs: nowMs,
          firstTraceId: traceId,
          error: check.error,
          screenshot: check.screenshot
        };
      } else {
        // Incident continues; check for reminder cooldown
        const timeSinceLastAlert = nowMs - existing.lastAlertMs;
        const durationMs = nowMs - existing.sinceMs;

        if (timeSinceLastAlert >= REMINDER_COOLDOWN_MS) {
          events.push({
            type: 'reminder',
            check: check.id,
            sinceMs: existing.sinceMs,
            durationMs,
            error: check.error || existing.error,
            firstTraceId: existing.firstTraceId,
            screenshot: check.screenshot || existing.screenshot
          });
          existing.lastAlertMs = nowMs;
        }

        // Persist latest context on the incident
        existing.error = check.error || existing.error;
        existing.screenshot = check.screenshot || existing.screenshot;
      }
    } else if (check.status === 'passed' || check.status === 'flaky') {
      if (existing) {
        // Incident recovered
        events.push({
          type: 'recovered',
          check: check.id,
          sinceMs: existing.sinceMs,
          durationMs: nowMs - existing.sinceMs,
          firstTraceId: existing.firstTraceId
        });

        delete incidents[check.id];
      }
    }
    // 'skipped' status checks intentionally omit state mutations.
    // If they were failing, they stay failing but don't emit recovery.
  }

  return {
    state: { incidents },
    events
  };
}
