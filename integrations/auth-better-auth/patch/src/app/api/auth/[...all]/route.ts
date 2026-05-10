/**
 * better-auth catch-all route handler.
 * Mounted at /api/auth/* — handles sign-in, sign-up, callback, sign-out, etc.
 *
 * Pattern: better-auth Next.js docs (toNextJsHandler).
 */
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
