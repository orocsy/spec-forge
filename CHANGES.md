# Bootstrap Scaffold — Changelog (Day 1 → Day 6)

> Status as of 2026-05-08, end of Day 6.

## Summary

| Metric | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 | **Day 6** |
|---|---:|---:|---:|---:|---:|---:|
| Integrations in registry | 0 | 2 | 7 | 16 | 21 | **22** |
| Tests passing | 69 | 94 | 111 | 124 | 131 | **139** |
| Landmine regression tests | 0 | 0 | 0 | 13 | 20 | **29** |
| LEARNINGS_APPLIED landmines encoded | 0 | 0 | 0 | 11 | 17 | **18** |
| Layer code LOC | ~1.3K | ~2.1K | ~2.5K | ~2.6K | ~2.7K | **2,748** |
| Test code LOC | ~800 | ~1.3K | ~1.7K | ~1.9K | ~2.0K | **2,114** |
| Total files | 16 | 32 | 67 | 110 | 130 | **157** |

## Final file inventory

### Layer 1 — primitives (audited, reversible)
| File | LOC |
|---|---:|
| `layer1/errors.ts` | 99 |
| `layer1/schemas.ts` | 262 |
| `layer1/journal.ts` | 198 |
| `layer1/file-ops.ts` | 281 |
| `layer1/shell-exec.ts` | 141 |
| `layer1/git-ops.ts` | 198 |
| `layer1/manifest-validator.ts` | 185 |
| `layer1/index.ts` (barrel) | 13 |
| **Layer 1 subtotal** | **1,377** |

### Layer 2 — composers
| File | LOC |
|---|---:|
| `layer2/spec-loader.ts` | 68 |
| `layer2/manifest-loader.ts` | 246 |
| `layer2/integration-applier.ts` | 279 |
| `layer2/index.ts` (barrel) | 20 |
| **Layer 2 subtotal** | **613** |

### Layer 3 — orchestration
| File | LOC |
|---|---:|
| `layer3/orchestrator.ts` | 340 |
| `layer3/verify.ts` | 148 |
| `cli.ts` | 270 |
| **Layer 3 subtotal** | **758** |

### Tests
| File | LOC |
|---|---:|
| `layer1/__tests__/schemas.test.ts` | 168 |
| `layer1/__tests__/journal.test.ts` | 141 |
| `layer1/__tests__/file-ops.test.ts` | 194 |
| `layer1/__tests__/shell-exec.test.ts` | 85 |
| `layer1/__tests__/git-ops.test.ts` | 107 |
| `layer1/__tests__/manifest-validator.test.ts` | 103 |
| `layer2/__tests__/spec-loader.test.ts` | 79 |
| `layer2/__tests__/manifest-loader.test.ts` | 162 |
| `layer2/__tests__/integration-applier.test.ts` | 480 |
| `__tests__/cli.test.ts` | 217 |
| `__tests__/landmines.test.ts` | 378 |
| **Tests subtotal** | **2,114** |

