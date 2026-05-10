import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — headed by default in local dev so you SEE the
 * browser open and step through your flow (LuxeBook learning, Apr 14:
 * "Run E2E headed, I want to see the browser"). CI overrides via
 * PLAYWRIGHT_HEADLESS=1 — see scripts/test:e2e:ci.
 *
 * Trace + screenshot on failure are always on so the trace viewer
 * (`pnpm exec playwright show-trace`) surfaces every step + DOM +
 * network call after a flake.
 */
const isCI = !!process.env.CI;
const headless = isCI || process.env.PLAYWRIGHT_HEADLESS === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [['html'], ['list']] : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    headless,
    // Always-on trace + screenshot on failure: cheaper than re-running
    // a flaky spec to figure out what went wrong.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Auto-start the dev server unless one is already running. Default
  // is `pnpm dev` because it works without a prior `pnpm build`. If you
  // want to test the production bundle, set PLAYWRIGHT_USE_PROD_SERVER=1
  // (and run `pnpm build` first, OR add a `pretest:e2e:ci` script).
  // Headless mode is independent — control it via PLAYWRIGHT_HEADLESS=1.
  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command: process.env.PLAYWRIGHT_USE_PROD_SERVER === '1' ? 'pnpm start' : 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});
