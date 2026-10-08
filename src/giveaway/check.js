/**
 * Giveaway daily-rotation check — CI runner.
 *
 * Fetches the live flash-giveaway metaobject fields, diffs them against the
 * previously persisted snapshot, and determines whether today's rotation has
 * happened. Outputs:
 *
 *   state/giveaway-snapshot.json  — persisted changelog state (committed back to git)
 *   CHANGELOG-giveaways.md        — human-readable field-change history (committed back)
 *   telemetry/giveaway-result.json — single-check record for report.js to merge
 *
 * Usage:
 *   node src/giveaway/check.js [--dry-run]
 *
 * Env:
 *   SHOPIFY_STOREFRONT_TOKEN — required for the Storefront API call
 */

import fs from 'node:fs';
import path from 'node:path';
import config from '../../config/monitor.config.js';
import { fetchSnapshot } from '../snapshot.js';
import {
  applyChangelog,
  renderMarkdown
} from './changelog.js';

// Must match the ID in src/alerting/labels.js (CHECK_LABELS + the "Giveaway"
// group) exactly, or this check falls into the "Other" catch-all on the status
// board. README.md and the unit tests reference this same string.
const CHECK_ID = 'giveaway.freshness';
const STATE_PATH = path.resolve('state/giveaway-snapshot.json');
const CHANGELOG_PATH = path.resolve('CHANGELOG-giveaways.md');
const RESULT_PATH = path.resolve('telemetry/giveaway-result.json');
// Written alongside the check result so report.js can include old→new pairs in
// the Telegram digest without needing access to the state machine's internals.
const CHANGES_PATH = path.resolve('telemetry/giveaway-changes.json');

const dryRun = process.argv.includes('--dry-run');
const storefrontToken = process.env.SHOPIFY_STOREFRONT_TOKEN;

// ── helpers ──────────────────────────────────────────────────────────────────

function loadState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`[giveaway/check] Failed to parse ${filePath}, starting fresh:`, err.message);
    return null;
  }
}

function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── main ─────────────────────────────────────────────────────────────────────

const nowMs = Date.now();

console.log(`[giveaway/check] Starting check at ${new Date(nowMs).toISOString()}${dryRun ? ' (DRY-RUN)' : ''}`);

let giveaway;
try {
  const snapshot = await fetchSnapshot({
    storeUrl: config.storeUrl,
    storefrontToken
  });
  giveaway = snapshot.giveaway;
  const fieldKeys = Object.keys(giveaway);
  console.log(`[giveaway/check] Snapshot fetched: ${fieldKeys.length} field(s) on active giveaway`);
  // Log the actual field keys so we can confirm config.giveaway.rotationFields
  // matches the live metaobject schema (keys were inferred from display names).
  console.log(`[giveaway/check] Live field keys: ${fieldKeys.join(', ') || '(none)'}`);
  const rotationKeys = config.giveaway.rotationFields || [];
  const missing = rotationKeys.filter(k => !fieldKeys.includes(k));
  if (fieldKeys.length > 0 && missing.length === rotationKeys.length) {
    console.warn(`[giveaway/check] WARNING: none of the configured rotationFields [${rotationKeys.join(', ')}] exist on the live giveaway — rotation detection will never fire. Update config.giveaway.rotationFields to the live keys above.`);
  } else if (missing.length > 0) {
    console.warn(`[giveaway/check] NOTE: configured rotationFields not present on live giveaway: ${missing.join(', ')}`);
  }
} catch (err) {
  console.error('[giveaway/check] Snapshot fetch failed:', err.message);
  // Emit a failed check so the incident state machine can open an alert.
  if (!dryRun) {
    fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
    fs.writeFileSync(RESULT_PATH, JSON.stringify({
      id: CHECK_ID,
      status: 'failed',
      durationMs: Date.now() - nowMs,
      attempts: 1,
      error: `Snapshot unavailable: ${err.message}`
    }, null, 2));
  }
  process.exit(0); // exit 0 so the workflow step doesn't block other steps
}

const prevState = loadState(STATE_PATH);
const gc = config.giveaway;

const { nextState, changes, staleness, isFirstRun } = applyChangelog(prevState, giveaway, {
  nowMs,
  timeZone: gc.timeZone,
  anchorHour: gc.anchorHour,
  graceMs: gc.graceMs,
  rotationFields: gc.rotationFields,
  ignoreFields: gc.ignoreFields,
  maxEntries: gc.maxEntries
});

// Summarise what happened.
if (isFirstRun) {
  console.log('[giveaway/check] First run: seeding baseline snapshot, no changes to report.');
} else if (changes.length > 0) {
  const rotated = changes.some(c => (gc.rotationFields || []).includes(c.field));
  console.log(`[giveaway/check] ${changes.length} field change(s) detected${rotated ? ' (daily rotation)' : ''}.`);
  for (const c of changes) {
    console.log(`  ${c.field}: ${JSON.stringify(c.old)} → ${JSON.stringify(c.new)}`);
  }
} else {
  console.log('[giveaway/check] No field changes since last run.');
}

if (staleness.stale) {
  console.warn(`[giveaway/check] STALE: ${staleness.reason}`);
} else {
  console.log('[giveaway/check] Freshness: OK');
}

// ── persist outputs ───────────────────────────────────────────────────────────

if (!dryRun) {
  writeAtomic(STATE_PATH, JSON.stringify(nextState, null, 2));
  console.log(`[giveaway/check] Wrote ${STATE_PATH}`);

  writeAtomic(CHANGELOG_PATH, renderMarkdown(nextState.entries));
  console.log(`[giveaway/check] Wrote ${CHANGELOG_PATH}`);

  const checkRecord = {
    id: CHECK_ID,
    status: staleness.stale ? 'failed' : 'passed',
    durationMs: Date.now() - nowMs,
    attempts: 1,
    ...(staleness.stale ? { error: staleness.reason } : {})
  };

  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  fs.writeFileSync(RESULT_PATH, JSON.stringify(checkRecord, null, 2));
  console.log(`[giveaway/check] Wrote ${RESULT_PATH} — status: ${checkRecord.status}`);

  // Separate file so report.js can render old→new pairs in the Telegram digest.
  // isFirstRun is flagged so the digest omits the "no baseline yet" non-change.
  fs.writeFileSync(CHANGES_PATH, JSON.stringify({ isFirstRun, changes }, null, 2));
} else {
  console.log('[giveaway/check] DRY-RUN: state/changelog/result not written.');
}
