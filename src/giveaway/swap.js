/**
 * Daily giveaway value swap: promotes the operator-staged "upcoming_flash_giveaway"
 * fields into the live "giveaway" entry. The staging entry is left intact.
 *
 * Fires once per day at/after 01:55 America/Chicago, auto-adjusting for DST
 * (changed from 02:00 on 2026-10-13; gate is enforced in src/schedule.js).
 * Idempotent: every invocation at/after 01:55 applies the same date-stamped gate;
 * the first run to find an open gate swaps, any later run that day logs and skips.
 * The gate stays open all day (gate is "date did not yet match today's swap" not
 * "hour is exactly 01:55"), so a re-run later in the day still self-heals a missed
 * morning swap.
 *
 * SOLE CALLER (changed 2026-10-13)
 * ────────────────────────────────
 * .github/workflows/giveaway-swap.yml is the only workflow that runs this, once
 * daily at 01:55 Chicago via cron-job.org. monitor.yml previously ran it as a
 * self-healing fallback on every tick; that step was removed at operator request
 * (see STATE.md). Consequence: the all-day gate still self-heals, but only a
 * manual/extra dispatch of giveaway-swap.yml can act on it.
 *
 * WHY SEPARATE METAOBJECTS (UPCOMING vs. LIVE)
 * ───────────────────────────────────────────
 * The theme selects giveaway entries by date window (today within start/end dates),
 * with a last-entry-wins fallback. Pre-creating the next day's giveaway as a
 * separate entry would leak it early if any selection logic found it before its
 * start time. By staging in a *separate* type and swapping on schedule, the live
 * entry is atomic: it either is yesterday's giveaway or today's, never both.
 *
 * STAGING IS A PERSISTENT TEMPLATE (changed 2026-10-13)
 * ─────────────────────────────────────────────────────
 * The operator populates the upcoming_flash_giveaway entry before 01:55 Chicago
 * on the day the giveaway should change. The swap promotes ALL non-empty fields
 * from upcoming into live (a sparse/partial write — admin.js:updateMetaobjectFields,
 * using MetaobjectUpdateInput.fields) and then STOPS. The staging entry keeps its
 * values.
 *
 * Earlier versions wiped staging after each promote (a full replacement with
 * MetaobjectUpdateInput.values: {}) so that a forgotten manual update could not
 * re-promote stale values. That was reversed by operator request: an empty admin
 * form every morning is worse ergonomics than a pre-filled one. The retained values
 * act as an editable template — the operator opens the same entry, tweaks what
 * changed, and leaves the rest.
 *
 * What retention actually costs: the daily stamp gate still allows exactly one swap
 * per Central day, so the retained values are re-promoted each morning. After the
 * first promote the live entry already holds them, making every later promote an
 * idempotent no-op in terms of visible store data. The REAL consequence is that
 * nothing self-advances: flash_giveaway_end_date will keep being re-promoted at its
 * staged value, so if the operator does not edit staging the countdown freezes on a
 * past date rather than rotating. Daily staging edits remain mandatory.
 *
 * Note the surviving asymmetry: the live entry carries 27 fields (7 daily + 19
 * monthly + handle), so the promote MUST use the sparse `fields` write — a full
 * `values` replacement there would wipe the monthly fields. Also, `value: null` on
 * `fields` does not work as a clear: MetaobjectFieldInput.value is String! (non-null)
 * in Shopify's schema, so GraphQL rejects it at variable-validation time for every
 * field type (confirmed via live schema introspection, 2026-10-11). That mattered for
 * the old clearing step and is kept here as a warning for anyone reintroducing one.
 *
 * If the operator forgets to stage before 01:55 but populates later that day
 * (e.g., 05:00), the next fallback tick will still find the gate open and perform
 * the swap — self-healing against missed morning runs. But the giveaway won't rotate
 * until the next day if they miss staging for the whole day.
 *
 * Usage (CLI):
 *   node src/giveaway/swap.js [--dry-run] [--alert-if-empty]
 *
 * WHY --alert-if-empty IS OPT-IN
 * ──────────────────────────────
 * The gate deliberately stays open all day because the stamp is only written on a
 * successful swap. If staging is empty, any caller that ran repeatedly would emit
 * its own "you forgot to stage" message per tick. monitor.yml ran this without the
 * flag to avoid duplicates when it was a high-frequency fallback. The flag is
 * kept opt-in rather than forced because the gate property (not the cadence) is
 * the source of the duplication risk — and adding a new caller in future should
 * not silently inherit the alert.
 *
 * giveaway-swap.yml is currently the only caller and always passes --alert-if-empty,
 * so "at most one warning per day" is a structural property of the once-daily
 * dedicated workflow rather than something this module tracks with a second stamp.
 *
 * Since staging values are now retained (see above), an empty staging entry is no
 * longer the normal daytime state — it means the entry was never populated or was
 * manually wiped. The flag is kept anyway: it costs nothing and still bounds the
 * blast radius if that ever happens.
 *
 * Env:
 *   SHOPIFY_ADMIN_API_TOKEN — required for Admin API mutations.
 *
 * Outputs:
 *   state/giveaway-swap-date.txt — persisted one-line YYYY-MM-DD timestamp
 *                                  (Central time), used to gate one swap per day.
 *                                  COMMITTED to git, unlike the incident state
 *                                  files, because two different workflows
 *                                  (giveaway-swap.yml and the monitor.yml
 *                                  fallback) must share one authoritative stamp.
 *                                  A git checkout gives both the same value;
 *                                  an Actions cache would not reliably.
 *
 *   Telegram alert: sent on success or error unconditionally; on "nothing staged"
 *   only when --alert-if-empty is passed. Suppressed entirely by --dry-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../config/monitor.config.js';
import { getCentralTime, shouldRunGiveawaySwap } from '../schedule.js';
import { fetchMetaobjectByHandle, updateMetaobjectFields } from '../admin.js';
import { formatSwapMessage, sendTelegram } from '../alerting/telegram.js';

// Metaobject types and handles
const UPCOMING_TYPE = 'upcoming_flash_giveaway';
const UPCOMING_HANDLE = 'upcoming-flash-giveaway';
const LIVE_TYPE = 'giveaway';
const LIVE_HANDLE = 'mps-giveaway';

// Daily fields rotated in the swap: all promoted from upcoming to live.
// This is separate from config.giveaway.rotationFields (which is used by check.js
// to detect "did a meaningful rotation happen" via field-change detection).
// The swap's field list is all fields the operator maintains for daily giveaways.
//
// NOTE: flash_giveaway_start_date was removed from this list on 2026-10-13 — the
// operator no longer auto-rotates the start date, so the swap leaves whatever is
// already on the live entry untouched. The field may still exist on both metaobject
// definitions; it is simply not promoted.
const DAILY_SWAP_FIELDS = [
  'flash_giveaway_end_date',
  'flash_giveaway_timer_copy',
  'flash_giveaway_desktop_banner',
  'flash_giveaway_mobile_banner',
  'pdp_images',
  'mps_announcement_bar_texts',
  'mps_homepage_announcement_bar_texts'
];

const SWAP_STAMP_PATH = path.resolve('state/giveaway-swap-date.txt');

// ── Pure logic ────────────────────────────────────────────────────────────────

/**
 * Core swap logic: fetch upcoming/live entries, promote staged fields onto live.
 * The staging (upcoming) entry is read-only here — its values are retained.
 *
 * Returns an object describing what happened, suitable for logging, Telegram, or tests.
 * Throws on API/network errors (not idempotent — a retry with same args may redo the swap).
 *
 * @param {{
 *   shop: string,
 *   token: string,
 *   now?: Date,
 *   stamp?: string,
 *   version?: string,
 *   fetcher?: typeof fetch
 * }} opts
 * @returns {Promise<{
 *   ran: boolean,
 *   reason?: string,      'gate-not-open' | 'nothing-staged' | (implicitly 'success' if ran && swapped.length > 0)
 *   swapped: string[],    fields that were promoted from upcoming to live
 *   previousValues?: object,  live values before swap (for the Telegram alert)
 *   newValues?: object         staged values after promotion
 * }>}
 */
