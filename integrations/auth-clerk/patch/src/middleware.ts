/**
 * Clerk middleware — handles auth state on every request.
 *
 * By default this is a pass-through (no routes protected). Add route
 * protection by:
 *
 *   const isProtected = createRouteMatcher(['/dashboard(.*)', '/api/private(.*)']);
 *   export default clerkMiddleware(async (auth, req) => {
 *     if (isProtected(req)) await auth.protect();
 *   });
 *
 * Pattern: Clerk Next.js docs (https://clerk.com/docs/references/nextjs/clerk-middleware).
 */
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run on API + trpc routes
    '/(api|trpc)(.*)',
  ],
};
