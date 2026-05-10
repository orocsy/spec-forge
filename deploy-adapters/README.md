# Deploy adapters

One folder per deployment target. The bootstrap selects an adapter based on `project-spec.deploy.target`. Adapter writes the platform-specific config files + CI deploy steps.

## Adapters planned

| Adapter | Free tier | Status | Why |
|---------|-----------|--------|-----|
| `vercel/` | Hobby (100GB bandwidth, 100k function invocations) | Day 5 (default) | Best Next.js DX; zero-config preview URLs |
| `cloudflare-pages/` | Generous (100k req/day, unlimited bandwidth) | Tier 2 | Best free escape from Vercel; OpenNext compatible |
| `netlify/` | Free (300 build min/mo, 100GB bandwidth) | Tier 2 | Vercel alternative |
| `render/` | Free web service (sleeps after 15min idle) | Tier 2 | Long-lived Node host (no cold start in prod tier) |
| `fly-io/` | 3 shared-cpu VMs free | Tier 2 | Self-host alternative; closest to "real server" feel |
| `self-host-docker/` | $0 — your VPS | Tier 3 | OpenNext + Docker compose; full control |

## Adapter contract

```
deploy-adapters/<target>/
├── adapter.json               # name, requires (CLI tools), files-to-write
├── config-template.<ext>      # e.g. vercel.json, fly.toml, wrangler.toml
├── deploy-workflow.yml        # GitHub Actions deploy job
├── env-sync.sh                # how to push secrets to this target's vault
├── domain-setup.md            # one-time human step (DNS records, etc)
└── README.md                  # what the adapter does, alternatives, migration paths
```

## Adapter contract (TypeScript shape, used by `ci-generator` Layer 2)

```ts
interface DeployAdapter {
  name: string;
  requiresCLITools: string[];       // e.g. ['vercel', 'gh']

  configFiles(spec: ProjectSpec): Array<{ path: string; content: string }>;
  deployWorkflowSteps(spec: ProjectSpec): WorkflowStep[];
  pushSecret(name: string, value: string, env: 'preview' | 'production'): Promise<void>;
  removeSecret(name: string, env: 'preview' | 'production'): Promise<void>;
  buildPreviewURL(prNumber: number): string;
}
```

## Why these adapters specifically (free-tier survey)

| Need | Recommendation |
|------|----------------|
| Best Next.js DX, zero-config | Vercel Hobby |
| Most generous free tier | Cloudflare Pages (unlimited bandwidth) |
| Long-lived Node + free | Fly.io (3 VMs free) |
| Static + serverless functions | Netlify |
| Full control, BYO VPS | Self-host docker (OpenNext) |
| Per-PR DB branching to match | All adapters work with Neon (DB) — adapter only owns the web tier |

## Cross-adapter portability (per §29 of the design doc)

Bootstrap writes a `MIGRATION.md` to every project documenting the exact escape path from the chosen adapter to each alternative — typically <1 day of work using OpenNext for the web tier.

---

*Status: directory + skeleton README. Day 5 of the build plan ships the Vercel adapter (default).*
