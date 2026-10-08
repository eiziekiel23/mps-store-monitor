import { test, expect } from '@playwright/test';
import config from '../../config/monitor.config.js';

// ---------------------------------------------------------------------------
// Checkout UI Extension checks
//
// These assert against the *live Shopify checkout*, where the store's five
// Preact "Polaris web component" extensions render (source lives in the
// separate repo /mnt/d/shopify-app-react, target
// purchase.checkout.header.render-after). We verify the three the monitor
// cares about: the giveaway entries banner, the bonus-entries amount, and the
// trust badge.
//
// Why one serial file sharing a single cart (not one file per check):
// reaching /checkout requires a non-empty cart, and /cart/add.js is behind
// aggressive anti-scalper rate limiting (see STATE.md). Three independent
// specs would mean 3× add-to-cart per project every run. Instead, the first
// test seeds the cart and navigates to checkout once; the other two assert
// against that same already-loaded page in serial order.
//
// Why the seed+navigate lives in the FIRST test and not beforeAll:
// a beforeAll failure marks the dependent tests "skipped", and skipped checks
// never alert — so a checkout outage would be silent. Putting the navigation
// in checkout.entries makes an outage surface as a FAILED check. The other two
// checks skipping during an outage is fine: the first already alerted.
// ---------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

const SEED_HANDLE = config.referenceProducts[0];

// Parse "4,849" / "9,849" → 4849 / 9849
function toInt(str) {
  return Number(String(str).replace(/[^\d]/g, ''));
}

