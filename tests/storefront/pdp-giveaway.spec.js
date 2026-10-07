import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Product Page Giveaway Brand', () => {
  for (const handle of config.referenceProducts) {
    test(`product.giveaway_images: giveaway brand loads on ${handle}`, {
      annotation: { type: 'check', description: 'product.giveaway_images' }
    }, async ({ page }) => {
      await page.goto(`/products/${handle}`, { waitUntil: 'load' });

      // Selector for the product giveaway image
      const locator = page.locator('[class*="giveaway-image"], [id*="giveaway-image"]');

      const count = await locator.count();
      expect(count, `Giveaway image not found on ${handle}`).toBeGreaterThan(0);

      const src = await locator.first().getAttribute('src');
      const isLoaded = await page.evaluate((s) => {
        const img = document.querySelector(`img[src="${s}"]`);
        return img && img.naturalWidth > 0;
      }, src);

      expect(isLoaded, `Giveaway brand image ${src} failed to load on ${handle}`).toBe(true);
    });
  }
});
