import { test, expect } from '../base.js';
import { fetchSnapshot } from '../../src/snapshot.js';
import config from '../../config/monitor.config.js';

test.describe('Storefront Countdown Timer', () => {
  let giveawayData = null;

  test.beforeAll(async () => {
    const token = process.env.SHOPIFY_STOREFRONT_TOKEN;
    if (!token) return;
    try {
      const snapshot = await fetchSnapshot({
        storeUrl: config.storeUrl,
        storefrontToken: token
      });
      giveawayData = snapshot.giveaway;
    } catch (err) {
      console.warn('Snapshot fetch failed:', err.message);
    }
  });

  test('timer.correct: countdown is active and within ±2m of expected giveaway end date', {
    annotation: { type: 'check', description: 'timer.correct' }
  }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    // Attempt dynamic selector discovery for common timer patterns
    const timerContainer = page.locator('[class*="timer"], [id*="timer"], .countdown-monthly-container').first();
    await expect(timerContainer).toBeVisible({ timeout: 10000 });

    const getSeconds = async () => {
      // Extract days/hours/mins from timer elements found by selector
      return await page.evaluate(() => {
        const d = parseInt(document.querySelector('.days, [class*="days"]')?.textContent || '0');
        const h = parseInt(document.querySelector('.hrs, .hours, [class*="hours"], [class*="hrs"]')?.textContent || '0');
        const m = parseInt(document.querySelector('.mins, .minutes, [class*="minutes"], [class*="mins"]')?.textContent || '0');
        const s = parseInt(document.querySelector('.secs, .seconds, [class*="seconds"], [class*="secs"]')?.textContent || '0');
        return d * 86400 + h * 3600 + m * 60 + s;
      });
    };

    const startSecs = await getSeconds();
    await page.waitForTimeout(3000);
    const endSecs = await getSeconds();

    // Ensure it is moving
    expect(endSecs, 'Timer did not decrease after 3s').toBeLessThan(startSecs);

    // Validate against metaobject data
    if (giveawayData?.flash_giveaway_end_date) {
      const parseMetaDate = (v) => {
        if (v == null) return null;
        const s = String(v).trim();
        const n = Number(s);
        if (String(n) === s && s.length <= 13) return Math.floor(n);
        const d = new Date(s);
        if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
        return null;
      };

      const expectedEnd = parseMetaDate(giveawayData.flash_giveaway_end_date);
      if (expectedEnd == null) {
        throw new Error(`Invalid flash_giveaway_end_date format from metaobject: '${giveawayData.flash_giveaway_end_date}'`);
      }

      const now = Math.floor(Date.now() / 1000);
      const expectedRemaining = expectedEnd - now;

      // ± 120s tolerance
      const diff = Math.abs(startSecs - expectedRemaining);
      expect(diff, `Timer drift ${diff}s exceeds 120s tolerance`).toBeLessThanOrEqual(120);
    }
  });
});
