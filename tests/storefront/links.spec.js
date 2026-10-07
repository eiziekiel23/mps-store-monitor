import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Key Navigation Links', () => {
  test('nav.key_links: mandatory links land on correct paths', {
    annotation: { type: 'check', description: 'nav.key_links' }
  }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    for (const [text, expectedPath] of Object.entries(config.navigation.keyLinks)) {
      const link = page.getByRole('link', { name: new RegExp(text, 'i') });
      await expect(link, `Link "${text}" not found`).toBeVisible();

      await Promise.all([
        page.waitForNavigation({ url: new RegExp(expectedPath, 'i'), timeout: 5000 }),
        link.click()
      ]);

      await expect(page.locator('h1, h2, [role="main"] h1, .main-content h1'), `No main heading on ${expectedPath}`).toBeVisible();
    }
  });
});