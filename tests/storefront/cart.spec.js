import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the current Shopify cart via the AJAX API.
 * Returns the raw cart object or throws on non-2xx.
 * Uses page.evaluate(fetch) instead of page.request.get to bypass Cloudflare
 * bot management: Cloudflare's TLS fingerprinting blocks bare HTTP clients
 * (page.request uses Node.js HTTP module) but allows real browser fetches.
 */
async function getCart(page) {
  const response = await page.evaluate(async () => {
    const res = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Cart fetch returned ${res.status}`);
    return res.json();
  });
  return response;
}

/**
 * Clear the cart so each test run starts clean.
 * Uses Shopify's /cart/clear.js endpoint via in-page fetch to bypass Cloudflare
 * bot management (same reason as getCart; see comments there).
 */
async function clearCart(page) {
  try {
    const res = await page.evaluate(async () => {
      const response = await fetch('/cart/clear.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      return { status: response.status, ok: response.ok };
    });
    // 200 or 204 both mean "cleared"; anything else is a problem, but we don't
    // want a cleanup failure to mask the actual test result, so just log.
    if (!res.ok) {
      console.warn(`cart/clear.js returned ${res.status} — cart may not be clean`);
    }
  } catch (err) {
    console.warn(`cart/clear.js failed: ${err.message} — cart may not be clean`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Cart', () => {
  // Note: no shared beforeAll clear — each worker/page has its own session
  // cookie, so every test clears its own cart inline instead.

  test('cart.add_pdp: adding each reference product via PDP puts it in /cart.js', {
    annotation: { type: 'check', description: 'cart.add_pdp' }
  }, async ({ page }) => {
    test.setTimeout(120_000);

    for (const handle of config.referenceProducts) {
      await clearCart(page);

      await page.goto(`/products/${handle}`, { waitUntil: 'load' });

      // The Booster Theme renders the ATC as a <div class="btn-atc-pdp …">
      // inside form.shopify-product-form — NOT a <button> — so neither
      // getByRole('button') nor button[name="add"] match it. The class
      // btn-atc-pdp is the unique identifier across product-page variants.
      const atcButton = page.locator('form.shopify-product-form .btn-atc-pdp').first();
      await expect(atcButton, `Add-to-cart button not found on ${handle}`).toBeVisible();
      await atcButton.click();

      // Wait until the cart actually reflects the new item — poll /cart.js
      // instead of waiting for a UI element because minicart behaviour is
      // animation-driven and varies by viewport.
      await expect
        .poll(async () => (await getCart(page)).item_count, {
          message: `Cart still empty after clicking ATC on ${handle}`,
          timeout: 15_000
        })
        .toBeGreaterThan(0);

      const cart = await getCart(page);
      const found = cart.items.some(item => item.handle === handle);
      expect(found, `${handle} not found in cart after add-to-cart`).toBe(true);

      await clearCart(page);
    }
  });

  test('cart.entries: displayed entries per line item match Σ _entries × quantity from /cart.js', {
    annotation: { type: 'check', description: 'cart.entries' }
  }, async ({ page }) => {
    test.setTimeout(120_000);

    await clearCart(page);

    // Seed the cart with the first reference product before checking the UI.
    const seedHandle = config.referenceProducts[0];
    await page.goto(`/products/${seedHandle}`, { waitUntil: 'load' });

    const atcButton = page.locator('form.shopify-product-form .btn-atc-pdp').first();
    await expect(atcButton, `Add-to-cart button not found on ${seedHandle}`).toBeVisible();
    await atcButton.click();

    await expect
      .poll(async () => (await getCart(page)).item_count, {
        message: `Cart still empty after seeding with ${seedHandle}`,
        timeout: 15_000
      })
      .toBeGreaterThan(0);

    // Navigate to the /cart page which renders item.properties._entries
    // via the Liquid template as data-computed-price="<_entries * qty>".
    await page.goto('/cart', { waitUntil: 'load' });

    const cart = await getCart(page);

    // Build a map: variant_id -> expected entries * qty from the API
    const expectedEntries = new Map();
    let totalExpected = 0;
    for (const item of cart.items) {
      const entriesProp = item.properties?._entries;
      if (entriesProp != null) {
        const n = Number(entriesProp) * item.quantity;
        expectedEntries.set(item.variant_id, n);
        totalExpected += n;
      }
    }

    if (expectedEntries.size === 0) {
      // The reference product has no _entries property on its current variant;
      // this means the store is not attaching entry counts to this product right now.
      // Fail explicitly so this misconfiguration is visible.
      throw new Error(
        `Reference product ${seedHandle} has no _entries property in the cart. ` +
        `Check that the product is correctly tagged for giveaway entry tracking.`
      );
    }

    // The theme renders entries as data-computed-price="<number>" on each
    // line item row in the cart.
    const entryNodes = page.locator('[data-computed-price]');
    const count = await entryNodes.count();
    expect(count, 'No data-computed-price elements found in /cart').toBeGreaterThan(0);

    // Sum up all the displayed entries values from the DOM
    const displayedTotal = await entryNodes.evaluateAll(nodes =>
      nodes.reduce((sum, node) => {
        const v = node.getAttribute('data-computed-price');
        const n = v != null ? Number(v) : 0;
        return sum + n;
      }, 0)
    );

    // Allow ± 0 tolerance: entries are integers and the formula is exact.
    expect(
      displayedTotal,
      `Cart entries display (${displayedTotal}) does not match API sum (${totalExpected})`
    ).toBe(totalExpected);

    await clearCart(page);
  });
});
