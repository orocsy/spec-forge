/**
 * Server-side better-auth instance. Imported by API routes + server
 * components. Pairs with the prisma integration's `db.ts` singleton.
 *
 * Add social providers by uncommenting the relevant block and setting
 * the matching env vars (GOOGLE_CLIENT_ID, GITHUB_CLIENT_ID, etc.).
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '@/lib/db';

// Quiet warn if unset — at runtime, better-auth will surface the real
// error on first request. We deliberately do NOT throw here because Next
// evaluates this module during `next build` page-data collection (no
// runtime env yet), and we don't want builds to fail just because the
// secret hasn't been provisioned in the build environment.
if (!process.env.BETTER_AUTH_SECRET) {
  console.warn(
    '[auth] BETTER_AUTH_SECRET unset — using a dev fallback. Generate with: openssl rand -base64 32'
  );
}

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-not-for-production-XXXXXXXX',
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  // socialProviders: {
  //   google: {
  //     clientId: process.env.GOOGLE_CLIENT_ID!,
  //     clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  //   },
  //   github: {
  //     clientId: process.env.GITHUB_CLIENT_ID!,
  //     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  //   },
  // },
});

export type Auth = typeof auth;
