import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../index.js';

describe('main', () => {
 it('runs without throwing', () => {
 expect(() => main()).not.toThrow();
 });
});

/**
 * Sample TZ-invariance test (real-world postmortem).
 *
 * Why this matters: a `parseISO()` call that worked on the team's UTC
 * dev/CI machines silently broke for users in non-UTC timezones. The
 * lesson: any function that touches dates, times, paths, or
 * `process.env` should be exercised under a non-UTC TZ in CI.
 *
 * Replace `formatToday` below with a real function from your codebase
 * and uncomment the assertion. The test runs twice — once under
 * `Asia/Hong_Kong` (UTC+8), once under `America/Los_Angeles` (UTC−8) —
 * so you instantly see if your output drifts with the user's clock.
 *
 * Recommended targets: any code that calls `new Date()`,
 * `Date.now()`, `parseISO`, `Intl.DateTimeFormat`, `format`/`fromZonedTime`,
 * or reads paths from `process.env`.
 */

function formatToday(date: Date): string {
 // Stand-in for a real function from your codebase. Intentionally
 // naive so the test below would catch a bug if you replaced it with
 // `date.toISOString().slice(0, 10)`.
 return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(date);
}

describe('TZ-invariance — formatToday()', () => {
 const originalTZ = process.env.TZ;
 afterEach(() => {
 process.env.TZ = originalTZ;
 vi.unstubAllEnvs();
 });

 // The instant Mon May 5 2026 23:30 UTC. In Hong Kong (UTC+8) this is
 // already May 6 07:30; in Los Angeles (UTC−8) it's still May 5 15:30.
 // A correctly-written `formatToday` should return the SAME UTC date
 // ("2026-05-05") under both timezones because it pinned `timeZone: UTC`.
 const instant = new Date('2026-05-05T23:30:00Z');

 it.each([
 ['Asia/Hong_Kong'],
 ['America/Los_Angeles'],
 ['UTC'],
 ])('produces the same output under TZ=%s', (tz) => {
 vi.stubEnv('TZ', tz);
 expect(formatToday(instant)).toBe('2026-05-05');
 });
});