export async function runGiveawaySwap({
  shop,
  token,
  now,
  stamp = '',
  version = '2026-10',
  fetcher = fetch
}) {
  const { date } = getCentralTime(now);

  // Check the daily gate: are we at/after 01:55 Chicago today, and has this gate fired yet today?
  if (!shouldRunGiveawaySwap({ stamp, now })) {
    return { ran: false, reason: 'gate-not-open', swapped: [] };
  }

  // Gate is open. Fetch the staging entry.
  const upcoming = await fetchMetaobjectByHandle({
    shop,
    token,
    type: UPCOMING_TYPE,
    handle: UPCOMING_HANDLE,
    version,
    fetcher
  });
  if (!upcoming) {
    throw new Error(`Swap: staging entry ${UPCOMING_TYPE}/${UPCOMING_HANDLE} not found. Was it created?`);
  }

  // Identify non-empty fields to promote.
  const staged = DAILY_SWAP_FIELDS
    .map((key) => ({ key, value: upcoming.fieldMap[key] }))
    .filter((f) => f.value !== null && f.value !== undefined && f.value !== '');

  // If nothing is staged, the gate fired but there's no work to do. Log and exit
  // (do NOT write the stamp, so a late-staging operator can still swap today).
  if (staged.length === 0) {
    return { ran: true, reason: 'nothing-staged', swapped: [] };
  }

  // Fetch the live entry to get its GID.
  const live = await fetchMetaobjectByHandle({
    shop,
    token,
    type: LIVE_TYPE,
    handle: LIVE_HANDLE,
    version,
    fetcher
  });
  if (!live) {
    throw new Error(`Swap: live entry ${LIVE_TYPE}/${LIVE_HANDLE} not found.`);
  }

  // Capture live entry's current values (for the Telegram alert to show before→after).
  const previousValues = Object.fromEntries(
    staged.map((f) => [f.key, live.fieldMap[f.key] ?? null])
  );

  // Promote staged values to live.
  await updateMetaobjectFields({
    shop,
    token,
    id: live.id,
    fields: staged,
    version,
    fetcher
  });

  // The staging entry is deliberately LEFT INTACT (changed 2026-10-13).
  // It is a persistent template, not a one-shot queue: the operator edits it in the
  // Shopify admin and the same values re-promote (idempotently) each day until they
  // change them. See the module docstring, "STAGING IS A PERSISTENT TEMPLATE".

  return {
    ran: true,
    swapped: staged.map((f) => f.key),
    previousValues,
    newValues: Object.fromEntries(staged.map((f) => [f.key, f.value]))
  };
}

