import { test, expect } from '../base.js';
import { fetchSnapshot } from '../../src/snapshot.js';
import config from '../../config/monitor.config.js';

test.describe('Product Stock Availability', () => {
  let products = null;
  let fetchError = null;

  test.beforeAll(async () => {
    const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
    if (!token) return;
    try {
      const snapshot = await fetchSnapshot({
        storeUrl: config.storeUrl,
        storefrontToken: token
      });
      products = snapshot.products;
    } catch (err) {
      fetchError = err.message;
    }
  });

  test('stock.all: every published product has at least one available variant', {
    annotation: { type: 'check', description: 'stock.all' }
  }, async () => {
    // This check is purely Storefront-API driven (no browser needed), but it
    // lives in the Playwright suite so the reporter picks it up like any other
    // check. Without a token there is nothing to assert, so skip rather than
    // fail: aggregateChecks ranks "skipped" lowest, so it never raises an alert.
    test.skip(!process.env.SHOPIFY_STOREFRONT_TOKEN, 'SHOPIFY_STOREFRONT_TOKEN not set');

    expect(fetchError, `Storefront snapshot fetch failed: ${fetchError}`).toBeNull();
    expect(products, 'Snapshot returned no product list').toBeTruthy();
    expect(products.length, 'Snapshot returned an empty product list').toBeGreaterThan(0);

    // Some products are intentionally never "in stock" — add-on passes, order
    // protection, and the golden ticket. They are excluded by title regex so
    // they do not permanently redden this check.
    const tracked = products.filter(p => !config.stock.exclusionsRegex.test(p.title));

    // availableForSale is true when the product has >=1 purchasable variant,
    // which is exactly the condition this check asserts.
    const outOfStock = tracked.filter(p => !p.available).map(p => `${p.title} (${p.handle})`);

    expect(
      outOfStock,
      `${outOfStock.length} of ${tracked.length} tracked products are out of stock: ${outOfStock.join(', ')}`
    ).toHaveLength(0);
  });
});
