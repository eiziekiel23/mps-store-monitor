import { test, expect } from '../base.js';

test.describe('Mobile Navigation', () => {
  test('nav.hamburger: tap opens the drawer, menu links visible, close works', {
    annotation: { type: 'check', description: 'nav.hamburger' }
  }, async ({ page }, testInfo) => {
    // The mobile header is hidden above the lg breakpoint, so this check is
    // meaningful only on a mobile viewport. Declared inside the test body
    // (not at describe scope) because describe-scope test.skip(callback)
    // only receives fixtures, not testInfo, as its argument — testInfo is
    // only available as the test function's real second parameter.
    test.skip(testInfo.project.name !== 'mobile',
      'nav.hamburger only applies to the mobile viewport');

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The theme implements the mobile menu with the checkbox-hack: a hidden
    // <input id="open-mobile-nav" type="checkbox"> is toggled by <label> elements.
    // There is no <button> and no aria-label, so role-based locators do not apply.
    const hamburger = page.locator('label.mobile-submenu-label[for="open-mobile-nav"]');
    const toggle = page.locator('#open-mobile-nav');
    const drawer = page.locator('nav.mobile__navigation');

    await expect(hamburger, 'Mobile hamburger label not found').toBeVisible();

    // Drawer starts closed
    await expect(toggle, 'Mobile nav should start closed').not.toBeChecked();

    // Open the drawer
    await hamburger.click();
    await expect(toggle, 'Tapping hamburger did not open the mobile nav').toBeChecked();
    await expect(drawer, 'Mobile nav drawer did not become visible').toBeVisible();

    // Key menu links are present inside the drawer
    await expect(
      drawer.getByRole('link', { name: /sealed pok/i }),
      'Sealed Pokémon link missing from mobile drawer'
    ).toBeVisible();
    await expect(
      drawer.getByRole('link', { name: /giveaway winners/i }),
      'Giveaway Winners link missing from mobile drawer'
    ).toBeVisible();

    // Close via the overlay label (the theme has no explicit close button).
    // The overlay is .overlay--nav { position:fixed; height:100vh } with no
    // width set, so its computed width is ~0 and the drawer (z-index:10) sits
    // above it (z-index:9) — a normal .click() fails actionability (no stable
    // clickable area). dispatchEvent('click') fires a real click on the
    // <label for="open-mobile-nav">, which triggers the browser's default
    // label-activation and toggles the checkbox regardless of size/z-index,
    // exercising the actual close affordance.
    await page.locator('label.overlay--nav[for="open-mobile-nav"]').dispatchEvent('click');
    await expect(toggle, 'Mobile nav did not close').not.toBeChecked();
  });
});
