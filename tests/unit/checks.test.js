import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateChecks } from '../../src/alerting/checks.js';

describe('alerting/checks - aggregateChecks', () => {
  // ── helpers ─────────────────────────────────────────────────────────────
  const mk = (id, status, project = 'desktop-chrome', overrides = {}) => ({
    id,
    status,
    project,
    durationMs: 1000,
    attempts: 1,
    error: status === 'failed' ? 'Timed out' : undefined,
    ...overrides
  });

  // ── 1. Single project: pass-through, no platformNote ─────────────────────
  test('single project check passes through unchanged with no platformNote', () => {
    const checks = [mk('store.reachable', 'passed')];
    const agg = aggregateChecks(checks);
    assert.equal(agg.length, 1);
    assert.equal(agg[0].id, 'store.reachable');
    assert.equal(agg[0].status, 'passed');
    assert.equal(agg[0].platformNote, undefined);
  });

  // ── 2. Two projects, same status → no platformNote ────────────────────────
  test('two projects with identical status produce one record without platformNote', () => {
    const checks = [
      mk('home.sections', 'passed', 'desktop-chrome'),
      mk('home.sections', 'passed', 'mobile')
    ];
    const agg = aggregateChecks(checks);
    assert.equal(agg.length, 1);
    assert.equal(agg[0].status, 'passed');
    assert.equal(agg[0].platformNote, undefined);
  });

  // ── 3. Two projects, status diverges → worst wins + platformNote ──────────
  test('failed overrides passed when projects disagree; platformNote names both', () => {
    const checks = [
      mk('nav.hamburger', 'skipped', 'desktop-chrome'),
      mk('nav.hamburger', 'passed', 'mobile')
    ];
    const agg = aggregateChecks(checks);
    assert.equal(agg.length, 1);
    // skipped (3) vs passed (2) → passed is worse (lower order)
    assert.equal(agg[0].status, 'passed');
    assert.ok(agg[0].platformNote, 'platformNote should be set');
    assert.ok(agg[0].platformNote.includes('desktop-chrome'));
    assert.ok(agg[0].platformNote.includes('mobile'));
  });

  test('failed beats all other statuses', () => {
    const checks = [
      mk('timer.correct', 'failed', 'desktop-chrome', { error: 'Timer drift 5h', durationMs: 8000 }),
      mk('timer.correct', 'flaky', 'mobile', { durationMs: 3000 })
    ];
    const agg = aggregateChecks(checks);
    assert.equal(agg[0].status, 'failed');
    assert.equal(agg[0].error, 'Timer drift 5h');
    assert.equal(agg[0].platformNote, 'desktop-chrome: failed, mobile: flaky');
  });

  // ── 4. Worst-status ordering across all four values ───────────────────────
  test('status priority: failed > flaky > passed > skipped', () => {
    const statuses = ['skipped', 'passed', 'flaky', 'failed'];
    const checks = statuses.map(s => mk('multi.check', s, s));
    const agg = aggregateChecks(checks);
    assert.equal(agg[0].status, 'failed');
  });

  // ── 5. Duration and attempts take the maximum ──────────────────────────────
  test('picks max durationMs and max attempts across projects', () => {
    const checks = [
      mk('store.reachable', 'passed', 'desktop-chrome', { durationMs: 2000, attempts: 1 }),
      mk('store.reachable', 'passed', 'mobile', { durationMs: 5000, attempts: 2 })
    ];
    const agg = aggregateChecks(checks);
    assert.equal(agg[0].durationMs, 5000);
    assert.equal(agg[0].attempts, 2);
  });

  // ── 6. Mixed batch: distinct IDs stay distinct, shared ID deduplicates ────
  test('preserves distinct IDs and deduplicates shared ones', () => {
    const checks = [
      mk('store.reachable', 'passed', 'desktop-chrome'),
      mk('store.reachable', 'passed', 'mobile'),
      mk('nav.hamburger', 'skipped', 'desktop-chrome'), // desktop-only skip
      mk('nav.hamburger', 'passed', 'mobile'),
      mk('timer.correct', 'failed', 'desktop-chrome'),
      mk('timer.correct', 'failed', 'mobile')
    ];
    const agg = aggregateChecks(checks);
    assert.equal(agg.length, 3);
    const byId = Object.fromEntries(agg.map(c => [c.id, c]));
    assert.equal(byId['store.reachable'].status, 'passed');
    assert.equal(byId['nav.hamburger'].status, 'passed');      // passed beats skipped
    assert.ok(byId['nav.hamburger'].platformNote);             // disagreement noted
    assert.equal(byId['timer.correct'].status, 'failed');
    assert.equal(byId['timer.correct'].platformNote, undefined); // both failed
  });

  // ── 7. Input ordering is preserved (first occurrence wins) ───────────────
  test('output order follows first occurrence of each check ID in the input', () => {
    const checks = [
      mk('b.check', 'passed'),
      mk('a.check', 'passed'),
      mk('b.check', 'passed', 'mobile'), // second occurrence of b
      mk('c.check', 'failed')
    ];
    const agg = aggregateChecks(checks);
    assert.deepEqual(agg.map(c => c.id), ['b.check', 'a.check', 'c.check']);
  });
});
