import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Quick Navigation Links', () => {
  test('nav.quick_links: footer quick links land on correct paths', {
    annotation: { type: 'check', description: 'nav.quick_links' }
  }, async ({ page }) => {
    // Quick links are utility/policy links, typically in the footer,
    // and fewer/shorter than key links. Budget ~5s per navigation.
    test.setTimeout(60_000);

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const [text, expectedPath] of Object.entries(config.navigation.quickLinks)) {
      // Footer links may appear multiple times (e.g. desktop/mobile footer variants),
      // so use .first() to grab the first visible match.
      const link = page.getByRole('link', { name: new RegExp(text, 'i') }).first();
      await expect(link, `Link "${text}" not found`).toBeAttached();

      const href = await link.getAttribute('href');
      expect(href, `Link "${text}" has no href`).toBeTruthy();
      expect(
        href,
        `Link "${text}" points to "${href}", expected to contain "${expectedPath}"`
      ).toMatch(new RegExp(expectedPath, 'i'));

      // Navigate directly (some links are API endpoints or fragments)
      const response = await page.goto(href, { waitUntil: 'domcontentloaded' });

      // Validate HTTP status for full-page navigations
      if (response) {
        expect(
          response.status(),
          `${expectedPath} returned HTTP ${response.status()}`
        ).toBeLessThan(400);
      }

      // Return to homepage for next iteration
      if (!href.includes('/#')) {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
      }
    }
  });
});
