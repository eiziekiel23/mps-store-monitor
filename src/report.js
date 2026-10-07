import fs from 'node:fs';
import path from 'node:path';
import { applyRun } from './alerting/incidents.js';
import { formatRunMessage, sendTelegram } from './alerting/telegram.js';

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

const { state: nextState, events } = applyRun(prevState, results.checks || [], {
  nowMs: Date.now(),
  traceId: results.traceId
});

// Persist the updated incidents state
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2));

// Process alert notification if any events occurred
if (events.length > 0) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

  const text = formatRunMessage({
    events,
    traceId: results.traceId,
    runUrl
  });

  if (text) {
    try {
      await sendTelegram({
        token,
        chatId,
        text,
        dryRun: dryRun || !token || !chatId
      });
      console.log(`Alert processed successfully (${events.length} event(s)).`);
    } catch (err) {
      console.error('Failed to dispatch Telegram alert:', err.message);
      process.exit(1);
    }
  }
} else {
  console.log('No state transitions or reminders. Skipping Telegram alert.');
}
