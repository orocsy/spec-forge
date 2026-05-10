/**
 * Browser-side better-auth client. Use in client components for
 * sign-in/up/out flows.
 *
 * Example:
 *   'use client';
 *   import { authClient } from '@/lib/auth-client';
 *   const { data, error } = await authClient.signIn.email({ email, password });
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signOut, signUp, useSession } = authClient;
