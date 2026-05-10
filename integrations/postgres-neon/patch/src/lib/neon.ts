/**
 * Neon serverless Postgres driver — for edge runtimes (Vercel Edge, CF
 * Workers) where node:net is unavailable. Use this OR the Prisma client,
 * not both, depending on the runtime.
 *
 * For server components / API routes on Node runtime, prefer `db.ts`
 * (Prisma). For middleware / edge functions, use `sql` from this file.
 */
import { neon, neonConfig } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  // Fail fast at import time in production; in dev we let it resolve so
  // local-only tooling (lint, type-check) doesn't crash.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be set for Neon serverless driver');
  }
}

// Use HTTPS instead of WebSockets — works in every edge runtime.
neonConfig.fetchConnectionCache = true;

export const sql = neon(process.env.DATABASE_URL ?? '');
