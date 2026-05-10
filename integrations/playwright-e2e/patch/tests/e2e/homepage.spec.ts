import { expect, test } from '@playwright/test';
import { step } from '../helpers/step';

/**
 * Sample E2E spec — homepage smoke test.
 *
 * Demonstrates the headed-by-default + step-screenshot pattern. Replace
 * with your real flows; this exists so `pnpm test:e2e` works out of the
 * box and the harness is exercised by CI from day one.
 */
test('homepage loads and has expected title', async ({ page }, testInfo) => {
  await page.goto('/');
  await step(page, testInfo, '01-homepage-loaded');

  // Customise this assertion to match your app. Generic test that
  // doesn't false-fail on every brand change.
  await expect(page).toHaveTitle(/.+/);
  await step(page, testInfo, '02-title-asserted');
});
