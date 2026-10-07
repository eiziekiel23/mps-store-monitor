import { parseGiveawayDate } from '../snapshot.js';

/**
 * Flash-giveaway changelog + daily-rotation freshness.
 *
 * The store rotates the `giveaway` metaobject's fields once a day (around
 * 02:00 America/Chicago). This module:
 *
 *   1. Diffs the current metaobject fields against the previously persisted
 *      snapshot and records every old -> new change (the changelog).
 *   2. Decides whether today's rotation actually happened, so the monitor can
 *      alert when the fields go stale.
 *
 * Everything here is pure: callers supply the previous state and the current
 * snapshot, and get back the next state plus the derived findings. File I/O
 * and alerting live in ./check.js.
 */

export const DEFAULT_TIME_ZONE = 'America/Chicago';

/** Hour (in TIME_ZONE) the fields are normally rotated. */
export const DEFAULT_ANCHOR_HOUR = 2;

/** Grace period after the anchor before a missing rotation is an anomaly. */
export const DEFAULT_GRACE_MS = 60 * 60 * 1000; // 1h -> due by ~03:00 Chicago

/**
 * Fields whose change means "today's giveaway actually rotated".
 * The changelog records every field; only these drive the freshness verdict,
 * so an image CDN URL churning does not mask a missed rotation.
 */
export const DEFAULT_ROTATION_FIELDS = [
  'flash_giveaway_start_date',
  'flash_giveaway_end_date'
];

/** Keep the persisted log bounded so the committed JSON stays reviewable. */
export const DEFAULT_MAX_ENTRIES = 180;

/** Long values (image URLs) are truncated for display only. */
const DISPLAY_MAX = 80;

/**
 * Truncate a value for human-facing output. The persisted JSON keeps the
 * full value; only rendered Markdown/Telegram text is shortened.
 */
export function truncate(value, max = DISPLAY_MAX) {
  const s = value == null ? '' : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Diff two flat field maps.
 * @returns {Array<{field:string, old:string|null, new:string|null}>} sorted by field name
 */
export function diffFields(prev = {}, curr = {}, { ignoreFields = [] } = {}) {
  const ignore = new Set(ignoreFields);
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  const changes = [];

  for (const field of [...keys].sort()) {
    if (ignore.has(field)) continue;
    const before = prev[field] ?? null;
    const after = curr[field] ?? null;
    // Compare as strings: the Storefront API returns every field value as text.
    if (String(before) !== String(after)) {
      changes.push({ field, old: before, new: after });
    }
  }

  return changes;
}

/**
 * The UTC instant of `anchorHour:00:00` on *today's* date in `timeZone`.
 * Reuses parseGiveawayDate so the DST handling is the same code path the
 * timer check already relies on.
 */
export function todayAnchorMs(nowMs, timeZone = DEFAULT_TIME_ZONE, anchorHour = DEFAULT_ANCHOR_HOUR) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(new Date(nowMs))
      .map((p) => [p.type, p.value])
  );
  const hh = String(anchorHour).padStart(2, '0');
  return parseGiveawayDate(`${parts.year}-${parts.month}-${parts.day}T${hh}:00:00`, timeZone);
}

/**
 * Decide whether the giveaway fields are stale.
 *
 * Anomalies (either one fails the check):
 *   - the active giveaway's end date has already passed;
 *   - we are past today's rotation deadline (anchor + grace) and no rotation
 *     field has changed since today's anchor.
 *
 * @returns {{stale:boolean, reason:string|null}}
 */
export function evaluateStaleness({
  lastRotationMs,
  nowMs = Date.now(),
  timeZone = DEFAULT_TIME_ZONE,
  anchorHour = DEFAULT_ANCHOR_HOUR,
  graceMs = DEFAULT_GRACE_MS,
  endDateMs = null
} = {}) {
  // An expired giveaway is an anomaly at any hour — the storefront is showing
  // a countdown that has already run out.
  if (endDateMs != null && nowMs > endDateMs) {
    const hours = ((nowMs - endDateMs) / 3600000).toFixed(1);
    return {
      stale: true,
      reason: `flash giveaway end date passed ${hours}h ago (${new Date(endDateMs).toISOString()})`
    };
  }

  const anchorMs = todayAnchorMs(nowMs, timeZone, anchorHour);
  const dueMs = anchorMs + graceMs;

  // Before today's deadline nothing is owed yet.
  if (nowMs < dueMs) return { stale: false, reason: null };

  if (lastRotationMs == null) {
    return { stale: true, reason: 'no giveaway rotation has ever been recorded' };
  }

  if (lastRotationMs < anchorMs) {
    const hours = ((nowMs - lastRotationMs) / 3600000).toFixed(1);
    const anchorLabel = `${String(anchorHour).padStart(2, '0')}:00 ${timeZone}`;
    return {
      stale: true,
      reason: `no giveaway field rotation in ${hours}h; expected a daily update at ${anchorLabel}`
    };
  }

  return { stale: false, reason: null };
}

