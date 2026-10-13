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

  test('swaps when gate open and fields staged, leaves staging intact', async () => {
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
      // Mutation: promote staged fields to live (no clear follows — staging is left intact)
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

  // ── Schema-compliance regression guard ──────────────────────────────────────
  // A mocked fetcher cannot enforce Shopify's GraphQL schema, which is how an
  // earlier implementation shipped a clear step built from `fields: [{key,
  // value: null}]`. That payload is invalid: MetaobjectFieldInput.value is
  // String! (non-null), so GraphQL rejects it at variable-validation time for
  // EVERY field type — confirmed by live introspection, 2026-10-11. The promote
  // succeeded and only the clear threw, which sent a FAILED alert and skipped
  // the stamp write even though the live giveaway had updated correctly.
  //
  // These tests assert on the request PAYLOADS rather than the return value, so
  // the write mode can't be accidentally regressed. As of 2026-10-13 the staging
  // entry is left intact after a swap, so only one mutation should occur:
  //   - live entry  → `fields` (sparse: must not touch the 19 monthly fields)
  //   - staging entry → NO write (values retained as a persistent template)
  test('uses sparse `fields` for live promote and does NOT write staging', async () => {
    const requests = [];
    const responses = [
      // Query 1: upcoming entry, two fields staged
      {
        data: {
          metaobjectByHandle: {
            id: 'gid://shopify/Metaobject/upcoming',
            handle: 'upcoming-flash-giveaway',
            type: 'upcoming_flash_giveaway',
            fields: [
              { key: 'flash_giveaway_end_date', value: 'October 15, 2026 02:00:00' },
              { key: 'pdp_images', value: '["gid://shopify/MediaImage/1"]' }
            ]
          }
        }
      },
      // Query 2: live entry
      {
        data: {
          metaobjectByHandle: {
            id: 'gid://shopify/Metaobject/live',
            handle: 'mps-giveaway',
            type: 'giveaway',
            fields: [
              { key: 'flash_giveaway_end_date', value: 'October 14, 2026 02:00:00' },
              { key: 'pdp_images', value: '["gid://shopify/MediaImage/0"]' },
              { key: 'prize_text', value: 'Monthly prize' }
            ]
          }
        }
      },
      // Mutation: promote to live (only mutation — staging is NOT cleared)
      {
        data: {
          metaobjectUpdate: {
            metaobject: { id: 'gid://shopify/Metaobject/live', handle: 'mps-giveaway', fields: [] },
            userErrors: []
          }
        }
      }
    ];

    const recordingFetcher = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const json = responses[requests.length - 1];
      return { ok: true, status: 200, text: async () => '', json: async () => json };
    };

    const result = await runGiveawaySwap({
      shop: 'test.myshopify.com',
      token: 'test-token',
      now: cdt3am,
      stamp: '',
      fetcher: recordingFetcher
    });

    assert.equal(result.ran, true);
    assert.equal(requests.length, 3, 'expected 2 reads + 1 mutation (no staging clear)');

    const promote = requests[2].variables;

    // Promote targets the LIVE entry with a sparse `fields` write.
    assert.equal(promote.id, 'gid://shopify/Metaobject/live');
    assert.ok(Array.isArray(promote.metaobject.fields), 'promote must use `fields`');
    assert.equal(
      promote.metaobject.values,
      undefined,
      'promote must NOT use `values` — a full replacement would wipe the monthly fields'
    );
    assert.deepEqual(promote.metaobject.fields, [
      { key: 'flash_giveaway_end_date', value: 'October 15, 2026 02:00:00' },
      { key: 'pdp_images', value: '["gid://shopify/MediaImage/1"]' }
    ]);

    // Staging must NOT be written: no request should target the upcoming GID.
    const stagingWrite = requests.find(
      (r) => r.variables?.id === 'gid://shopify/Metaobject/upcoming'
        && r.variables?.metaobject != null
    );
    assert.equal(
      stagingWrite,
      undefined,
      'staging entry must not be written — values are retained as a persistent template'
    );

    // The specific regression: no null value may ever be sent on a `fields` write.
    for (const req of requests) {
      for (const field of req.variables?.metaobject?.fields ?? []) {
        assert.notEqual(
          field.value,
          null,
          `MetaobjectFieldInput.value is String! — null is schema-invalid (key: ${field.key})`
        );
      }
    }
  });
});
