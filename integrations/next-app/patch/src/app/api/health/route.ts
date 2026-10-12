/**
 * Which release is live, answered by the running app itself.
 *
 * Deploy logs and workflow status say what was SENT; this says what is
 * SERVING. Watch `releaseId` after a deploy instead of guessing from CI.
 * Vercel sets VERCEL_GIT_COMMIT_SHA; other platforms pass GIT_SHA (and
 * optionally BUILD_TIME) at build or run time.
 */
export function GET() {
  return Response.json({
    status: 'ok',
    releaseId: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? 'development',
    buildTime: process.env.BUILD_TIME ?? null,
  });
}
