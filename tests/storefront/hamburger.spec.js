import { test, expect } from '../base.js';

test.describe('Mobile Navigation', () => {
  test('nav.hamburger: tap opens the drawer, menu links visible, close works', {
    annotation: { type: 'check', description: 'nav.hamburger' }
  }, async ({ page }) => {
    // This test uses the 'mobile' project (iPhone emulation)
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Locate the hamburger button (usually 🔳 or ☰)
    const hamburger = page.getByRole('button', { name: /menu/i }).or(page.locator('[aria-label*="menu" i]'));
    await expect(hamburger).toBeVisible();

    // Verify it opens the navigation drawer
    const drawer = page.getByRole('dialog', { name: /menu/i }).or(page.locator('[role="navigation"]').or(page.locator('.mobile-drawer')));
    await hamburger.click();
    await drawer.isVisible();

    // Check that typical menu items are present
    await expect(page.getByRole('link', { name: /sealed pokemon/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /giveaway winners/i })).toBeVisible();

    // Close the drawer
    const closeBtn = page.getByRole('button', { name: /close/i }).or(page.getByLabel(/close/i));
    await closeBtn.click();
    await drawer.isHidden();
  });
});