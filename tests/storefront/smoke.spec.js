import { test, expect } from '../base.js';

test.describe('Storefront Smoke Checks', () => {
  test('store.reachable: verify basic connectivity', {
    annotation: { type: 'check', description: 'store.reachable' },
  }, async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
  });
});