// ── CLI runner ────────────────────────────────────────────────────────────────

function loadStamp(filePath) {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    console.warn(`[giveaway/swap] Failed to read ${filePath}:`, err.message);
    return '';
  }
}

function writeStamp(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${value}\n`, 'utf8');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  // See module-level docstring: "nothing staged" alerts are opt-in so the
  // monitor.yml fallback doesn't emit one per tick for the rest of the day.
  const alertIfEmpty = process.argv.includes('--alert-if-empty');
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error('[giveaway/swap] SHOPIFY_ADMIN_API_TOKEN not in environment');
    process.exit(1);
  }

  console.log(`[giveaway/swap] Starting at ${new Date().toISOString()}${dryRun ? ' (DRY-RUN)' : ''}`);

  const nowMs = Date.now();
  const now = new Date(nowMs);
  const stamp = loadStamp(SWAP_STAMP_PATH);

  let result;
  try {
    result = await runGiveawaySwap({
      shop: config.admin.shop,
      token,
      now,
      stamp,
      version: config.admin.apiVersion
    });
  } catch (err) {
    console.error('[giveaway/swap] Swap failed:', err.message);

    // Send error alert to Telegram.
    const msg = formatSwapMessage({ error: err.message });
    if (msg && !dryRun && chatId && telegramToken) {
      try {
        await sendTelegram({ token: telegramToken, chatId, text: msg, dryRun });
      } catch (telErr) {
        console.error('[giveaway/swap] Failed to send Telegram alert:', telErr.message);
      }
    }
    process.exit(1);
  }

  const { ran, reason, swapped, previousValues, newValues } = result;

  if (!ran) {
    console.log(`[giveaway/swap] Gate not open (reason: ${reason})`);
    process.exit(0);
  }

  if (reason === 'nothing-staged') {
    console.log(`[giveaway/swap] Gate open but nothing staged to swap.`);

    // Send warning alert only when explicitly requested (--alert-if-empty).
    // The dedicated giveaway-swap.yml workflow passes this flag; the high-frequency
    // monitor.yml fallback does not — so it stays silent when nothing is staged.
    if (alertIfEmpty) {
      const msg = formatSwapMessage({ swapped: [], reason: 'nothing-staged' });
      if (msg && !dryRun && chatId && telegramToken) {
        try {
          await sendTelegram({ token: telegramToken, chatId, text: msg, dryRun });
        } catch (telErr) {
          console.error('[giveaway/swap] Failed to send Telegram alert:', telErr.message);
        }
      }
    } else {
      console.log('[giveaway/swap] Skipping "nothing staged" alert (--alert-if-empty not passed)');
    }

    // DO NOT write the stamp — allow a late-staging operator to promote within the same day.
    process.exit(0);
  }

  // Success: fields were swapped.
  console.log(`[giveaway/swap] Swapped ${swapped.length} field(s):`);
  for (const key of swapped) {
    const prev = previousValues[key] ?? '(not set)';
    const next = newValues[key] ?? '(cleared)';
    console.log(`  ${key}: ${JSON.stringify(prev).slice(0, 80)}… → ${JSON.stringify(next).slice(0, 80)}…`);
  }

  if (!dryRun) {
    const { date } = getCentralTime(now);
    writeStamp(SWAP_STAMP_PATH, date);
    console.log(`[giveaway/swap] Wrote ${SWAP_STAMP_PATH} — gate closed for today`);

    // Send success alert to Telegram.
    const msg = formatSwapMessage({ swapped, previousValues, newValues });
    if (msg && chatId && telegramToken) {
      try {
        await sendTelegram({ token: telegramToken, chatId, text: msg, dryRun: false });
        console.log('[giveaway/swap] Telegram alert sent');
      } catch (telErr) {
        console.error('[giveaway/swap] Failed to send Telegram alert:', telErr.message);
      }
    }
  } else {
    console.log('[giveaway/swap] DRY-RUN: stamp and Telegram alert not written.');
  }

  console.log(`[giveaway/swap] Completed in ${Date.now() - nowMs}ms`);
  process.exit(0);
}

// Only run the CLI when this file is executed directly (node src/giveaway/swap.js),
// NOT when imported by a test. ESM has no require.main; compare argv[1] to this module's path.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
