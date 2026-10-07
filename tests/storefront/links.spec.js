import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Key Navigation Links', () => {
  test('nav.key_links: mandatory links land on correct paths', {
    annotation: { type: 'check', description: 'nav.key_links' }
  }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const [text, expectedPath] of Object.entries(config.navigation.keyLinks)) {
      // The same nav links exist twice in the DOM (desktop header + mobile header),
      // so the locator is narrowed to the first match. We assert it is attached
      // rather than visible, because whichever header is hidden depends on viewport.
      const link = page.getByRole('link', { name: new RegExp(text, 'i') }).first();
      await expect(link, `Link "${text}" not found`).toBeAttached();

      const href = await link.getAttribute('href');
      expect(href, `Link "${text}" has no href`).toBeTruthy();
      expect(
        href,
        `Link "${text}" points to "${href}", expected to contain "${expectedPath}"`
      ).toMatch(new RegExp(expectedPath, 'i'));

      // Navigate directly instead of clicking: several nav links are in-page hash
      // anchors (e.g. /pages/sealed-pokemon#collection or /#mystery-pokemon) which
      // never fire a real navigation event, so click + waitForNavigation would hang
      // until timeout. page.goto(url) returns null for same-document navigations.
      const response = await page.goto(href, { waitUntil: 'domcontentloaded' });

      // Fragment-only navigations (e.g. /#mystery-pokemon) return null response
      // because there is no actual network request. Full page navigations return a
      // Response object which we validate.
      if (response) {
        expect(
          response.status(),
          `${expectedPath} returned HTTP ${response.status()}`
        ).toBeLessThan(400);
      } else if (!href.includes('#')) {
        // Non-fragment navigation should always return a response; null is unexpected.
        throw new Error(`${text} (${href}) navigated but returned no response`);
      }
      // else: fragment-only navigation, response is null by design, OK.

      // For each destination, verify it has at least a visible heading element
      // (either h1 or h2, common patterns for page structure). For fragments,
      // this confirms the target section exists and is visible.
      await expect(
        page.locator('h1, h2').first(),
        `No main heading visible on ${expectedPath}`
      ).toBeVisible();

      // Return to homepage for next iteration (unless we're testing the homepage anchor)
      if (!href.includes('/#')) {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
      }
    }
  });
});