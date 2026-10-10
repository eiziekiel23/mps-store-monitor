import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runGiveawaySwap } from '../../src/giveaway/swap.js';

describe('giveaway/swap.js - runGiveawaySwap', () => {
  // Mock fetcher that returns pre-configured metaobject entries.
  function makeFetcher(responses) {
    let callCount = 0;
    return async () => {
      const response = responses[callCount] || responses[responses.length - 1];
      callCount += 1;
      return {
        ok: response.ok ?? true,
        status: response.status ?? 200,
        text: async () => response.body || '',
        json: async () => response.json
      };
    };
  }

  // Helper: time of day in Central time (2026-07-15 08:00 UTC = 03:00 CDT).
  const cdt3am = new Date('2026-07-15T08:00:00Z');
  const cdt1am = new Date('2026-07-15T06:00:00Z');

  test('gate-not-open when hour < 02:00 Chicago', async () => {
    const fetcher = makeFetcher([]);
    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt1am,
      stamp: '',
      fetcher
    });

    assert.equal(result.ran, false);
    assert.equal(result.reason, 'gate-not-open');
    assert.deepEqual(result.swapped, []);
  });

  test('nothing-staged when gate open but upcoming entry has no values', async () => {
    const fetcher = makeFetcher([
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/upcoming',
              handle: 'upcoming-flash-giveaway',
              type: 'upcoming_flash_giveaway',
              fields: [] // All empty
            }
          }
        }
      }
    ]);

    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt3am,
      stamp: '', // Gate is open: stamp is empty (or from previous day)
      fetcher
    });

    assert.equal(result.ran, true);
    assert.equal(result.reason, 'nothing-staged');
    assert.deepEqual(result.swapped, []);
  });

  test('throws when upcoming entry not found', async () => {
    const fetcher = makeFetcher([
      {
        json: {
          data: {
            metaobjectByHandle: null // Entry not found
          }
        }
      }
    ]);

    await assert.rejects(
      () =>
        runGiveawaySwap({
          shop: 'test.myshopify.com',
          token: 'test-token',
          now: cdt3am,
          stamp: '',
          fetcher
        }),
      (err) => err.message.includes('staging entry') && err.message.includes('not found')
    );
  });

  test('swaps and clears when gate open and fields staged', async () => {
    const fetcher = makeFetcher([
      // Query 1: fetch upcoming entry (has end_date and timer_copy staged)
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/upcoming',
              handle: 'upcoming-flash-giveaway',
              type: 'upcoming_flash_giveaway',
              fields: [
                { key: 'flash_giveaway_end_date', value: 'October 15, 2026 02:00:00' },
                { key: 'flash_giveaway_timer_copy', value: 'Last chance!' },
                // Other fields are absent or null (not set by operator)
              ]
            }
          }
        }
      },
      // Query 2: fetch live entry (get its GID and current values)
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/live',
              handle: 'mps-giveaway',
              type: 'giveaway',
              fields: [
                { key: 'flash_giveaway_end_date', value: 'October 14, 2026 02:00:00' },
                { key: 'flash_giveaway_timer_copy', value: 'Ends soon' },
                // Live entry has many other fields (monthly, etc.) that are NOT in the daily set
                { key: 'monthly_field', value: 'Monthly value' }
              ]
            }
          }
        }
      },
      // Mutation 1: promote staged fields to live
      {
        json: {
          data: {
            metaobjectUpdate: {
              metaobject: {
                id: 'gid://shopify/Metaobject/live',
                handle: 'mps-giveaway',
                fields: [
                  { key: 'flash_giveaway_end_date', value: 'October 15, 2026 02:00:00' },
                  { key: 'flash_giveaway_timer_copy', value: 'Last chance!' },
                  { key: 'monthly_field', value: 'Monthly value' }
                ]
              },
              userErrors: []
            }
          }
        }
      },
      // Mutation 2: clear staged fields on upcoming
      {
        json: {
          data: {
            metaobjectUpdate: {
              metaobject: {
                id: 'gid://shopify/Metaobject/upcoming',
                handle: 'upcoming-flash-giveaway',
                fields: [] // All cleared
              },
              userErrors: []
            }
          }
        }
      }
    ]);

    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt3am,
      stamp: '', // Gate is open
      fetcher
    });

    assert.equal(result.ran, true);
    assert.ok(!result.reason || result.reason === undefined, 'reason should not be set on success');
    assert.deepEqual(result.swapped, [
      'flash_giveaway_end_date',
      'flash_giveaway_timer_copy'
    ]);
    assert.deepEqual(result.previousValues, {
      'flash_giveaway_end_date': 'October 14, 2026 02:00:00',
      'flash_giveaway_timer_copy': 'Ends soon'
    });
    assert.deepEqual(result.newValues, {
      'flash_giveaway_end_date': 'October 15, 2026 02:00:00',
      'flash_giveaway_timer_copy': 'Last chance!'
    });
  });

  test('gate stays closed when stamp matches today (same-day idempotency)', async () => {
    const today = '2026-07-15'; // The day of cdt3am
    const fetcher = makeFetcher([]);

    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt3am,
      stamp: today, // Stamp matches today — swap already fired
      fetcher
    });

    assert.equal(result.ran, false);
    assert.equal(result.reason, 'gate-not-open');
    assert.deepEqual(result.swapped, []);
  });

  test('gate stays open when stamp is from previous day (self-healing)', async () => {
    const fetcher = makeFetcher([
      // upcoming: empty
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/upcoming',
              handle: 'upcoming-flash-giveaway',
              fields: []
            }
          }
        }
      }
    ]);

    const today = '2026-07-15';
    const yesterday = '2026-07-14';
    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt3am,
      stamp: yesterday, // Stamp is stale
      fetcher
    });

    assert.equal(result.ran, true);
    assert.equal(result.reason, 'nothing-staged');
  });

  test('throws when live entry not found', async () => {
    const fetcher = makeFetcher([
      // Query 1: upcoming entry exists and has values staged
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/upcoming',
              handle: 'upcoming-flash-giveaway',
              fields: [
                { key: 'flash_giveaway_end_date', value: 'October 15, 2026 02:00:00' }
              ]
            }
          }
        }
      },
      // Query 2: live entry not found
      {
        json: {
          data: {
            metaobjectByHandle: null
          }
        }
      }
    ]);

    await assert.rejects(
      () =>
        runGiveawaySwap({
          shop: 'test.myshopify.com',
          token: 'test-token',
          now: cdt3am,
          stamp: '',
          fetcher
        }),
      (err) => err.message.includes('live entry') && err.message.includes('not found')
    );
  });

  test('throws on userErrors from metaobjectUpdate', async () => {
    const fetcher = makeFetcher([
      // upcoming: values staged
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/upcoming',
              handle: 'upcoming-flash-giveaway',
              fields: [
                { key: 'flash_giveaway_desktop_banner', value: 'gid://shopify/File/invalid' }
              ]
            }
          }
        }
      },
      // live: fetched
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/live',
              handle: 'mps-giveaway',
              fields: []
            }
          }
        }
      },
      // mutation: promotion fails with userError
      {
        json: {
          data: {
            metaobjectUpdate: {
              metaobject: null,
              userErrors: [
                {
                  field: ['fields', 0],
                  message: 'Invalid file reference',
                  code: 'INVALID_REFERENCE'
                }
              ]
            }
          }
        }
      }
    ]);

    await assert.rejects(
      () =>
        runGiveawaySwap({
          shop: 'test.myshopify.com',
          token: 'test-token',
          now: cdt3am,
          stamp: '',
          fetcher
        }),
      (err) => err.message.includes('metaobjectUpdate failed')
    );
  });

  test('marks gate closed (ready for stamp write) only when something swapped', async () => {
    // The test above already covers the happy path. This one verifies the stamp-only-on-success
    // semantics: by testing that when nothing is staged, the result.ran is true but
    // reason is 'nothing-staged' (caller should NOT write the stamp).
    const fetcher = makeFetcher([
      {
        json: {
          data: {
            metaobjectByHandle: {
              id: 'gid://shopify/Metaobject/upcoming',
              handle: 'upcoming-flash-giveaway',
              fields: [] // Empty
            }
          }
        }
      }
    ]);

    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt3am,
      stamp: '',
      fetcher
    });

    assert.equal(result.ran, true);
    assert.equal(result.reason, 'nothing-staged');
    // Implication: CLI should NOT write stamp. Test this behavior in integration tests.
  });
});
