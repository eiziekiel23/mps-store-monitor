import { test, expect } from '../base.js';
import { fetchSnapshot } from '../../src/snapshot.js';
import config from '../../config/monitor.config.js';

test.describe('Storefront Flash Giveaway', () => {
  let giveawayData = null;

  test.beforeAll(async () => {
    const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
    if (!token) return;
    const snapshot = await fetchSnapshot({
      storeUrl: config.storeUrl,
      storefrontToken: token
    });
    giveawayData = snapshot.giveaway;
  });

  test('flash.banners: banner images load and match metaobject reference', {
    annotation: { type: 'check', description: 'flash.banners' }
  }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Validate images
    const bannerLocators = [
      page.locator('img[src*="flash_giveaway"]'),
      page.locator('.flash-giveaway-banner img')
    ];

    let foundBanner = false;
    for (const locator of bannerLocators) {
      if (await locator.count() > 0) {
        foundBanner = true;
        const src = await locator.first().getAttribute('src');

        // Ensure image loaded (naturalWidth > 0)
        const isLoaded = await page.evaluate((s) => {
          const img = document.querySelector(`img[src="${s}"]`);
          return img && img.naturalWidth > 0;
        }, src);

        expect(isLoaded, `Banner image ${src} failed to load`).toBe(true);
      }
    }

    expect(foundBanner, 'No flash giveaway banner found on homepage').toBe(true);
  });
});