/**
 * Fold the current snapshot into the persisted changelog state.
 *
 * @param {Object|null} prevState previously persisted state (null on first run)
 * @param {Object} giveaway flat field map from fetchSnapshot().giveaway
 * @param {Object} opts
 * @returns {{nextState:Object, changes:Array, staleness:Object, isFirstRun:boolean}}
 */
export function applyChangelog(prevState, giveaway = {}, {
  nowMs = Date.now(),
  timeZone = DEFAULT_TIME_ZONE,
  anchorHour = DEFAULT_ANCHOR_HOUR,
  graceMs = DEFAULT_GRACE_MS,
  rotationFields = DEFAULT_ROTATION_FIELDS,
  ignoreFields = [],
  maxEntries = DEFAULT_MAX_ENTRIES
} = {}) {
  const prevFields = prevState?.fields ?? null;
  const isFirstRun = prevFields === null;

  const changes = isFirstRun ? [] : diffFields(prevFields, giveaway, { ignoreFields });

  // Only a change to a rotation field counts as "today's giveaway rotated".
  const rotation = new Set(rotationFields);
  const rotated = changes.some((c) => rotation.has(c.field));

  // The first run has nothing to compare against, so it seeds the baseline
  // rather than reporting a missed rotation we were never present for.
  let lastRotationMs;
  if (isFirstRun) {
    lastRotationMs = nowMs;
  } else if (rotated) {
    lastRotationMs = nowMs;
  } else {
    lastRotationMs = prevState?.lastRotationMs ?? null;
  }

  const endDateMs = parseGiveawayDate(giveaway.flash_giveaway_end_date);
  const staleness = evaluateStaleness({
    lastRotationMs,
    nowMs,
    timeZone,
    anchorHour,
    graceMs,
    endDateMs
  });

  // Newest entry first so the committed file reads top-down.
  const entries = [...(prevState?.entries ?? [])];
  if (changes.length > 0) {
    entries.unshift({
      at: new Date(nowMs).toISOString(),
      rotated,
      changes
    });
  }

  return {
    nextState: {
      fields: { ...giveaway },
      lastRotationMs,
      updatedAt: new Date(nowMs).toISOString(),
      entries: entries.slice(0, maxEntries)
    },
    changes,
    staleness,
    isFirstRun
  };
}

/**
 * Render the persisted entries as a human-readable Markdown changelog.
 */
export function renderMarkdown(entries = [], { limit = 60 } = {}) {
  const lines = [
    '# Flash Giveaway Changelog',
    '',
    '> Auto-generated by the MPS Store Monitor. Each entry lists the `giveaway`',
    '> metaobject fields that changed between two monitor runs.',
    ''
  ];

  if (entries.length === 0) {
    lines.push('_No changes recorded yet._', '');
    return lines.join('\n');
  }

  for (const entry of entries.slice(0, limit)) {
    lines.push(`## ${entry.at}${entry.rotated ? ' — daily rotation' : ''}`, '');
    lines.push('| Field | Old | New |');
    lines.push('| --- | --- | --- |');
    for (const c of entry.changes) {
      lines.push(`| \`${c.field}\` | \`${truncate(c.old) || '—'}\` | \`${truncate(c.new) || '—'}\` |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render the current run's changes as a Telegram Markdown block for the digest.
 * Returns null when nothing changed, so callers can omit the section entirely.
 */
export function formatChangesForTelegram(changes = []) {
  if (!changes.length) return null;

  const lines = ['\n🎁 *GIVEAWAY CHANGES*'];
  for (const c of changes) {
    lines.push(`• \`${c.field}\``);
    lines.push(`  _${truncate(c.old, 48) || '—'}_ → _${truncate(c.new, 48) || '—'}_`);
  }
  return lines.join('\n');
}
