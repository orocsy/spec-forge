# edge-ssr-auth-header

A shared-secret header that identifies legitimate SSR traffic to your CDN's bot mitigation, so the CDN can skip its challenge for those specific requests while still protecting the rest.

## When you want this

Use this integration when ALL THREE conditions are true:

1. **Your API is fronted by a CDN with bot management.** Cloudflare (Bot Fight Mode / Super Bot Fight Mode), AWS WAF (Bot Control), Fastly NGWAF, Akamai Bot Manager — any of these.
2. **Your app uses SSR.** Next.js App Router server components, getServerSideProps, server actions, Remix loaders, etc. — anything that fetches your API from the hosting platform's serverless workers.
3. **You've observed intermittent SSR failures.** The classic symptoms: random 404s for valid URLs, intermittent "couldn't load" fallback shells, `HTTP 000` in your platform's fetch logs.

If you have a CDN but no SSR (pure SPA), skip this — browsers send real UAs and don't trigger bot mitigation.

If you have SSR but no CDN bot management (e.g., Vercel + Neon, both direct), skip this — there's nothing to bypass.

## When NOT to use this

- Your CDN doesn't have a custom-rule mechanism to act on header values (rare, but check before integrating).
- Your CDN's bot mitigation can't be selectively skipped — some Akamai Standard Bot Manager tiers are bypass-only-via-IP.
- You're worried about token exposure and prefer mTLS or IP allowlisting instead.

## The failure mode this prevents

Without this integration:

```
User visits /your-page
  ↓
Next.js SSR worker runs getServerSideProps / server component
  ↓
SSR worker fetches `https://api.example.com/...`
  ↓
CDN bot management evaluates: UA = node-fetch, IP = shared pool,
  TLS fingerprint = serverless. Flags as bot.
  ↓
CDN drops connection / returns HTML JS challenge / 403
  ↓
SSR sees HTTP 000 / non-JSON / 4xx → throws or returns error result
  ↓
Page renders either 404 (worst case) or degraded fallback (best case)
```

The user-visible symptom is intermittent — same URL, refresh works, sometimes fails. That's because CDN bot scoring varies by load + IP reputation + timing.

With this integration:

```
SSR worker fetches `https://api.example.com/...` WITH x-internal-token header
  ↓
CDN bot management evaluates: same as above PLUS
  IF http.request.headers["x-internal-token"] matches secret → SKIP challenge
  ↓
Real response delivered to SSR
  ↓
Page renders correctly
```

The bot mitigation still protects every other request to your API (real browsers, scrapers, attackers). Only your specific SSR worker is exempted, and only because it can prove ownership via the secret.

## Setup walkthrough (Cloudflare example)

### Step 1 — Generate the secret

```bash
openssl rand -hex 32
# example: 7a3f9b2c1d8e0a4f5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a
```

Store in a password manager — you'll need to reference it later for rotation.

### Step 2 — Set the env var on your hosting platform

**Vercel:**
- Project Settings → Environment Variables → New
- Name: `INTERNAL_API_TOKEN`
- Value: the secret from step 1
- Scope: ☑ Production, ☑ Preview, ☐ Development (unless your local Cloudflare config needs it)
- Type: Plaintext / server-side. **Do NOT** check "Make available to browser".
- **Do NOT** prefix the name with `NEXT_PUBLIC_` — that would leak it to the client bundle.

**Netlify:**
- Site Settings → Build & Deploy → Environment → Edit variables
- Same name + value
- Production + Deploy Previews scopes

After saving, redeploy your current branch. The new build picks up the env var.

### Step 3 — Configure the CDN WAF rule

**Cloudflare Free plan limitations:** the free plan's Custom Rules don't expose a "Skip Super Bot Fight Mode" action. Workarounds:
- Upgrade to Pro ($20/mo) for full Custom Rules + Super Bot skip support.
- Or use a Page Rule with Security Level = Essentially Off scoped to the API hostname's public paths (less targeted but works on free).

**Cloudflare Pro+ dashboard path:**

```
dash.cloudflare.com
  → your zone (e.g. example.com)
  → Security → WAF
  → Custom rules → Create rule
```

Fill:
- **Rule name**: `SSR bypass — <your-hosting-platform> → API`
- **Expression** (use "Edit expression" toggle, paste raw):
  ```
  (http.host eq "api.example.com"
   and http.request.headers["x-internal-token"][0] eq "<paste-secret-here>")
  ```
- **Action**: Skip
- **Skip phases (checkboxes that appear):**
  - ☑ All Super Bot Fight Mode rules
  - ☑ All managed rules
  - ☑ All rate limiting rules
  - ☑ All remaining custom rules (defensive)
- **Log matching requests**: ON (for verification, can disable later)
- **Place at**: First

Deploy.

**Cloudflare API path (alternative):**

```bash
ZONE_ID="..."
API_TOKEN="..."  # token with Zone:WAF:Edit permission
SECRET="..."

