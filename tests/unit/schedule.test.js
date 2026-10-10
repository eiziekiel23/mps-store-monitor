import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCentralTime,
  shouldSendDailyGiveawayReport,
  DAILY_REPORT_HOUR,
  getHourStamp,
  shouldSendHourlyStatusReport,
  resolveIsManualRun,
  shouldRunGiveawaySwap,
  GIVEAWAY_SWAP_HOUR
} from '../../src/schedule.js';

describe('schedule: giveaway daily report', () => {
  describe('getCentralTime', () => {
    it('returns a valid YYYY-MM-DD date string and 0-23 hour', () => {
      const { date, hour } = getCentralTime();
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/, 'date should be YYYY-MM-DD format');
      assert.ok(hour >= 0 && hour <= 23, `hour out of range: ${hour}`);
    });

    it('handles known UTC timestamp during CDT (UTC-5): 08:00 UTC = 03:00 CDT', () => {
      // 2026-07-15 (mid-summer, CDT active) 08:00 UTC = 03:00 CDT
      const result = getCentralTime(new Date('2026-07-15T08:00:00Z'));
      assert.equal(result.date, '2026-07-15');
      assert.equal(result.hour, 3);
    });

    it('handles known UTC timestamp during CST (UTC-6): 09:00 UTC = 03:00 CST', () => {
      // 2026-01-15 (mid-winter, CST active) 09:00 UTC = 03:00 CST
      const result = getCentralTime(new Date('2026-01-15T09:00:00Z'));
      assert.equal(result.date, '2026-01-15');
      assert.equal(result.hour, 3);
    });

    it('correctly places midnight UTC into previous Central day during CST', () => {
      // 2026-01-15 00:00 UTC = 2026-01-14 18:00 CST (still yesterday in Central time)
      const result = getCentralTime(new Date('2026-01-15T00:00:00Z'));
      assert.equal(result.date, '2026-01-14');
      assert.equal(result.hour, 18);
    });

    it('handles DST spring-forward boundary: 2026-03-08 02:00 CST → 03:00 CDT', () => {
      // DST begins 2026-03-08 at 02:00 CST (becomes 03:00 CDT).
      // 08:00 UTC is after the transition, so it lands in CDT.
      const result = getCentralTime(new Date('2026-03-08T08:00:00Z'));
      assert.equal(result.date, '2026-03-08');
      assert.equal(result.hour, 3);
    });

    it('handles DST fall-back boundary: 2026-11-01 02:00 CDT → 01:00 CST', () => {
      // DST ends 2026-11-01 at 02:00 CDT (becomes 01:00 CST).
      // 07:00 UTC should be after the fall-back, in CST.
      const result = getCentralTime(new Date('2026-11-01T07:00:00Z'));
      assert.equal(result.date, '2026-11-01');
      assert.equal(result.hour, 1);
    });
  });

  describe('shouldSendDailyGiveawayReport', () => {
    // 2026-07-15 08:00 UTC = 03:00 CDT
    const cdt3am = new Date('2026-07-15T08:00:00Z');
    const cdtDate = '2026-07-15';
    // 2026-07-15 07:00 UTC = 02:00 CDT (before DAILY_REPORT_HOUR)
    const cdt2am = new Date('2026-07-15T07:00:00Z');
    // 2026-07-15 09:00 UTC = 04:00 CDT (after DAILY_REPORT_HOUR)
    const cdt4am = new Date('2026-07-15T09:00:00Z');

    it('manual runs always return true, regardless of hour or stamp', () => {
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: true, stamp: cdtDate, now: cdt2am }),
        true,
        'should return true for manual run before 3 AM'
      );
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: true, stamp: cdtDate, now: cdt3am }),
        true,
        'should return true for manual run at 3 AM'
      );
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: true, stamp: cdtDate, now: cdt4am }),
        true,
        'should return true for manual run after 3 AM'
      );
    });

    it('returns false when hour < DAILY_REPORT_HOUR (02:59 CDT)', () => {
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '', now: cdt2am }),
        false
      );
    });

    it('returns true at DAILY_REPORT_HOUR (03:00 CDT) with empty/no prior stamp', () => {
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '', now: cdt3am }),
        true
      );
    });

    it('returns true at DAILY_REPORT_HOUR with a stale stamp from yesterday', () => {
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '2026-07-14', now: cdt3am }),
        true,
        'should send when stamp is from a previous day'
      );
    });

    it('returns false when stamp matches today (already sent this day)', () => {
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: cdtDate, now: cdt3am }),
        false,
        'should not send if today\'s report was already sent'
      );
    });

    it('self-heals at 04:00 when 03:00 run was missed', () => {
      // If the 03:00 run missed or failed, the 04:00 run can still fire
      // if the stamp is stale.
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '2026-07-14', now: cdt4am }),
        true,
        'should send at 04:00 if 03:00 was missed (stamp still yesterday)'
      );
      // But if 03:00 did run and wrote the stamp, 04:00 doesn't repeat it.
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: cdtDate, now: cdt4am }),
        false,
        'should not send at 04:00 if 03:00 already sent (stamp is today)'
      );
    });

    it('uses DAILY_REPORT_HOUR constant (currently 3)', () => {
      assert.equal(DAILY_REPORT_HOUR, 3);
    });

    it('handles CST correctly: 09:00 UTC = 03:00 CST = 2026-01-15', () => {
      const cst3am = new Date('2026-01-15T09:00:00Z');
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '2026-01-14', now: cst3am }),
        true,
        'should send during winter (CST) at 03:00'
      );
    });

    it('distinguishes hour boundaries precisely', () => {
      // 07:59 UTC = 02:59 CDT (not yet 3 AM)
      const cdt259am = new Date('2026-07-15T07:59:59Z');
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '', now: cdt259am }),
        false,
        '02:59 should not trigger'
      );

      // 08:00 UTC = 03:00 CDT (exactly 3 AM)
      assert.equal(
        shouldSendDailyGiveawayReport({ isManualRun: false, stamp: '', now: cdt3am }),
        true,
        '03:00 should trigger'
      );
    });
  });

  describe('getHourStamp', () => {
    it('returns the UTC YYYY-MM-DDTHH bucket', () => {
      assert.equal(getHourStamp(new Date('2026-10-10T07:52:00Z')), '2026-10-10T07');
    });

    it('is stable across different minutes within the same UTC hour', () => {
      assert.equal(
        getHourStamp(new Date('2026-10-10T07:07:00Z')),
        getHourStamp(new Date('2026-10-10T07:52:59Z'))
      );
    });

    it('changes across an hour boundary even one second apart', () => {
      assert.notEqual(
        getHourStamp(new Date('2026-10-10T07:59:59Z')),
        getHourStamp(new Date('2026-10-10T08:00:00Z'))
      );
    });

    it('does not repeat across the DST fall-back UTC hour (UTC has no repeated hours)', () => {
      // Local Central time repeats 01:00 CDT -> 01:00 CST on fall-back, but the
      // UTC moment never repeats, so the stamp must differ.
      assert.notEqual(
        getHourStamp(new Date('2026-11-01T06:30:00Z')),
        getHourStamp(new Date('2026-11-01T07:30:00Z'))
      );
    });
  });

  describe('shouldSendHourlyStatusReport', () => {
    const t1 = new Date('2026-10-10T07:07:00Z');   // first 15-min tick of hour 07
    const t2 = new Date('2026-10-10T07:22:00Z');   // second tick, same hour
    const t3 = new Date('2026-10-10T08:07:00Z');   // first tick of the NEXT hour

    it('manual runs always return true, regardless of stamp', () => {
      assert.equal(
        shouldSendHourlyStatusReport({ isManualRun: true, stamp: getHourStamp(t1), now: t1 }),
        true
      );
    });

    it('returns true on the first run of an hour with no prior stamp', () => {
      assert.equal(
        shouldSendHourlyStatusReport({ isManualRun: false, stamp: '', now: t1 }),
        true
      );
    });

    it('returns false on a later 15-min run within the same hour once sent', () => {
      const stampAfterFirstSend = getHourStamp(t1);
      assert.equal(
        shouldSendHourlyStatusReport({ isManualRun: false, stamp: stampAfterFirstSend, now: t2 }),
        false,
        'second tick in the same UTC hour should skip'
      );
    });

    it('returns true again on the first run of the next hour', () => {
      const stampFromPriorHour = getHourStamp(t1);
      assert.equal(
        shouldSendHourlyStatusReport({ isManualRun: false, stamp: stampFromPriorHour, now: t3 }),
        true,
        'new UTC hour should send even though an earlier hour already sent'
      );
    });

    it('self-heals when the first tick of an hour was dropped: second tick still sends', () => {
      // Stamp still shows the PREVIOUS hour (the :07 run never happened), so the
      // :22 run of the new hour must still dispatch.
      const staleStamp = getHourStamp(new Date('2026-10-10T06:52:00Z'));
      assert.equal(
        shouldSendHourlyStatusReport({ isManualRun: false, stamp: staleStamp, now: t2 }),
        true,
        'a stale stamp from an earlier hour must still trigger a send'
      );
    });
  });

  describe('resolveIsManualRun', () => {
    it('treats a local run (no GITHUB_EVENT_NAME) as manual', () => {
      assert.equal(resolveIsManualRun({}), true, 'dev/local runs should get a full report');
    });

    it('treats a native schedule run as NOT manual', () => {
      assert.equal(resolveIsManualRun({ GITHUB_EVENT_NAME: 'schedule' }), false);
    });

    it('treats an external scheduler dispatch (trigger=scheduled) as NOT manual', () => {
      // This is the cron-job.org caller: it must be gated exactly like native
      // cron, otherwise every 15-minute call sends a full digest.
      assert.equal(
        resolveIsManualRun({
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_TRIGGER: 'scheduled'
        }),
        false,
        'external scheduled dispatches must obey the hourly/daily gates'
      );
    });

    it('treats an operator dispatch with trigger=manual as manual', () => {
      assert.equal(
        resolveIsManualRun({
          GITHUB_EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_TRIGGER: 'manual'
        }),
        true
      );
    });

    it('treats a dispatch with no trigger input as manual (backwards compatible)', () => {
      // Runs dispatched before the `trigger` input existed, or via an API call
      // that omits inputs entirely, must keep the old full-report behavior.
      assert.equal(
        resolveIsManualRun({ GITHUB_EVENT_NAME: 'workflow_dispatch' }),
        true,
        'omitting the input must not silently gate an operator run'
      );
    });

    it('treats a dispatch with an empty-string trigger as manual', () => {
      // GitHub substitutes an empty string for an unset input expression, so
      // this is what a dispatch without the input actually looks like in env.
      assert.equal(
        resolveIsManualRun({ GITHUB_EVENT_NAME: 'workflow_dispatch', WORKFLOW_TRIGGER: '' }),
        true
      );
    });

    it('treats any other event (e.g. push) as NOT manual', () => {
      assert.equal(resolveIsManualRun({ GITHUB_EVENT_NAME: 'push' }), false);
    });

    it('only the exact string "scheduled" gates a dispatch', () => {
      // Guard against a typo in the external scheduler's payload silently
      // turning every call into a spamming manual run.
      for (const value of ['Scheduled', 'SCHEDULED', 'cron', 'auto', 'scheduled ']) {
        assert.equal(
          resolveIsManualRun({ GITHUB_EVENT_NAME: 'workflow_dispatch', WORKFLOW_TRIGGER: value }),
          true,
          `"${value}" should not be mistaken for "scheduled"`
        );
      }
    });
  });

  describe('shouldRunGiveawaySwap', () => {
    // 2026-07-15 06:00 UTC = 01:00 CDT (before GIVEAWAY_SWAP_HOUR)
    const cdt1am = new Date('2026-07-15T06:00:00Z');
    // 2026-07-15 07:00 UTC = 02:00 CDT (at GIVEAWAY_SWAP_HOUR)
    const cdt2am = new Date('2026-07-15T07:00:00Z');
    // 2026-07-15 08:00 UTC = 03:00 CDT (after GIVEAWAY_SWAP_HOUR)
    const cdt3am = new Date('2026-07-15T08:00:00Z');
    const cdtDate = '2026-07-15';

    it('GIVEAWAY_SWAP_HOUR is 2 (02:00 Chicago)', () => {
      assert.equal(GIVEAWAY_SWAP_HOUR, 2);
    });

    it('returns false when hour < GIVEAWAY_SWAP_HOUR (01:00 CDT)', () => {
      assert.equal(
        shouldRunGiveawaySwap({ stamp: '', now: cdt1am }),
        false
      );
    });

    it('returns true at GIVEAWAY_SWAP_HOUR (02:00 CDT) with empty/no prior stamp', () => {
      assert.equal(
        shouldRunGiveawaySwap({ stamp: '', now: cdt2am }),
        true
      );
    });

    it('returns true after GIVEAWAY_SWAP_HOUR with a stale stamp from yesterday', () => {
      assert.equal(
        shouldRunGiveawaySwap({ stamp: '2026-07-14', now: cdt3am }),
        true,
        'should swap when stamp is from a previous day'
      );
    });

    it('returns false when stamp matches today (already swapped this day)', () => {
      assert.equal(
        shouldRunGiveawaySwap({ stamp: cdtDate, now: cdt3am }),
        false,
        'should not re-swap if today\'s swap already fired'
      );
    });

    it('self-heals: a later tick still swaps if an earlier tick was missed', () => {
      assert.equal(
        shouldRunGiveawaySwap({ stamp: '2026-07-14', now: cdt3am }),
        true,
        'stale stamp means the 02:00 tick was missed, 03:00 should still fire'
      );
    });

    it('has no isManualRun bypass — unlike the report gate, every caller respects the gate', () => {
      // The swap mutates live storefront data, so (per design) a manual
      // workflow_dispatch does NOT skip the 02:00 Chicago gate the way
      // shouldSendDailyGiveawayReport's isManualRun does. Passing an
      // isManualRun-shaped key has no effect — the function doesn't accept one.
      assert.equal(
        shouldRunGiveawaySwap({ stamp: cdtDate, now: cdt1am, isManualRun: true }),
        false,
        'gate stays closed before 02:00 regardless of any manual flag'
      );
      assert.equal(
        shouldRunGiveawaySwap({ stamp: cdtDate, now: cdt3am, isManualRun: true }),
        false,
        'gate stays closed once already stamped today, regardless of any manual flag'
      );
    });

    it('DST: 02:00 CST (winter) gates the same as 02:00 CDT (summer)', () => {
      // 2026-01-15 08:00 UTC = 02:00 CST (UTC-6, no DST)
      const cst2am = new Date('2026-01-15T08:00:00Z');
      assert.equal(
        shouldRunGiveawaySwap({ stamp: '', now: cst2am }),
        true,
        'gate should open at 02:00 local time regardless of DST offset'
      );
    });
  });
});
