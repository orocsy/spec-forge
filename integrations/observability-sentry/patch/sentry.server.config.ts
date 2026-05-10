/**
 * Sentry — Node.js (server) instrumentation. Captures errors from
 * server components, API routes, and middleware on the Node runtime.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    debug: false,
  });
}
