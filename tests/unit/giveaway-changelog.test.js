import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffFields,
  todayAnchorMs,
  evaluateStaleness,
  applyChangelog,
  renderMarkdown,
  formatChangesForTelegram,
  truncate,
  DEFAULT_GRACE_MS
} from '../../src/giveaway/changelog.js';

// 2026-10-07 is inside CDT (UTC-5), so 02:00 Chicago == 07:00 UTC.
const ANCHOR_UTC = Date.parse('2026-10-07T07:00:00Z'); // 02:00 Chicago
const DUE_UTC = ANCHOR_UTC + DEFAULT_GRACE_MS;         // 03:00 Chicago
const MIDDAY_UTC = Date.parse('2026-10-07T12:00:00Z'); // 07:00 Chicago

describe('giveaway/changelog - diffFields', () => {
  test('reports changed, added and removed fields sorted by name', () => {
    const prev = { a: '1', b: 'keep', removed: 'gone' };
    const curr = { a: '2', b: 'keep', added: 'new' };
    const changes = diffFields(prev, curr);

    assert.deepEqual(changes.map(c => c.field), ['a', 'added', 'removed']);
    assert.deepEqual(changes[0], { field: 'a', old: '1', new: '2' });
    assert.deepEqual(changes[1], { field: 'added', old: null, new: 'new' });
    assert.deepEqual(changes[2], { field: 'removed', old: 'gone', new: null });
  });

  test('identical maps produce no changes', () => {
    assert.deepEqual(diffFields({ x: '1' }, { x: '1' }), []);
  });

  test('ignoreFields suppresses noisy fields', () => {
    const changes = diffFields({ a: '1', noisy: 'x' }, { a: '1', noisy: 'y' }, { ignoreFields: ['noisy'] });
    assert.deepEqual(changes, []);
  });
});

describe('giveaway/changelog - todayAnchorMs', () => {
  test('02:00 America/Chicago resolves to 07:00 UTC during CDT', () => {
    assert.equal(todayAnchorMs(MIDDAY_UTC, 'America/Chicago', 2), ANCHOR_UTC);
  });

  test('02:00 America/Chicago resolves to 08:00 UTC during CST (winter)', () => {
    // 2026-01-15 is CST (UTC-6) -> 02:00 Chicago == 08:00 UTC
    const jan = Date.parse('2026-01-15T12:00:00Z');
    assert.equal(todayAnchorMs(jan, 'America/Chicago', 2), Date.parse('2026-01-15T08:00:00Z'));
  });

  test('uses the Chicago calendar day, not the UTC day', () => {
    // 2026-10-07T03:00:00Z is still 2026-10-06 22:00 in Chicago,
    // so the anchor must be Oct 6's 02:00, not Oct 7's.
    const lateUtc = Date.parse('2026-10-07T03:00:00Z');
    assert.equal(todayAnchorMs(lateUtc, 'America/Chicago', 2), Date.parse('2026-10-06T07:00:00Z'));
  });
});

describe('giveaway/changelog - evaluateStaleness', () => {
  test('not stale before the daily deadline, even with no rotation today', () => {
    const res = evaluateStaleness({
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'), // yesterday
      nowMs: ANCHOR_UTC + 30 * 60 * 1000                  // 02:30 Chicago, pre-deadline
    });
    assert.equal(res.stale, false);
    assert.equal(res.reason, null);
  });

  test('not stale when a rotation landed after today\'s anchor', () => {
    const res = evaluateStaleness({
      lastRotationMs: ANCHOR_UTC + 5 * 60 * 1000, // 02:05 Chicago today
      nowMs: MIDDAY_UTC
    });
    assert.equal(res.stale, false);
  });

  test('stale past the deadline when the last rotation predates today\'s anchor', () => {
    const res = evaluateStaleness({
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'), // yesterday
      nowMs: MIDDAY_UTC
    });
    assert.equal(res.stale, true);
    assert.match(res.reason, /no giveaway field rotation/);
    assert.match(res.reason, /02:00 America\/Chicago/);
  });

  test('stale exactly at the deadline boundary with a stale rotation', () => {
    const res = evaluateStaleness({
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'),
      nowMs: DUE_UTC
    });
    assert.equal(res.stale, true);
  });

  test('stale when no rotation was ever recorded', () => {
    const res = evaluateStaleness({ lastRotationMs: null, nowMs: MIDDAY_UTC });
    assert.equal(res.stale, true);
    assert.match(res.reason, /has ever been recorded/);
  });

  test('an expired end date is stale at any hour, even pre-deadline', () => {
    const res = evaluateStaleness({
      lastRotationMs: ANCHOR_UTC,
      nowMs: ANCHOR_UTC + 10 * 60 * 1000,        // pre-deadline
      endDateMs: Date.parse('2026-10-06T23:59:00Z') // already passed
    });
    assert.equal(res.stale, true);
    assert.match(res.reason, /end date passed/);
  });

  test('a future end date does not by itself make the run stale', () => {
    const res = evaluateStaleness({
      lastRotationMs: ANCHOR_UTC,
      nowMs: MIDDAY_UTC,
      endDateMs: Date.parse('2026-10-08T23:59:00Z')
    });
    assert.equal(res.stale, false);
  });
});

