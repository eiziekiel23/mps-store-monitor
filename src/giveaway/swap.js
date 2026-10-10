/**
 * Daily giveaway value swap: promotes the operator-staged "upcoming_flash_giveaway"
 * fields into the live "giveaway" entry, then clears the staging entry.
 *
 * Fires once per day at/after 02:00 America/Chicago, auto-adjusting for DST.
 * Idempotent: every 15-minute cron tick from 02:00 onward applies the same
 * timestamp-stamped gate; the first tick to find an open gate swaps, the rest
 * of the day log and skip.
 *
 * WHY SEPARATE METAOBJECTS (UPCOMING vs. LIVE)
 * ───────────────────────────────────────────
 * The theme selects giveaway entries by date window (today within start/end dates),
 * with a last-entry-wins fallback. Pre-creating the next day's giveaway as a
 * separate entry would leak it early if any selection logic found it before its
 * start time. By staging in a *separate* type and swapping on schedule, the live
 * entry is atomic: it either is yesterday's giveaway or today's, never both.
 *
 * STAGING AND CLEARING PATTERN
 * ────────────────────────────
 * The operator populates the upcoming_flash_giveaway entry before 02:00 Chicago
 * on the day the giveaway should change. The swap promotes ALL non-empty fields
 * from upcoming into live, then clears those same fields in upcoming (sets
 * value: null). Clearing prevents a forgotten manual update from re-promoting
 * stale values again tomorrow. Subsequent cron ticks that same day find
 * nothing staged → nothing swapped → no redundant Telegram alerts.
 *
 * If the operator forgets to stage before 02:00 but populates later that day
 * (e.g., 05:00), the next hourly tick at 06:00+ will still find the gate open
 * and perform the swap — self-healing against missed morning runs. But the
 * giveaway won't rotate until the next day if they miss 02:00 entirely.
 *
 * Usage (CLI):
 *   node src/giveaway/swap.js [--dry-run]
 *
 * Env:
 *   SHOPIFY_ADMIN_API_TOKEN — required for Admin API mutations.
 *
 * Outputs:
 *   state/giveaway-swap-date.txt — persisted one-line YYYY-MM-DD timestamp
 *                                  (Central time), used to gate one swap per day.
 *                                  NOT committed to git (like other state files).
 *
 *   Telegram alert on success, warning, or error (unless --dry-run).
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
const DAILY_SWAP_FIELDS = [
  'flash_giveaway_start_date',
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
 * Core swap logic: fetch upcoming/live entries, promote staged fields, clear source.
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

  // Check the daily gate: are we at/after 02:00 Chicago today, and has this gate fired yet today?
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

  // Clear the staged fields so a forgotten update doesn't re-promote stale values tomorrow.
  const clearFields = staged.map((f) => ({ key: f.key, value: null }));
  await updateMetaobjectFields({
    shop,
    token,
    id: upcoming.id,
    fields: clearFields,
    version,
    fetcher
  });

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

    // Send warning alert to Telegram (operator may have forgotten).
    const msg = formatSwapMessage({ swapped: [], reason: 'nothing-staged' });
    if (msg && !dryRun && chatId && telegramToken) {
      try {
        await sendTelegram({ token: telegramToken, chatId, text: msg, dryRun });
      } catch (telErr) {
        console.error('[giveaway/swap] Failed to send Telegram alert:', telErr.message);
      }
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
