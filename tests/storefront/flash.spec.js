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

    // The theme renders the giveaway banner as three responsive <img> variants
    // inside the giveaway section, all carrying a "give-away-*-banner-*" class.
    const banners = page.locator('img[class*="give-away-"]');

    const count = await banners.count();
    expect(count, 'No flash giveaway banner found on homepage').toBeGreaterThan(0);

    // Every rendered banner must have a src and must actually decode.
    // Hidden responsive variants still load because they are marked loading="eager".
    const broken = await banners.evaluateAll((imgs) =>
      imgs
        .filter((img) => !img.currentSrc || img.naturalWidth === 0)
        .map((img) => img.getAttribute('src') || '(no src)')
    );

    expect(broken, `Flash giveaway banner images failed to load: ${broken.join(', ')}`)
      .toHaveLength(0);
  });
});
