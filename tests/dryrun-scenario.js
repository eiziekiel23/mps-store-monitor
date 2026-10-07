import fs from 'node:fs';
import path from 'node:path';
import { applyRun } from '../src/alerting/incidents.js';
import { formatRunMessage } from '../src/alerting/telegram.js';

console.log('=== SIMULATING SCENARIO 1: Run 1 (Outage Detected) ===');
let state = {};
const t0 = Date.now();
const run1Checks = [
  { id: 'store.reachable', status: 'passed' },
  { id: 'home.sections', status: 'failed', error: 'Missing trust badge component' }
];

let res = applyRun(state, run1Checks, { nowMs: t0, traceId: 'trace-run-1' });
state = res.state;
console.log(formatRunMessage({ events: res.events, traceId: 'trace-run-1', runUrl: 'https://github.com/runs/1' }));

console.log('\n=== SIMULATING SCENARIO 2: Run 2 (15m Later, Failure Persisting) ===');
const run2Checks = [
  { id: 'store.reachable', status: 'passed' },
  { id: 'home.sections', status: 'failed', error: 'Missing trust badge component' }
];
res = applyRun(state, run2Checks, { nowMs: t0 + 15 * 60 * 1000, traceId: 'trace-run-2' });
state = res.state;
console.log(`Events emitted: ${res.events.length} (Expected 0 due to 60m cooldown)`);

console.log('\n=== SIMULATING SCENARIO 3: Run 5 (65m Later, Hourly Reminder) ===');
res = applyRun(state, run2Checks, { nowMs: t0 + 65 * 60 * 1000, traceId: 'trace-run-5' });
state = res.state;
console.log(formatRunMessage({ events: res.events, traceId: 'trace-run-5', runUrl: 'https://github.com/runs/5' }));

console.log('\n=== SIMULATING SCENARIO 4: Run 6 (80m Later, Recovery) ===');
const run6Checks = [
  { id: 'store.reachable', status: 'passed' },
  { id: 'home.sections', status: 'passed' }
];
res = applyRun(state, run6Checks, { nowMs: t0 + 80 * 60 * 1000, traceId: 'trace-run-6' });
state = res.state;
console.log(formatRunMessage({ events: res.events, traceId: 'trace-run-6', runUrl: 'https://github.com/runs/6' }));
console.log(`Active incidents remaining in state: ${Object.keys(state.incidents).length}`);
