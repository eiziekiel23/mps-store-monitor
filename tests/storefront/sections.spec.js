import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Storefront Section Integrity', () => {
  test('home.sections: all required homepage sections render cleanly', {
    annotation: { type: 'check', description: 'home.sections' }
  }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Validate no unhandled Liquid errors anywhere on the page
    const content = await page.content();
    expect(content).not.toContain('Liquid error:');

    // Verify each section in config is present in the DOM
    for (const sectionType of config.sections.home) {
      // Find matching section containers by class, id, or tag
      const locator = page.locator(`section, div`).filter({
        has: page.locator(`[class*="${sectionType}"], [id*="${sectionType}"]`)
      }).first();

      // Ensure the container is attached and not empty
      const count = await locator.count();
      expect(count, `Section matching '${sectionType}' should exist`).toBeGreaterThan(0);
    }

    // Verify that primary images on the page have loaded
    const brokenImages = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images
        .filter(img => img.src && !img.src.startsWith('data:') && !img.complete || (img.naturalWidth === 0 && img.naturalHeight === 0))
        .map(img => img.src)
        .slice(0, 5); // limit output
    });

    expect(brokenImages, `Found broken images: ${brokenImages.join(', ')}`).toHaveLength(0);
  });

  test('product.sections: reference product page has required sections', {
    annotation: { type: 'check', description: 'product.sections' }
  }, async ({ page }) => {
    const handle = config.referenceProducts[0];
    await page.goto(`/products/${handle}`, { waitUntil: 'domcontentloaded' });

    const content = await page.content();
    expect(content).not.toContain('Liquid error:');

    for (const sectionType of config.sections.product) {
      const locator = page.locator(`section, div`).filter({
        has: page.locator(`[class*="${sectionType}"], [id*="${sectionType}"]`)
      }).first();

      const count = await locator.count();
      expect(count, `Product section matching '${sectionType}' should exist`).toBeGreaterThan(0);
    }
  });
});
