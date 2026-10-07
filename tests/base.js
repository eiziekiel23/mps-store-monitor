import { test as baseTest, expect as baseExpect } from '@playwright/test';
import config from '../config/monitor.config.js';

export const test = baseTest.extend({
  page: async ({ page }, use) => {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (config.trackers.blockRegex.some(re => re.test(url))) {
        route.abort();
      } else {
        route.continue();
      }
    });
    await use(page);
  }
});

export const expect = baseExpect;