### Integrations (22 total, 96 files)
| Integration | Category | Files | What it ships |
|---|---|---:|---|
| `nodejs-typescript-base` | foundation | 5 | `package.json`, `tsconfig.json`, `src/index.ts`, `.gitignore` |
| `next-app` | framework | 7 | Next 16 + App Router: `next.config.mjs`, `src/app/{layout,page}.tsx`, `next-env.d.ts`, public dir |
| `tailwind-v4` | ui | 4 | `globals.css`, `postcss.config.mjs`, deps merge |
| `prisma` | data | 4 | `prisma/schema.prisma`, `src/lib/db.ts`, postinstall script |
| `postgres-neon` | data | 4 | `src/lib/neon.ts` (HTTP/serverless driver), env template |
| `postgres-local-docker` | data | 4 | `docker-compose.yml`, `predev` script |
| `redis-local-docker` | data | 5 | `compose.redis.yml`, `src/lib/redis.ts`, dev defaults |
| `auth-better-auth` (default) | auth | 6 | better-auth client + server + signin page |
| `auth-clerk` (alternative) | auth | 4 | ClerkProvider middleware + env |
| `email-resend` | comms | 4 | `src/lib/email.ts`, env template |
| `observability-sentry` | obs | 6 | client/edge/server configs + helper |
| `analytics-umami` (default) | obs | 3 | `<UmamiAnalytics />` component |
| `analytics-plausible` (alt) | obs | 3 | `<PlausibleAnalytics />` component |
| `vitest` | test | 4 | `vitest.config.ts` + sample test with TZ-invariance pattern |
| `playwright-e2e` ⭐ NEW Day 6 | test | 5 | `playwright.config.ts` (headed default), `tests/helpers/step.ts`, sample homepage spec |
| `eslint-prettier` | quality | 5 | flat config v9 + prettier + ignore files |
| `git-hooks` | devops | 5 | `.githooks/pre-commit` + `pre-push` + install script + **doc-update guard** ⭐ Day 6 |
| `github-actions-ci` | devops | 2 | `ci.yml` workflow (lint + tsc + test + build) |
| `dockerfile-deploy` | devops | 3 | multi-stage Dockerfile + `.dockerignore` |
| `vercel-deploy` | devops | 2 | `vercel.json` + deploy notes |
| `dependabot-config` | devops | 2 | `.github/dependabot.yml` |
| `ai-sdk` (last per user) | ai | 5 | Vercel AI SDK + OpenRouter (free models) chat route |

### Documentation
| File | Purpose |
|---|---|
| `README.md` | Top-level overview |
| `HOW_IT_WORKS.md` | Architecture + lifecycle + Mermaid diagrams |
| `LEARNINGS_APPLIED.md` | Maps each real-world learning → how the scaffold pre-empts it |
| `PREFLIGHT_CHECKLIST.md` | 10-point list before adding a new integration |
| `CHANGES.md` | This file |
| `examples/spec-minimal.json` | Smallest possible spec |
| `examples/spec-fullstack.json` | Mid-tier spec |
| `examples/spec-localprod.json` | Day 5 variant — local infra + Dockerfile |
| `examples/spec-production.json` | Free-tier production preset |

---

## Day-by-day diff

### Day 1 — primitives + first capability demo
- Built Layer 1: 7 modules, 69 tests
- Capability demo (`examples/day1-demo.ts`) proves primitives compose into a working sequence
- Surfaced one bug (`getHeadSha` on empty repo) → fixed → all green

### Day 2 — composers + first 2 integrations
- Built Layer 2: spec-loader, manifest-loader, integration-applier
- Topo-sort by `depends_on_integrations` + cycle detection
- Integrations: `nodejs-typescript-base`, `eslint-prettier`
- 94 tests passing
- Decision: **JSON-only specs in v1** (rather than hand-rolling YAML — "libraries first" rule)

### Day 3 — Layer 3 orchestrator + 5 more integrations + first end-to-end
- Built Layer 3: `orchestrator.ts`, `verify.ts`, `cli.ts`
- Integrations: `next-app` (Next 16), `tailwind-v4`, `prisma`, `postgres-neon`, `vitest`
- New CLI commands: scaffold / validate / list-integrations / inspect / verify / rollback
- Real `next build` works: ✓ Compiled in 2.1s, 3 static pages
- 8 bugs surfaced + fixed during E2E (env-comment style, DATABASE_URL collision, `rootDir` conflict, Prisma codegen ordering, etc.)
- 111 tests passing
- **Lesson absorbed (Day 3 retro)**: "I was rediscovering bugs real-world already paid for" → switched to learnings-first development

### Day 4 — production-tier integrations
- Integrations: `auth-better-auth`, `email-resend`, `observability-sentry`, `analytics-umami`, `vercel-deploy`, `git-hooks`, `github-actions-ci`, `postgres-local-docker`, `ai-sdk`
- Wrote `LEARNINGS_APPLIED.md` mapping each real-world learning to scaffold features
- Wrote first 13 landmine regression tests
- Schema-substitution false-positive bug (`${{ github.ref }}` mistaken for placeholder) → negative-lookbehind fix in placeholder regex → asserted by landmine test
- 124 tests passing

