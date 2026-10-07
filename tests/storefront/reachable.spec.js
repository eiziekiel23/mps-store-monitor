import { test, expect } from '../base.js';

test.describe('Storefront Gateway', () => {
  test('store.reachable: homepage responds with 200 and no liquid errors', {
    annotation: { type: 'check', description: 'store.reachable' }
  }, async ({ page }) => {
    // 1. Visit homepage
    const response = await page.goto('/', { waitUntil: 'load' });

    // 2. Validate HTTP status
    expect(response.status()).toBe(200);

    // 3. Validate content
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // 4. Ensure no unhandled Liquid rendering failures
    const text = await page.content();
    expect(text).not.toContain('Liquid error:');
  });
});
