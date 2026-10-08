import { test, expect } from '../base.js';

test.describe('Storefront Smoke Checks', () => {
  test('store.reachable: verify basic connectivity', {
    annotation: { type: 'check', description: 'store.reachable' },
  }, async ({ page }) => {
    // Must use a real browser navigation, not request.get(): the storefront
    // sits behind Cloudflare bot management, which serves a JS challenge
    // page (HTTP 429, "Verifying your connection...") to any client that
    // can't execute JS. A bare APIRequestContext never clears that challenge
    // and would 429 on every single CI run; page.goto() runs a full browser
    // and passes it, same as every other check in this suite.
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `Homepage returned HTTP ${response?.status()}`).toBeLessThan(400);

    // Catch a soft-200 Liquid render failure (broken theme code returns 200
    // with an error banner instead of a proper HTTP error).
    const title = await page.title();
    expect(title.length, 'Homepage <title> is empty').toBeGreaterThan(0);

    const html = await page.content();
    expect(html, 'Homepage HTML contains an unhandled Liquid error').not.toContain('Liquid error:');
  });
});
