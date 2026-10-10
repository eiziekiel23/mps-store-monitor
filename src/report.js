import fs from 'node:fs';
import path from 'node:path';
import { applyRun } from './alerting/incidents.js';
import { formatRunMessage, formatStatusMessage, sendTelegram } from './alerting/telegram.js';
import { aggregateChecks } from './alerting/checks.js';
import { formatChangesForTelegram } from './giveaway/changelog.js';
import { shouldSendDailyGiveawayReport, getCentralTime, DAILY_REPORT_HOUR } from './schedule.js';

// Parse command-line flags
const dryRun = process.argv.includes('--dry-run');
const resultsPath = path.resolve('telemetry/results.json');
const statePath = path.resolve('state/incidents.json');
// Written by src/giveaway/check.js, which runs as its own workflow step
// (separate from the Playwright suite) because it hits the Storefront API
// directly rather than driving a browser.
const giveawayResultPath = path.resolve('telemetry/giveaway-result.json');
const giveawayChangesPath = path.resolve('telemetry/giveaway-changes.json');
// Date-stamp for the daily giveaway report gate (3 AM America/Chicago, DST-aware).
// Written after successful dispatch; read on the next run to prevent duplicate sends.
const DAILY_REPORT_STAMP_PATH = path.resolve('state/daily-giveaway-report-date.txt');

if (!fs.existsSync(resultsPath)) {
  console.error('No results.json found in telemetry/. Skipping report.');
  process.exit(0);
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
let prevState = { incidents: {} };

if (fs.existsSync(statePath)) {
  try {
    prevState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    console.warn('Failed to parse previous state/incidents.json, starting fresh:', err.message);
  }
}

// Fold the giveaway freshness check in alongside the Playwright checks so it
// gets the same incident tracking (opened/reminder/recovered) and shows up
// in the manual status digest like any other check.
const allChecks = [...(results.checks || [])];
if (fs.existsSync(giveawayResultPath)) {
  try {
    allChecks.push(JSON.parse(fs.readFileSync(giveawayResultPath, 'utf8')));
  } catch (err) {
    console.warn('Failed to parse telemetry/giveaway-result.json, omitting from this run:', err.message);
  }
}

// Each logical check runs once per Playwright project (desktop-chrome,
// mobile), so results.checks holds one row per project. Collapse those
// into a single record per check ID (worst-status-wins) before the
// incident state machine or the Telegram report ever see them — otherwise
// every check is double-counted and alerts/digests show duplicate entries.
const aggregated = aggregateChecks(allChecks);

const { state: nextState, events } = applyRun(prevState, aggregated, {
  nowMs: Date.now(),
  traceId: results.traceId
});

// Persist the updated incidents state
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;

// A manually-triggered run (workflow_dispatch) or local invocation should
// always produce a visible report so the operator can confirm the monitor
// actually ran and see every check's status. Scheduled (cron) runs stay
// alert-only to avoid hourly "all clear" spam — that is the core no-spam
// contract of the alerting layer.
const isManualRun = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.GITHUB_EVENT_NAME;

async function dispatch(text, label) {
  if (!text) return;
  try {
    await sendTelegram({ token, chatId, text, dryRun: dryRun || !token || !chatId });
    console.log(`${label} sent successfully.`);
  } catch (err) {
    console.error(`Failed to dispatch ${label}:`, err.message);
    process.exit(1);
  }
}

/** Read the last date (YYYY-MM-DD Central) a daily giveaway report was sent, or '' if never. */
function readDailyReportStamp() {
  try {
    return fs.existsSync(DAILY_REPORT_STAMP_PATH)
      ? fs.readFileSync(DAILY_REPORT_STAMP_PATH, 'utf8').trim()
      : '';
  } catch (err) {
    console.warn('Failed to read daily-report stamp, treating as unsent:', err.message);
    return '';
  }
}

/** Record today's Central date so later runs on the same day don't re-send. */
function writeDailyReportStamp() {
  const { date } = getCentralTime();
  fs.mkdirSync(path.dirname(DAILY_REPORT_STAMP_PATH), { recursive: true });
  fs.writeFileSync(DAILY_REPORT_STAMP_PATH, date, 'utf8');
}

// Alert on state transitions (new failures, recoveries, reminders).
if (events.length > 0) {
  await dispatch(
    formatRunMessage({ events, traceId: results.traceId, runUrl, checks: aggregated }),
    `Alert (${events.length} event(s))`
  );
} else {
  console.log('No state transitions or reminders. Skipping incident alert.');
}

// Send giveaway rotation updates as alerts (independent of incident state transitions and trigger type).
// On cron runs: this is the only giveaway notification. On manual runs: in addition to the digest.
// Compute once and reuse in the manual-digest block below.
let giveawayChangeBlock = null;
if (fs.existsSync(giveawayChangesPath)) {
  try {
    const giveawayChanges = JSON.parse(fs.readFileSync(giveawayChangesPath, 'utf8'));
    // isFirstRun is flagged so we omit the "no baseline yet" non-change on all runs.
    if (!giveawayChanges.isFirstRun && giveawayChanges.changes?.length > 0) {
      giveawayChangeBlock = formatChangesForTelegram(giveawayChanges.changes);
    }
  } catch (err) {
    console.warn('Failed to parse telemetry/giveaway-changes.json:', err.message);
  }
}

// Throttle the giveaway rotation report to ONE send per America/Chicago calendar
// day, at or after DAILY_REPORT_HOUR local (DST-aware — see src/schedule.js).
//
// Diff detection above still runs every hour; only the Telegram dispatch is
// gated. The store rotates at ~02:00 Central, so the first eligible run after
// 03:00 carries the complete rotation rather than a partial one. Manual runs
// bypass the gate entirely and never consume the day's slot, so an operator
// can pull a digest on demand without suppressing the real morning report.
if (giveawayChangeBlock) {
  const stamp = readDailyReportStamp();
  if (shouldSendDailyGiveawayReport({ isManualRun, stamp })) {
    await dispatch(giveawayChangeBlock, 'Giveaway update');
    if (!isManualRun) writeDailyReportStamp();
  } else {
    const { date, hour } = getCentralTime();
    console.log(
      `Giveaway changes detected, but outside the daily report window ` +
      `(Central ${date} ${String(hour).padStart(2, '0')}:00, ` +
      `window opens ${String(DAILY_REPORT_HOUR).padStart(2, '0')}:00, ` +
      `last sent: ${stamp || 'never'}). Skipping dispatch.`
    );
  }
}

// On a manual/local run, additionally send a full status digest of every
// check, even when nothing changed — this is the "full test report".
if (isManualRun) {
  let statusReport = formatStatusMessage({ checks: aggregated, traceId: results.traceId, runUrl });

  // If giveaway changes were already computed and dispatched above, append them to the digest too
  // so the operator can see both the alert and the full context in the manual report.
  if (giveawayChangeBlock) {
    statusReport += giveawayChangeBlock;
  }

  await dispatch(statusReport, 'Manual status report');
}
