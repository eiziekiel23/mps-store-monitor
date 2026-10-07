import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyRun } from '../../src/alerting/incidents.js';

describe('alerting/incidents', () => {
  const t0 = 1_700_000_000_000;
  const trace1 = '1'.repeat(32);
  const trace2 = '2'.repeat(32);
  const trace3 = '3'.repeat(32);

  test('emits opened event on new failure and records state', () => {
    const checks = [{ id: 'home.sections', status: 'failed', error: 'Missing banner' }];
    const { state, events } = applyRun({}, checks, { nowMs: t0, traceId: trace1 });

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      type: 'opened',
      check: 'home.sections',
      sinceMs: t0,
      durationMs: 0,
      error: 'Missing banner',
      firstTraceId: trace1,
      screenshot: undefined
    });

    assert.deepEqual(state.incidents['home.sections'], {
      sinceMs: t0,
      lastAlertMs: t0,
      firstTraceId: trace1,
      error: 'Missing banner',
      screenshot: undefined
    });
  });

  test('does not emit event if failure persists within the 60-minute window', () => {
    const checks1 = [{ id: 'home.sections', status: 'failed', error: 'Missing banner' }];
    const { state: state1 } = applyRun({}, checks1, { nowMs: t0, traceId: trace1 });

    // 15 minutes later
    const checks2 = [{ id: 'home.sections', status: 'failed', error: 'Missing banner' }];
    const { state: state2, events: events2 } = applyRun(state1, checks2, { nowMs: t0 + 15 * 60 * 1000, traceId: trace2 });

    assert.equal(events2.length, 0);
    assert.equal(state2.incidents['home.sections'].lastAlertMs, t0); // Unchanged
  });

  test('emits reminder event when failure persists past 60 minutes (Review Focus 5)', () => {
    const checks1 = [{ id: 'home.sections', status: 'failed', error: 'Missing banner' }];
    const { state: state1 } = applyRun({}, checks1, { nowMs: t0, traceId: trace1 });

    // 65 minutes later (irregular gap: cron missed a tick)
    const t65 = t0 + 65 * 60 * 1000;
    const checks2 = [{ id: 'home.sections', status: 'failed', error: 'Missing banner' }];
    const { state: state2, events: events2 } = applyRun(state1, checks2, { nowMs: t65, traceId: trace2 });

    assert.equal(events2.length, 1);
    assert.equal(events2[0].type, 'reminder');
    assert.equal(events2[0].durationMs, 65 * 60 * 1000);
    assert.equal(events2[0].firstTraceId, trace1);
    assert.equal(state2.incidents['home.sections'].lastAlertMs, t65); // Updated to prevent immediate next-run reminder
  });

  test('emits recovered event when check passes after failing', () => {
    const checks1 = [{ id: 'home.sections', status: 'failed', error: 'Missing banner' }];
    const { state: state1 } = applyRun({}, checks1, { nowMs: t0, traceId: trace1 });

    // 30 minutes later, check passes
    const t30 = t0 + 30 * 60 * 1000;
    const checks2 = [{ id: 'home.sections', status: 'passed' }];
    const { state: state2, events: events2 } = applyRun(state1, checks2, { nowMs: t30, traceId: trace2 });

    assert.equal(events2.length, 1);
    assert.deepEqual(events2[0], {
      type: 'recovered',
      check: 'home.sections',
      sinceMs: t0,
      durationMs: 30 * 60 * 1000,
      firstTraceId: trace1
    });

    assert.equal(state2.incidents['home.sections'], undefined);
  });

  test('flaky check status triggers recovery from prior failure', () => {
    const checks1 = [{ id: 'home.sections', status: 'failed', error: 'Timeout' }];
    const { state: state1 } = applyRun({}, checks1, { nowMs: t0, traceId: trace1 });

    const checks2 = [{ id: 'home.sections', status: 'flaky' }];
    const { state: state2, events: events2 } = applyRun(state1, checks2, { nowMs: t0 + 15 * 60 * 1000, traceId: trace2 });

    assert.equal(events2.length, 1);
    assert.equal(events2[0].type, 'recovered');
    assert.equal(state2.incidents['home.sections'], undefined);
  });

  test('skipped check does not drop incident or emit recovery', () => {
    const checks1 = [{ id: 'home.sections', status: 'failed', error: 'Fatal' }];
    const { state: state1 } = applyRun({}, checks1, { nowMs: t0, traceId: trace1 });

    const checks2 = [{ id: 'home.sections', status: 'skipped' }];
    const { state: state2, events: events2 } = applyRun(state1, checks2, { nowMs: t0 + 15 * 60 * 1000, traceId: trace2 });

    assert.equal(events2.length, 0);
    assert.ok(state2.incidents['home.sections']);
  });
});