curl -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint/rules" \
  -H "Authorization: ${AUTH_HEADER}" \    # AUTH_HEADER="Bearer ${API_TOKEN}"
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"skip\",
    \"action_parameters\": {
      \"products\": [\"bic\", \"hot\", \"rateLimit\", \"securityLevel\", \"uaBlock\", \"waf\", \"zones\"]
    },
    \"description\": \"SSR bypass via x-internal-token\",
    \"expression\": \"(http.host eq \\\"api.example.com\\\" and http.request.headers[\\\"x-internal-token\\\"][0] eq \\\"${SECRET}\\\")\",
    \"enabled\": true
  }"
```

### Step 4 — Verify

Tight loop against an SSR-rendered URL:

```bash
for i in $(seq 1 30); do
  curl -sI "https://your-app.example.com/<some-ssr-page>" | head -1
done
```

Expect: 30/30 `HTTP/2 200`. If you see intermittent `HTTP/2 4xx` or a fallback render, one of these is wrong:
- Vercel env var name has a typo (must be `INTERNAL_API_TOKEN`, exactly)
- Vercel env var scope doesn't cover your deployment (Preview vs Production)
- Cloudflare rule expression has a typo in the hostname or header name
- Cloudflare rule isn't placed first (a stricter rule before it blocks the request before yours can skip)

Cross-check by checking the Cloudflare Security Events tab — filter by your rule ID. You should see your SSR fetches there. If you don't, the SSR isn't sending the header (env problem). If you DO see them but with `block` action, the header is arriving but a different rule is blocking first.

### Step 5 — Browser-leak check

```bash
curl -s "https://your-app.example.com/" | grep -i "x-internal-token\|INTERNAL_API_TOKEN"
```

Expect: empty output. If you see any match, the token leaked into the HTML / JS bundle. Rotate immediately and rename the env var to remove any `NEXT_PUBLIC_*` prefix.

## Token rotation (safe order)

1. Generate new token: `openssl rand -hex 32`.
2. Add as a SECOND value in your hosting env (don't remove old).
3. Redeploy.
4. Verify the new token is in the deployed bundle (check Security Events).
5. Update the CDN WAF rule to accept EITHER value:
   - Cloudflare: change `eq "old"` to `in {"old" "new"}`.
6. Wait ~10 min for in-flight requests on the previous deploy to drain.
7. Remove the OLD value from the hosting env.
8. Verify production traffic still healthy.
9. Remove the OLD value from the CDN WAF rule.

This zero-downtime rotation pattern works because both tokens are valid simultaneously during the overlap window.

## Limitations

1. **Only protects against bot mitigation, not against origin failures.** If your API origin itself is down (EC2 crashed, RDS unreachable), no header will fix it. Keep your fallback / retry logic in the SSR layer.
2. **Client-side calls don't benefit.** Real browsers handle the bot challenge natively (they execute JS). The token is only for SSR egress.
3. **Per-CDN syntax differences.** The header name `x-internal-token` is just a convention — any custom name works as long as your CDN rule matches it. Cloudflare's expression syntax is shown above; AWS WAF + Fastly have their own equivalents.
4. **Token-as-WAF-bypass is not authentication.** If you want the API origin to also validate, add a guard at the origin (nginx, application middleware) that checks the same header. The integration ships only the SSR-side helper; origin validation is opt-in.

## Origin-side validation (optional defence in depth)

If you want the API origin to reject requests claiming SSR origin but failing the token check, add at your edge proxy (nginx example):

```nginx
location /api/ {
  # If a request CLAIMS to be SSR (has the header), validate the value.
  # Requests WITHOUT the header are still allowed — real browsers don't
  # carry it. Only fail when present but wrong.
  set $valid_internal "0";
  if ($http_x_internal_token = "<same-secret>") { set $valid_internal "1"; }
  if ($http_x_internal_token != "" ) {
    if ($valid_internal = "0") { return 403; }
  }
  proxy_pass http://api_upstream;
}
```

This catches an attacker who learns the header name but not the value. Without it, the worst case is "attacker sends an invalid header, CDN doesn't skip its bot challenge anyway, request is challenged like any anonymous request" — so origin validation is genuinely optional.

## References

The pattern shipped in this integration was extracted from a real production incident post-mortem. The full incident write-up lives at the source project: search "luxebook booking-tenant-fallback-postmortem" for the canonical narrative.
