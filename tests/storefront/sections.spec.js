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

    // Verify each section in config is present in the DOM.
    // Query the class/id substring directly rather than wrapping it in
    // `section, div` + filter({has:...}): on this Tailwind-heavy theme the
    // page can contain thousands of divs, and has() must test each one's
    // full subtree for a descendant match (worst-case O(n^2)), which blew
    // past the 30s test timeout. A direct attribute-substring selector is a
    // single querySelectorAll and is just as correct for "does this section
    // exist anywhere on the page".
    for (const sectionType of config.sections.home) {
      const locator = page.locator(`[class*="${sectionType}"], [id*="${sectionType}"]`);

      const count = await locator.count();
      expect(count, `Section matching '${sectionType}' should exist`).toBeGreaterThan(0);
    }

    // Verify that primary images on the page have loaded.
    //
    // An image counts as broken only when the browser FINISHED its load
    // attempt (img.complete) and still ended up with no intrinsic size
    // (naturalWidth === 0). An incomplete image is merely still loading, and
    // a zero-size image that was never rendered is usually a hidden duplicate
    // belonging to the other viewport's header (this theme ships both a
    // desktop and a mobile logo; the display:none one never loads, so its
    // naturalWidth stays 0). We therefore also require the image to be
    // actually rendered before judging it.
    const brokenImages = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images
        .filter((img) => {
          if (!img.src || img.src.startsWith('data:')) return false;
          // Only judge images that actually occupy space on screen.
          const rect = img.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          return img.complete && img.naturalWidth === 0;
        })
        .map((img) => img.src)
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
      const locator = page.locator(`[class*="${sectionType}"], [id*="${sectionType}"]`);

      const count = await locator.count();
      expect(count, `Product section matching '${sectionType}' should exist`).toBeGreaterThan(0);
    }
  });
});
