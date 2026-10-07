import { test, expect } from '../base.js';
import config from '../../config/monitor.config.js';

test.describe('Official Rules Page', () => {
  test('nav.rules: official rules page opens and shows heading and body', {
    annotation: { type: 'check', description: 'nav.rules' }
  }, async ({ page }) => {
    test.setTimeout(60_000);

    const rulesPath = config.navigation.rules;
    expect(rulesPath, 'config.navigation.rules must be defined').toBeTruthy();

    const response = await page.goto(rulesPath, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `Rules page ${rulesPath} returned HTTP ${response?.status()}`).toBeLessThan(400);

    // Verify the heading exists and contains "OFFICIAL RULES"
    // Note: .official-rules-title__label is reused in all accordion sections;
    // use .first() to grab the page-level heading only.
    const heading = page.locator('.official-rules-title__label').first();
    await expect(heading, 'Official rules heading not found').toBeVisible();
    await expect(heading).toContainText('OFFICIAL RULES');

    // Verify the rules body (content area) exists and is visible
    const body = page.locator('.official-rules-title, [class*="rules-content"], [class*="rules-body"]').first();
    await expect(body, 'Rules page body not found').toBeVisible();
  });
});
