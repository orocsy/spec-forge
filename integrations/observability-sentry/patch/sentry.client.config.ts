/**
 * Sentry — browser instrumentation. Initialised eagerly so unhandled
 * errors in route transitions / RSC hydration are captured.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
    debug: false,
  });
}