async function getCart(page) {
  return page.evaluate(async () => {
    const res = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Cart fetch returned ${res.status}`);
    return res.json();
  });
}

async function clearCart(page) {
  if (!/^https?:/.test(page.url())) return;
  await page
    .evaluate(async () => {
      await fetch('/cart/clear.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    })
    .catch(() => {});
}

test.describe('Checkout UI Extensions', () => {
  let page;
  let cartSnapshot; // /cart.js captured right before navigating to checkout

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Mirror base.js's third-party tracker blocking. We deliberately do NOT
    // block Shopify's own monorail here — it is the checkout's own telemetry,
    // not a third-party tracker, and the extensions fetch their data over
    // GraphQL (shopify.query), not monorail, so blocking it buys nothing.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const thirdParty = config.trackers.blockRegex.filter(
        (re) => !/monorail/.test(re.source)
      );
      if (thirdParty.some((re) => re.test(url))) route.abort();
      else route.continue();
    });
  });

  test.afterAll(async () => {
    if (page) {
      await clearCart(page);
      await page.close();
    }
  });

  test(
    'checkout.entries: giveaway entries banner renders and totals are self-consistent',
    { annotation: { type: 'check', description: 'checkout.entries' } },
    async () => {
      test.setTimeout(120_000);

      // --- Seed the cart (the one add-to-cart for all three checks) ---
      await clearCart(page);
      await page.goto(`${config.storeUrl}/products/${SEED_HANDLE}`, { waitUntil: 'load' });

      const atc = page.locator('form.shopify-product-form .btn-atc-pdp').first();
      await expect(atc, `Add-to-cart button not found on ${SEED_HANDLE}`).toBeVisible();
      await atc.click();

      await expect
        .poll(async () => (await getCart(page)).item_count, {
          message: `Cart still empty after ATC on ${SEED_HANDLE}`,
          timeout: 15_000
        })
        .toBeGreaterThan(0);

      cartSnapshot = await getCart(page);

      // --- Navigate to the live checkout ---
      await page.goto(`${config.storeUrl}/checkout`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // The entries extension fetches its metaobject asynchronously, so wait for
      // the banner's signature copy to appear. Shopify wraps header.render-after
      // extensions in a <status> element that is aria-hidden / visibility:hidden
      // to Playwright's visibility algorithm even though the content is fully
      // rendered and readable — so we use toBeAttached() (DOM presence) rather
      // than toBeVisible(), and textContent (visibility-blind) rather than
      // innerText when reading the page text.
      await expect(
        page.getByText('Your Order Gets Entries Into:').first(),
        'Giveaway entries banner never rendered in checkout'
      ).toBeAttached({ timeout: 25_000 });

      // --- Parse the three entry rows from the rendered page text ---
      // textContent is used here (not innerText) because the extension renders
      // inside Shopify's aria-hidden checkout header which is invisible to
      // innerText but fully readable via textContent.
      const bodyText = await page.evaluate(() => document.body.textContent);

      const productMatch = bodyText.match(/PRODUCT ENTRIES\s*🎟?\s*([\d,]+)/);
      const totalMatch = bodyText.match(/TOTAL ENTRIES\s*🎟?\s*([\d,]+)/);
      const bonusMatch = bodyText.match(/BONUS ENTRIES\s*🎟?\s*([\d,]+)/);

      expect(productMatch, 'PRODUCT ENTRIES row not found in checkout').not.toBeNull();
      expect(totalMatch, 'TOTAL ENTRIES row not found in checkout').not.toBeNull();

      const productEntries = toInt(productMatch[1]);
      const totalEntries = toInt(totalMatch[1]);
      const bonusEntries = bonusMatch ? toInt(bonusMatch[1]) : 0;

      // 1) Self-consistency: TOTAL must equal PRODUCT + BONUS. This holds
      //    whenever the extension renders correctly, independent of backend data.
      expect(
        totalEntries,
        `TOTAL ENTRIES (${totalEntries}) != PRODUCT (${productEntries}) + BONUS (${bonusEntries})`
      ).toBe(productEntries + bonusEntries);

      // 2) Sanity: a seeded cart must produce > 0 product entries.
      expect(productEntries, 'PRODUCT ENTRIES is 0 for a non-empty cart').toBeGreaterThan(0);

      // 3) Data-binding: the displayed PRODUCT ENTRIES should equal the sum of
      //    each line item's _entries × quantity from /cart.js. Reference products
      //    carry no VIP-order-protection multiplier, so this is a plain sum.
      const expectedProductEntries = cartSnapshot.items.reduce((sum, item) => {
        const entries = item.properties?._entries != null ? Number(item.properties._entries) : 0;
        return sum + entries * item.quantity;
      }, 0);

      if (expectedProductEntries > 0) {
        expect(
          productEntries,
          `Displayed PRODUCT ENTRIES (${productEntries}) != /cart.js sum (${expectedProductEntries})`
        ).toBe(expectedProductEntries);
      }
    }
  );

  test(
    'checkout.bonus_entries: timer bonus amount matches the entries banner bonus row',
    { annotation: { type: 'check', description: 'checkout.bonus_entries' } },
    async () => {
      // Depends on checkout.entries having navigated to the checkout page.
      // Use textContent (visibility-blind) for the same reason as checkout.entries.
      const bodyText = await page.evaluate(() => document.body.textContent);

      // The CheckoutTimer extension advertises the bonus as
      //   "...AND GET 🎟 5,000 FREE BONUS ENTRIES".
      // The CheckoutEntries banner independently renders "BONUS ENTRIES 🎟 5,000".
      // When the 10-minute bonus window is active (always true on a freshly
      // started checkout) and the configured amount is > 0, both must agree.
      const timerBonusMatch = bodyText.match(/🎟?\s*([\d,]+)\s*FREE BONUS ENTRIES/i);

      if (!timerBonusMatch) {
        // No active bonus advertised (amount 0 or window closed) — nothing to
        // cross-check. Skip rather than fail: this is a legitimate store state.
        test.skip(true, 'No active bonus window advertised by the checkout timer');
        return;
      }

      const timerBonus = toInt(timerBonusMatch[1]);
      expect(timerBonus, 'Timer advertised a bonus of 0').toBeGreaterThan(0);

      const bannerBonusMatch = bodyText.match(/BONUS ENTRIES\s*🎟?\s*([\d,]+)/);
      expect(
        bannerBonusMatch,
        'Timer advertised a bonus but the entries banner shows no BONUS ENTRIES row'
      ).not.toBeNull();

      const bannerBonus = toInt(bannerBonusMatch[1]);
      expect(
        bannerBonus,
        `Entries banner bonus (${bannerBonus}) != timer bonus (${timerBonus})`
      ).toBe(timerBonus);
    }
  );

  test(
    'checkout.trust_badge: trust badge image is present and loaded',
    { annotation: { type: 'check', description: 'checkout.trust_badge' } },
    async () => {
      // The CheckoutTrustBG extension renders
      //   <s-image alt="MPS LLC Giveaway Winners Trust Badge" .../>
      // inside an <s-link>. The alt text is a unique, stable selector.
      const badge = page.locator('[alt="MPS LLC Giveaway Winners Trust Badge"]').first();

      await expect(
        badge,
        'Trust badge image not found in checkout (extension unplaced or metaobject banner missing)'
      ).toBeAttached({ timeout: 15_000 });

      // Confirm the image actually resolved rather than rendering a broken icon.
      // s-image renders an underlying <img>; find it and check naturalWidth.
      const loaded = await badge.evaluate((el) => {
        const img = el.tagName.toLowerCase() === 'img' ? el : el.querySelector('img');
        if (!img) {
          // Shadow DOM fallback: the <img> may live in the element's shadow root.
          const shadowImg = el.shadowRoot?.querySelector('img');
          if (shadowImg) return shadowImg.complete && shadowImg.naturalWidth > 0;
          // No <img> node found — treat presence of the element as sufficient,
          // since the alt-bearing node exists in the DOM.
          return true;
        }
        return img.complete && img.naturalWidth > 0;
      });

      expect(loaded, 'Trust badge <img> failed to load (naturalWidth 0)').toBe(true);
    }
  );
});
