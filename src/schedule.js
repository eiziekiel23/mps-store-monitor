/**
 * Daily-report schedule guard for the giveaway rotation notification.
 *
 * WHY THIS EXISTS
 * ---------------
 * GitHub Actions `cron:` runs in UTC only — there is no timezone or DST
 * support in the cron field itself. Expressing "fire at 03:00
 * America/Chicago, auto-adjusting for daylight saving" requires the job to
 * ask the runtime what local time it is in that timezone.
 *
 * Node 20's Intl.DateTimeFormat reads the OS IANA timezone database (kept
 * current on ubuntu-latest), so DST transitions (2nd Sunday in March, 1st
 * Sunday in November) resolve correctly without any manual UTC-offset
 * arithmetic.
 *
 * WHY DATE-STAMP INSTEAD OF HOUR === 3
 * -------------------------------------
 * GitHub's scheduled triggers can be delayed by up to ~15 minutes under
 * load, or the 03:00 UTC-equivalent slot can be missed entirely (documented
 * GitHub behavior). A strict `hour === 3` guard would silently lose the
 * daily report whenever that happens. A date-stamp ("have we sent today's
 * Central-date report yet?") is idempotent: a 03:15 run, or a missed-3 AM
 * recovered at 04:00, both fire exactly once per calendar day.
 *
 * INVARIANT: manual runs (workflow_dispatch, local) always bypass the guard
 * so operators can trigger full digests on demand.
 */

/** America/Chicago hour at-or-after which the daily giveaway report may fire. */
export const DAILY_REPORT_HOUR = 3;

/**
 * Return the current date and hour in America/Chicago.
 *
 * DST-aware: during CDT (UTC−5) 08:00 UTC → 03:00 local; during CST (UTC−6)
 * 09:00 UTC → 03:00 local. Intl resolves the offset from the IANA database.
 *
 * @param {Date} [now] - injectable for unit tests
 * @returns {{ date: string, hour: number }} YYYY-MM-DD in Central and 0-23 hour
 */
export function getCentralTime(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now)
       .filter(({ type }) => type !== 'literal')
       .map(({ type, value }) => [type, value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
  };
}

/**
 * Decide whether the daily giveaway rotation report should dispatch now.
 *
 * Returns true when:
 *   - `isManualRun` is true (always fire on demand), OR
 *   - the current hour in America/Chicago is ≥ DAILY_REPORT_HOUR AND
 *     `stamp` does not already match today's Central date (one send per day).
 *
 * This function is pure (no I/O). The caller is responsible for reading
 * the stamp from disk and writing it back after a successful dispatch.
 *
 * @param {{ isManualRun: boolean, stamp: string, now?: Date }} opts
 * @param {boolean}  opts.isManualRun - true for workflow_dispatch / local runs
 * @param {string}   opts.stamp       - last-sent date as YYYY-MM-DD Central, or ''
 * @param {Date}    [opts.now]        - injectable for unit tests
 * @returns {boolean}
 */
export function shouldSendDailyGiveawayReport({ isManualRun, stamp, now }) {
  if (isManualRun) return true;
  const { date, hour } = getCentralTime(now);
  if (hour < DAILY_REPORT_HOUR) return false;
  return stamp !== date;
}