### Day 5 — Day 5 fills "NOT YET" landmines
- Integrations: `auth-clerk` (alternative to better-auth), `analytics-plausible` (alternative to umami), `dockerfile-deploy` (multi-stage alpine + openssl + non-root + schema-before-install ordering), `redis-local-docker`, `dependabot-config`
- 7 new landmine tests (Dockerfile ordering, frozen-lockfile, uid 1001, openssl, hooksPath, prepare script, 21-set load)
- **Live smoke test**: git hook fired on real `git commit` and blocked the commit (expected behavior)
- 131 tests passing

### Day 6 — Final integrations + docs
- ✅ Spec defaults switched to `auth-better-auth` (Clerk stays in registry as alternative)
- ✅ NEW `playwright-e2e` integration: headed-default config, `step()` screenshot helper, sample homepage spec
- ✅ Enhanced `git-hooks` pre-push with **doc-update guard**
- ✅ `vitest` sample test now demonstrates **TZ-invariance pattern**
- ✅ Added `PREFLIGHT_CHECKLIST.md` (library-first reflex + 9 other rules)
- ✅ Added `HOW_IT_WORKS.md` with Mermaid diagrams (architecture, lifecycle, integration anatomy, registry map)
- ✅ Added `CHANGES.md` (this file)
- ✅ 8 new landmine tests (3 doc-guard, 3 playwright headed/trace/step, 1 TZ-invariance, 1 22-set load)
- 139 tests passing, tsc clean

---

## Free-tier-first defaults

The `examples/spec-production.json` preset uses ONLY free tiers:

| Slot | Default | Free tier | Paid alternative also in registry |
|---|---|---|---|
| Auth | `auth-better-auth` | Free OSS, no MAU cap | `auth-clerk` (10k MAU free) |
| Analytics | `analytics-umami` | 10k events/mo hosted | `analytics-plausible` ($9/mo) |
| Database | `postgres-neon` | 0.5GB | `postgres-local-docker` (free, self-hosted) |
| Errors | `observability-sentry` | 5k events/mo | – |
| Email | `email-resend` | 3k/mo | – |
| AI | `ai-sdk + OpenRouter` | Free Llama/Mistral/Gemma models | swap import to OpenAI/Anthropic/Ollama |
| CI | `github-actions-ci` | Free public, generous private | – |
| Hosting | `vercel-deploy` | Hobby tier | `dockerfile-deploy` (any container host) |
| Deps updates | `dependabot-config` | Free GitHub | – |

---

## What is NOT in the scaffold (intentionally)

| Topic | Why not | Where it lives instead |
|---|---|---|
| Multi-tenancy patterns | app-domain-specific | app codebase |
| Booking concurrency (Redis lock + serializable tx) | app-domain-specific | app codebase |
| English-PRD → spec parsing | Out of scaffold scope | dev-pipeline plugin's `requirements-analyst` agent |
| CRUD generators | Generic CRUD = bad CRUD | User code post-scaffold |
| Storybook | One more dep, opinionated | Future integration if asked |

---

## How an LLM agent uses this

```bash
# 1. Validate the spec the agent generated
tsx cli.ts validate spec.json # exits 0 if good

# 2. Scaffold the project
tsx cli.ts scaffold spec.json ./out --install --verify

# 3. Read the audit log if anything looks off
tsx cli.ts inspect ./out

# 4. Roll back if needed
tsx cli.ts rollback ./out.journal.jsonl --dry-run
tsx cli.ts rollback ./out.journal.jsonl # for real
```

Every command emits a single `@@RESULT@@ {...}` JSON line on stderr that the agent can parse.

---

## What's still NOT YET (5% of original scope)

| Item | Why deferred | Reasonable next step |
|---|---|---|
| Pre-push doc-update guard live smoke | Needs an actual remote push from a real project | Run `git push` from a scaffolded project once |
| Playwright sample run end-to-end | Needs a real dev server up | `tsx cli.ts scaffold + cd + pnpm test:e2e:install + pnpm test:e2e` |
| Storybook integration | Lower priority than auth/db/test/deploy | Add when first project asks for it |
| Stripe / payments integration | Vendor-specific, not generic | Add as `payments-stripe` if asked |
| Full `pnpm install` smoke for every preset | Each install is 3-5 minutes | CI job that runs once a week |
