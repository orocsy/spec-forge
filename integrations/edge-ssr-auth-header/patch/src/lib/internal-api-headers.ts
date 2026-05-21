/**
 * Header pair to identify legitimate SSR traffic when calling your API
 * through a bot-managed CDN (Cloudflare, AWS WAF, Fastly Bot Management).
 *
 * Returns `{}` when `INTERNAL_API_TOKEN` is unset — local dev, previews
 * without the env var, anything that isn't a configured SSR call. Empty
 * headers object is intentionally safe: the fetch still goes through, the
 * CDN just evaluates it as anonymous traffic and may challenge it (exactly
 * the failure mode this is designed to bypass, when the env IS set).
 *
 * ─────────────────────────────────────────────────────────────────────
 * Why this exists
 * ─────────────────────────────────────────────────────────────────────
 *
 * Next.js SSR functions run on the hosting platform's serverless workers
 * (Vercel, Netlify, etc.). When they fetch your API, the request goes:
 *
 *   SSR worker  →  CDN  →  Origin
 *   (node UA,         (sees bot-like
 *    shared IP)        traffic)
 *
 * CDNs with bot management (Cloudflare Bot Fight Mode, AWS WAF Bot Control,
 * Fastly NGWAF, Akamai Bot Manager) commonly flag this signature: generic
 * node-fetch User-Agent on a high-volume shared IP pool. Result:
 *
 *   - Cloudflare returns an HTML JS challenge → SSR sees non-JSON → throws.
 *   - Cloudflare drops the TCP connection → SSR sees HTTP 000 → throws.
 *   - AWS WAF rate-limits the IP pool → 403.
 *
 * Each of these surfaces to the user as either a 4xx page (worst) or a
 * degraded fallback render (less bad, but not real content).
 *
 * The fix: attach a header that the CDN's WAF rule knows about, and let
 * matching requests skip the bot challenge. The CDN treats SSR traffic as
 * "authenticated internal" while still bot-checking the public.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Setup (BOTH must be done — token alone does nothing)
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. Generate a strong random value:
 *        openssl rand -hex 32
 *
 *   2. Set `INTERNAL_API_TOKEN` on your hosting platform as a SERVER-SIDE
 *      env var (do NOT prefix `NEXT_PUBLIC_` — the value must not be
 *      exposed to the browser). Production + Preview scopes; usually NOT
 *      Development unless your local CDN setup needs it. Redeploy.
 *
 *   3. Configure your CDN to skip bot mitigation when the header matches.
 *
 *      Cloudflare (dashboard click-path):
 *        zone → Security → WAF → Custom rules → Create
 *        Expression:
 *          (http.host eq "api.example.com" and
 *           http.request.headers["x-internal-token"][0] eq "<same-secret>")
 *        Action: Skip
 *        Skip: All Super Bot Fight Mode + All managed rules + (optionally
 *              all rate limiting + all remaining custom rules)
 *
 *      Cloudflare (API):
 *        curl -X POST "https://api.cloudflare.com/client/v4/zones/<zone>/rulesets/<id>/rules" \
 *          -H "Authorization: ${AUTH_HEADER}" \   # AUTH_HEADER="Bearer <api-token>"
 *          -H "Content-Type: application/json" \
 *          -d '{
 *            "action": "skip",
 *            "action_parameters": { "phases": ["http_request_firewall_managed"], ... },
 *            "expression": "(http.host eq \"api.example.com\" and http.request.headers[\"x-internal-token\"][0] eq \"<secret>\")",
 *            "description": "SSR bypass"
 *          }'
 *
 *      AWS WAF:
 *        Create a Rule with statement "ByteMatchStatement" on
 *        `headers.x-internal-token == <secret>`, action: Allow + skip
 *        ManagedRulesBotControlRuleSet.
 *
 *      Fastly:
 *        Create a VCL snippet checking req.http.x-internal-token, set
 *        req.http.X-Skip-Challenge = "1" when matched, gate the bot
 *        protection on the absence of that header.
 *
 *   4. Verify with a tight loop against an SSR-rendered URL:
 *
 *        for i in $(seq 1 30); do
 *          curl -sI "https://your-app.example.com/some-ssr-page" | head -1
 *        done
 *
 *      Expect: 30/30 HTTP/2 200, no intermittent 4xx.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Security properties
 * ─────────────────────────────────────────────────────────────────────
 *
 *  - Reads `process.env.INTERNAL_API_TOKEN` only — no `NEXT_PUBLIC_*`
 *    prefix means the value cannot leak into browser bundles via Next.js's
 *    automatic-exposure rule.
 *  - Returns `{}` when env unset → safe default. Real browsers don't carry
 *    the token; neither does an unconfigured SSR.
 *  - Trims whitespace defensively (whitespace-only token → `{}`) to catch
 *    paste-with-newline misconfigurations.
 *  - Returns a fresh object each call to prevent cross-fetch mutation.
 *  - The token is a "this is our SSR" signal to the CDN, NOT an auth
 *    credential at the API origin. Worst-case leak: an attacker can hit
 *    the API origin with the token and bypass CDN bot mitigation. They
 *    still face per-IP rate limiting at the origin and only get the
 *    public endpoints (which are already accessible to any real browser).
 *    Low impact. Rotate the token if leaked.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Token rotation (safe order)
 * ─────────────────────────────────────────────────────────────────────
 *
 *  1. Add the NEW token as a SECOND value in your hosting env (don't
 *     remove old yet).
 *  2. Redeploy. Verify the new token is in the bundle.
 *  3. Update the CDN WAF rule to accept EITHER value (`in {old, new}`).
 *  4. Wait ~10 minutes for in-flight requests on the old deploy to drain.
 *  5. Remove the old value from the hosting env.
 *  6. Verify production traffic.
 *  7. Remove the old value from the CDN WAF rule.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Where to call this
 * ─────────────────────────────────────────────────────────────────────
 *
 * Every SSR data fetcher that hits the bot-managed API. Typical sites:
 *
 *   - app/[...slug]/page.tsx — server component data fetch
 *   - app/[...]/layout.tsx — server component layout data fetch
 *   - lib/get-*.ts — server-side data helpers
 *
 * DO NOT call from client-side ('use client') files — browsers should send
 * their real UA and let the CDN's bot management see them as real users.
 * The token is purely for the SSR egress.
 */
export function getInternalApiHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_API_TOKEN?.trim();
  if (!token) return {};
  return { 'x-internal-token': token };
}
