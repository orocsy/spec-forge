import type { Page, TestInfo } from '@playwright/test';

/**
 * Step + screenshot helper.
 *
 * Why this is a primitive: in a real production walkthrough the moment we
 * needed to debug a 410-vs-404 confusion, the existing trace had no
 * intermediate "I'm here" markers — just network + click logs. A
 * `step()` helper that writes a labelled screenshot at every meaningful
 * UI state turns a 9-test flow into a flip-book the trace viewer can
 * step through. Costs ~30ms per call.
 *
 * Usage:
 * import { test } from '@playwright/test';
 * import { step } from '../helpers/step';
 *
 * test('signup flow', async ({ page }, testInfo) => {
 * await page.goto('/signup');
 * await step(page, testInfo, 'signup-page-loaded');
 * await page.getByLabel('Email').fill('a@b.com');
 * await step(page, testInfo, 'email-filled');
 * // …
 * });
 */
export async function step(page: Page, testInfo: TestInfo, label: string): Promise<void> {
 // Surface in trace viewer + the test list reporter
 // eslint-disable-next-line no-console
 console.log(`▶ ${label}`);
 const safe = label.replace(/[^\w-]+/g, '-').slice(0, 80);
 await testInfo.attach(safe, {
 body: await page.screenshot({ fullPage: true }),
 contentType: 'image/png',
 });
}
