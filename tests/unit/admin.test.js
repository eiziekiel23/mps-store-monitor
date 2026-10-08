import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDisplayedInventory } from '../../src/admin.js';

describe('admin.js - fetchDisplayedInventory', () => {
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

  test('returns displayed products (onlineStoreUrl non-null only)', async () => {
    const fetcher = makeFetcher([
      {
        json: {
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  handle: 'booster-pack',
                  title: 'Booster Pack',
                  onlineStoreUrl: 'https://example.com/products/booster-pack',
                  tracksInventory: true,
                  totalInventory: 100,
                  variants: {
                    nodes: [
                      {
                        title: 'Default',
                        sku: 'SKU-001',
                        inventoryQuantity: 100,
                        inventoryPolicy: 'DENY',
                        availableForSale: true
                      }
                    ]
                  }
                },
                {
                  handle: 'unpublished-sku',
                  title: 'Subscription (Unpublished)',
                  onlineStoreUrl: null,
                  tracksInventory: false,
                  totalInventory: 0,
                  variants: { nodes: [] }
                }
              ]
            }
          }
        }
      }
    ]);

    const result = await fetchDisplayedInventory({
      shop: 'example.myshopify.com',
      token: 'test-token',
      fetcher
    });

    assert.equal(result.displayed.length, 1);
    assert.equal(result.displayed[0].handle, 'booster-pack');
    assert.equal(result.activeCount, 2, 'activeCount includes unpublished');
  });

  test('handles pagination correctly', async () => {
    const fetcher = makeFetcher([
      {
        json: {
          data: {
            products: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
              nodes: [
                {
                  handle: 'prod-1',
                  title: 'Product 1',
                  onlineStoreUrl: 'https://example.com/products/prod-1',
                  tracksInventory: true,
                  totalInventory: 50,
                  variants: { nodes: [] }
                }
              ]
            }
          }
        }
      },
      {
        json: {
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  handle: 'prod-2',
                  title: 'Product 2',
                  onlineStoreUrl: 'https://example.com/products/prod-2',
                  tracksInventory: false,
                  totalInventory: 0,
                  variants: { nodes: [] }
                }
              ]
            }
          }
        }
      }
    ]);

    const result = await fetchDisplayedInventory({
      shop: 'example.myshopify.com',
      token: 'test-token',
      fetcher
    });

    assert.equal(result.pages, 2);
    assert.equal(result.displayed.length, 2);
  });

  test('handles null/missing fields gracefully', async () => {
    const fetcher = makeFetcher([
      {
        json: {
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  handle: 'minimal',
                  title: 'Minimal Product',
                  onlineStoreUrl: 'https://example.com/products/minimal',
                  tracksInventory: null,
                  totalInventory: null,
                  variants: {
                    nodes: [
                      {
                        title: 'Default',
                        sku: null,
                        inventoryQuantity: null,
                        inventoryPolicy: 'CONTINUE',
                        availableForSale: false
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    ]);

    const result = await fetchDisplayedInventory({
      shop: 'example.myshopify.com',
      token: 'test-token',
      fetcher
    });

    const prod = result.displayed[0];
    assert.equal(prod.tracksInventory, false);
    assert.equal(prod.totalInventory, 0);
    assert.equal(prod.variants[0].sku, '');
    assert.equal(prod.variants[0].inventoryQuantity, 0);
  });

  test('throws on HTTP 401', async () => {
    const fetcher = makeFetcher([{ status: 401, ok: false }]);

    await assert.rejects(
      () =>
        fetchDisplayedInventory({
          shop: 'example.myshopify.com',
          token: 'bad-token',
          fetcher
        }),
      (err) => err.message.includes('HTTP 401')
    );
  });

  test('throws on GraphQL errors', async () => {
    const fetcher = makeFetcher([
      {
        json: {
          data: null,
          errors: [{ message: 'Invalid query' }]
        }
      }
    ]);

    await assert.rejects(
      () =>
        fetchDisplayedInventory({
          shop: 'example.myshopify.com',
          token: 'test-token',
          fetcher
        }),
      (err) => err.message.includes('GraphQL error')
    );
  });

  test('throws if token is missing', async () => {
    await assert.rejects(
      () =>
        fetchDisplayedInventory({
          shop: 'example.myshopify.com',
          token: '',
          fetcher: () => Promise.resolve({ ok: true, json: () => ({}) })
        }),
      (err) => err.message.includes('token is required')
    );
  });
});
