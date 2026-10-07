import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // Fail the build on CI if you accidentally left test.only in the source code.
  forbidOnly: !!process.env.CI,
  // Retry once per check
  retries: 1,
  // Checkout checks must run serially to avoid cart collisions in a single session
  workers: process.env.CI ? 1 : undefined,
  // Custom reporter required by the spec plus a standard list reporter
  reporter: [
    ['list'],
    ['./src/reporter.js']
  ],
  use: {
    baseURL: 'https://mysterypokeslabs.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 MPSMonitor/1.0'
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        userAgent: devices['iPhone 14'].userAgent + ' MPSMonitor/1.0'
      },
    },
  ],
});
