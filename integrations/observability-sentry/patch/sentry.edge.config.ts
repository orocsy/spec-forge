/**
 * Sentry — edge runtime instrumentation (middleware, edge route handlers).
 * Edge runtime is more constrained than Node — no `process` for some APIs,
 * no native modules.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  });
}
