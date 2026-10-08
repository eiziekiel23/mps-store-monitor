import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Product Page Giveaway Brand', () => {
  for (const handle of config.referenceProducts) {
    test(`product.giveaway_images: giveaway brand loads on ${handle}`, {
      annotation: { type: 'check', description: 'product.giveaway_images' }
    }, async ({ page }) => {
      await page.goto(`/products/${handle}`, { waitUntil: 'load' });

      // The theme renders the giveaway section on each product page using
      // three responsive <img> variants: give-away-desktop-banner-*, give-away-tablet-banner-*,
      // give-away-mobile-banner-*. All carry a "give-away-" class prefix.
      const locator = page.locator('img[class*="give-away-"]');

      const count = await locator.count();
      expect(count, `Giveaway banner images not found on ${handle}`).toBeGreaterThan(0);

      // Scroll to trigger lazy-load for off-screen images, then give the
      // browser a moment to decode them before checking naturalWidth.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.scrollTo(0, 0));

      // Only flag images that are currently *displayed* (visible in the layout)
      // but failed to load. Off-screen images hidden via CSS (display:none or
      // zero-size) are skipped — those are responsive variants not active at
      // this viewport and will never have a naturalWidth until shown.
      const broken = await locator.evaluateAll((imgs) =>
        imgs
          .filter((img) => {
            const r = img.getBoundingClientRect();
            const cs = window.getComputedStyle(img);
            const displayed = cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0;
            return displayed && (!img.currentSrc || img.naturalWidth === 0);
          })
          .map((img) => img.getAttribute('src') || '(no src)')
      );

      expect(broken, `Giveaway banner images failed to load on ${handle}: ${broken.join(', ')}`)
        .toHaveLength(0);
    });
  }
});
