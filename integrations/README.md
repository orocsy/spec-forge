# Integrations registry

One folder per integration. Each integration is a self-contained, versioned package the bootstrap can apply to a project. See §4.3 + §16 of the design doc for the full free-tier matrix.

## Folder shape

```
integrations/
├── postgres-neon-prisma/
│   ├── manifest.json              # IntegrationManifest (Zod-validated)
│   ├── patch/                     # files copied verbatim into the project
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/seed.ts
│   │   └── src/lib/db.ts
│   ├── env.template               # env var names + comments (no values)
│   ├── dev-defaults.json          # safe-to-commit dev keys (only public ones)
│   ├── compose-fragment.yml       # appended to docker-compose.yml
│   ├── workflow-fragment.yml      # appended to ci.yml (e.g. Neon branch creation)
│   ├── post-install.sh            # shell snippet run after patch (e.g. prisma generate)
│   ├── markers.json               # marker-comment fences for shared files
│   └── README.md                  # what it gives, how to upgrade to paid tier
├── clerk/
├── stripe/
├── resend/
├── r2-cloudflare/
├── inngest/
├── upstash-ratelimit/
├── sentry/
├── google-analytics/
├── ai-sdk/
├── meilisearch-self-hosted/
└── _registry-index.json           # lists all integrations by category, used by stack-decider
```

## Tier 1 integrations to ship (free-tier-only, in build order)

| Day | Integration | Why first |
|-----|-------------|-----------|
| 2 | `postgres-neon-prisma` | Validates the registry shape; least surprising; Neon branching is the most differentiated free feature |
| 3 | `clerk` | Auth is needed by most PRDs; multi-role from day 1 |
| 4 | `stripe` | Most complex (sidecar process for webhook capture); payments are common |
| 5 | `resend` | Simple — validates the `prompt_user` strategy works |
| 5 | `r2-cloudflare` | File storage, zero-egress free tier (best alternative) |
| 5 | `sentry` | Always-on observability default |
| 5 | `google-analytics` | Always-on analytics default (user pick) |
| 5 | `ai-sdk` (optional) | Conditional — only if PRD signals AI |
| 7 | `inngest` | Background jobs — common in SaaS PRDs |
| 7 | `upstash-ratelimit` | API protection — easy add |

## Tier 2 (post-MVP)

`vercel-edge-config` (feature flags) · `meilisearch-self-hosted` (search) · `lemon-squeezy` (payments alt) · `lucia` (auth alt) · `nextauth` (auth alt) · `mongodb` (db alt) · `supabase` (db+auth combined) · `pusher` (realtime) · `ably` (realtime) · `posthog` (analytics+flags combined)

## Adding a new integration (process)

```bash
# Scaffold from template
/dev-pipeline:integration scaffold <name> --category <cat>

# Edits manifest.json + patch/ stub files
# Run validation:
/dev-pipeline:integration validate <name>

# Run end-to-end against a test project:
/dev-pipeline:integration test <name>
```

## Integration health

- Each manifest declares a `verification.dev` shell snippet that returns 0 if integration is healthy in dev. Run via `/dev-pipeline:integration verify <name>` against an existing project.
- Each manifest declares a `verification.ci` glob that must exist after install. Run by `dev-pipeline test`.
- **No periodic health checks** (per user feedback) — if dev-default keys break, next bootstrap re-fetches.

## Marker-comment fences (for shared files)

Files like `src/middleware.ts`, `prisma/schema.prisma`, `next.config.js` are shared across integrations. Each integration appends a fenced section:

```ts
// === @clerk/middleware ===
import { clerkMiddleware } from '@clerk/nextjs/server';
// ... clerk-managed content
// === /@clerk/middleware ===

// === @upstash/ratelimit ===
import { ratelimit } from '@/lib/ratelimit';
// === /@upstash/ratelimit ===
```

`markers.json` declares which fences this integration owns:
```json
{
  "src/middleware.ts": ["@clerk/middleware"],
  "src/middleware.ts:body": ["@clerk/middleware:body"]
}
```

The `integration-applier` (Layer 2) only edits inside its own fences. Two integrations editing the same file are orthogonal (no conflicts).

---

*Status: directory + skeleton README. Day 2 of the build plan ships `postgres-neon-prisma`.*