describe('giveaway/changelog - applyChangelog', () => {
  const giveaway = {
    flash_giveaway_start_date: '2026-10-07 00:00:00',
    flash_giveaway_end_date: '2026-10-07 23:59:00',
    prize_name: 'Charizard'
  };

  test('first run seeds the baseline without reporting changes or staleness', () => {
    const res = applyChangelog(null, giveaway, { nowMs: MIDDAY_UTC });

    assert.equal(res.isFirstRun, true);
    assert.deepEqual(res.changes, []);
    assert.equal(res.staleness.stale, false, 'baseline run must not alert');
    assert.equal(res.nextState.lastRotationMs, MIDDAY_UTC);
    assert.deepEqual(res.nextState.fields, giveaway);
    assert.deepEqual(res.nextState.entries, []);
  });

  test('a rotation-field change refreshes lastRotationMs and logs an entry', () => {
    const prevState = {
      fields: { ...giveaway, flash_giveaway_end_date: '2026-10-06 23:59:00' },
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'),
      entries: []
    };

    const res = applyChangelog(prevState, giveaway, { nowMs: MIDDAY_UTC });

    assert.equal(res.changes.length, 1);
    assert.equal(res.changes[0].field, 'flash_giveaway_end_date');
    assert.equal(res.changes[0].old, '2026-10-06 23:59:00');
    assert.equal(res.changes[0].new, '2026-10-07 23:59:00');
    assert.equal(res.nextState.lastRotationMs, MIDDAY_UTC, 'rotation refreshes the clock');
    assert.equal(res.staleness.stale, false);
    assert.equal(res.nextState.entries.length, 1);
    assert.equal(res.nextState.entries[0].rotated, true);
  });

  test('a non-rotation change is logged but does NOT count as a rotation', () => {
    const prevState = {
      fields: { ...giveaway, prize_name: 'Pikachu' },
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'), // yesterday
      entries: []
    };

    const res = applyChangelog(prevState, giveaway, { nowMs: MIDDAY_UTC });

    assert.equal(res.changes.length, 1);
    assert.equal(res.changes[0].field, 'prize_name');
    // Logged...
    assert.equal(res.nextState.entries.length, 1);
    assert.equal(res.nextState.entries[0].rotated, false);
    // ...but the rotation clock is untouched, so the missed rotation still alerts.
    assert.equal(res.nextState.lastRotationMs, prevState.lastRotationMs);
    assert.equal(res.staleness.stale, true);
  });

  test('no change at all past the deadline flags staleness', () => {
    const prevState = {
      fields: { ...giveaway },
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'),
      entries: []
    };

    const res = applyChangelog(prevState, giveaway, { nowMs: MIDDAY_UTC });

    assert.deepEqual(res.changes, []);
    assert.equal(res.nextState.entries.length, 0, 'no entry when nothing changed');
    assert.equal(res.staleness.stale, true);
  });

  test('newest entry is first and history is capped by maxEntries', () => {
    const old = Array.from({ length: 5 }, (_, i) => ({ at: `old-${i}`, rotated: false, changes: [] }));
    const prevState = {
      fields: { ...giveaway, prize_name: 'Pikachu' },
      lastRotationMs: MIDDAY_UTC,
      entries: old
    };

    const res = applyChangelog(prevState, giveaway, { nowMs: MIDDAY_UTC, maxEntries: 3 });

    assert.equal(res.nextState.entries.length, 3);
    assert.equal(res.nextState.entries[0].at, new Date(MIDDAY_UTC).toISOString(), 'newest first');
    assert.equal(res.nextState.entries[1].at, 'old-0');
  });

  test('respects a custom anchor hour and grace window', () => {
    const prevState = {
      fields: { ...giveaway },
      lastRotationMs: Date.parse('2026-10-06T07:05:00Z'),
      entries: []
    };

    // Anchor 06:00 Chicago == 11:00 UTC (CDT); deadline = 12:00 UTC (MIDDAY_UTC).
    // Use 06:30 Chicago (11:30 UTC) — unambiguously pre-deadline.
    const res = applyChangelog(prevState, giveaway, {
      nowMs: Date.parse('2026-10-07T11:30:00Z'), // 06:30 Chicago, before 07:00 deadline
      anchorHour: 6,
      graceMs: 60 * 60 * 1000
    });

    assert.equal(res.staleness.stale, false, '06:30 Chicago is before the 06:00+1h deadline');
  });
});

describe('giveaway/changelog - rendering', () => {
  const entries = [
    {
      at: '2026-10-07T07:02:00.000Z',
      rotated: true,
      changes: [{ field: 'flash_giveaway_end_date', old: '2026-10-06 23:59:00', new: '2026-10-07 23:59:00' }]
    }
  ];

  test('renderMarkdown produces a table per entry', () => {
    const md = renderMarkdown(entries);
    assert.match(md, /# Flash Giveaway Changelog/);
    assert.match(md, /## 2026-10-07T07:02:00\.000Z — daily rotation/);
    assert.match(md, /\| Field \| Old \| New \|/);
    assert.match(md, /`flash_giveaway_end_date`/);
    assert.match(md, /2026-10-06 23:59:00/);
  });

  test('renderMarkdown handles an empty history', () => {
    assert.match(renderMarkdown([]), /_No changes recorded yet\._/);
  });

  test('formatChangesForTelegram returns null when nothing changed', () => {
    assert.equal(formatChangesForTelegram([]), null);
  });

  test('formatChangesForTelegram renders old → new pairs', () => {
    const txt = formatChangesForTelegram(entries[0].changes);
    assert.match(txt, /🎁 \*GIVEAWAY CHANGES\*/);
    assert.match(txt, /`flash_giveaway_end_date`/);
    assert.match(txt, /→/);
  });

  test('truncate shortens long values but leaves short ones intact', () => {
    assert.equal(truncate('short', 20), 'short');
    const long = 'x'.repeat(100);
    assert.equal(truncate(long, 20).length, 20);
    assert.match(truncate(long, 20), /…$/);
  });
});
