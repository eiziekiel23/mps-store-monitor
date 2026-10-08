import { test, expect } from '../base.js';
import { fetchDisplayedInventory } from '../../src/admin.js';
import config from '../../config/monitor.config.js';

test.describe('Product Stock Availability', () => {
  /** Products displayed on the store that use DENY inventory policy. */
  let denyProducts = null;
  let fetchError = null;

  test.beforeAll(async ({}, workerInfo) => {
    // Admin API check runs once on desktop-chrome. The mobile worker skips the
    // fetch here (and the test body skips via project guard below), so we never
    // hit the API twice. aggregateChecks worst-wins: passed + skipped → passed,
    // so the skipped mobile result never triggers an alert.
    if (workerInfo.project.name !== 'desktop-chrome') return;

    const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
    if (!token) return;

    try {
      const { displayed } = await fetchDisplayedInventory({
        shop: config.admin.shop,
        token,
        version: config.admin.apiVersion
      });

      // We only care about products that can ACTUALLY sell out:
      //   • inventoryPolicy DENY: Shopify blocks checkout when qty hits 0.
      //   • inventoryPolicy CONTINUE: oversell is intentional (booster boxes
      //     may show deeply negative qty and are still purchasable).
      //
      // Additional exclusions:
      //   • config.stock.exclusionsRegex  — passes, protection, golden tickets
      //   • config.stock.knownSoldOut     — limited items intentionally sold out
      //     at the time this list was seeded; update it when products restock.
      denyProducts = displayed.filter(
        (p) =>
          !config.stock.exclusionsRegex.test(p.title) &&
          !config.stock.knownSoldOut.includes(p.handle) &&
          p.variants.some((v) => v.inventoryPolicy === 'DENY')
      );
    } catch (err) {
      fetchError = err.message;
    }
  });

  test('stock.all: every displayed DENY-policy product has at least one available variant', {
    annotation: { type: 'check', description: 'stock.all' }
  }, async ({}, testInfo) => {
    // Project guard — skip on mobile so this pure-API check runs exactly once.
    test.skip(testInfo.project.name !== 'desktop-chrome', 'stock.all runs once on desktop-chrome only');

    // Without a token there is nothing to assert. Skip rather than fail so that
    // a missing-token environment (local dev without .env) stays green.
    test.skip(!process.env.SHOPIFY_ADMIN_API_TOKEN, 'SHOPIFY_ADMIN_API_TOKEN not set — skipping stock check');

    expect(fetchError, `Admin API fetch failed: ${fetchError}`).toBeNull();
    expect(denyProducts, 'Admin API returned no product data').toBeTruthy();
    expect(denyProducts.length, 'No DENY-policy products are tracked — check filter config').toBeGreaterThan(0);

    // Log the full tracked set for the audit trail.
    console.log(`stock.all: tracking ${denyProducts.length} displayed DENY-policy products`);

    // A product is "out of stock" when NONE of its variants reports availableForSale.
    // availableForSale already folds in inventoryPolicy: a DENY variant with qty ≤ 0
    // returns false; a CONTINUE variant always returns true.
    const outOfStock = denyProducts
      .filter((p) => !p.variants.some((v) => v.availableForSale))
      .map((p) => `${p.title} (${p.handle})`);

    if (outOfStock.length) {
      console.log(`stock.all: out-of-stock products:\n  ${outOfStock.join('\n  ')}`);
    }

    expect(
      outOfStock,
      `${outOfStock.length} of ${denyProducts.length} tracked DENY-policy products are out of stock:\n` +
        outOfStock.map((s) => `  • ${s}`).join('\n')
    ).toHaveLength(0);
  });
});
