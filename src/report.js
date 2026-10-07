import fs from 'node:fs';
import path from 'node:path';
import { applyRun } from './alerting/incidents.js';
import { formatRunMessage, formatStatusMessage, sendTelegram } from './alerting/telegram.js';
import { aggregateChecks } from './alerting/checks.js';

// Parse command-line flags
const dryRun = process.argv.includes('--dry-run');
const resultsPath = path.resolve('telemetry/results.json');
const statePath = path.resolve('state/incidents.json');

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

// Each logical check runs once per Playwright project (desktop-chrome,
// mobile), so results.checks holds one row per project. Collapse those
// into a single record per check ID (worst-status-wins) before the
// incident state machine or the Telegram report ever see them — otherwise
// every check is double-counted and alerts/digests show duplicate entries.
const aggregated = aggregateChecks(results.checks || []);

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

// Alert on state transitions (new failures, recoveries, reminders).
if (events.length > 0) {
  await dispatch(
    formatRunMessage({ events, traceId: results.traceId, runUrl }),
    `Alert (${events.length} event(s))`
  );
} else {
  console.log('No state transitions or reminders. Skipping incident alert.');
}

// On a manual/local run, additionally send a full status digest of every
// check, even when nothing changed — this is the "full test report".
if (isManualRun) {
  await dispatch(
    formatStatusMessage({ checks: aggregated, traceId: results.traceId, runUrl }),
    'Manual status report'
  );
}
