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
  });
});
