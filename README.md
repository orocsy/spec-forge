# spec-forge

**Forge a real, working full-stack project from a JSON spec — no hand-coded steps.**

`spec-forge` is an LLM-agent-friendly scaffolder. You hand it a structured project spec; it produces a real, building, linting, testing project from a curated set of integrations — every choice traceable, every step audited, every operation reversible.

## What it does

```bash
# 1. Validate the spec
$ tsx cli.ts validate spec.json
✓ Spec valid: my-app v0.1.0

# 2. Scaffold the project
$ tsx cli.ts scaffold spec.json ./out --install
✓ Bootstrap complete in 4m32s
  install: ✓ pnpm install (272s)
  → 22 integrations applied, 35 files written, git committed

# 3. Read the audit log
$ tsx cli.ts inspect ./out
[2026-05-08T00:30:00Z] B0 spec.parsed
[2026-05-08T00:30:00Z] B2 file.write package.json
…

# 4. Roll back if needed
$ tsx cli.ts rollback ./out.journal.jsonl
```

Every command emits a single `@@RESULT@@ {...}` JSON line on stderr that an LLM agent can parse.

## Why

Most scaffolders give you templates that drift. `spec-forge` gives you a **registry of pre-vetted integrations** that compose by manifest, with hard regression assertions for every class of bug a real production project has paid to learn. See `LEARNINGS_APPLIED.md` for the full list.

## What's in the box

22 integrations across:

- **Foundation** — `nodejs-typescript-base`, `next-app` (Next 16 App Router), `tailwind-v4`
- **Data** — `prisma`, `postgres-neon`, `postgres-local-docker`, `redis-local-docker`
- **Auth** — `auth-better-auth` (default, free OSS), `auth-clerk` (alternative)
- **AI** — `ai-sdk` with OpenRouter (free models)
- **Email** — `email-resend`
- **Observability** — `observability-sentry`, `analytics-umami` (default), `analytics-plausible` (alt)
- **Test** — `vitest` (with TZ-invariance sample), `playwright-e2e` (headed-default + step screenshots)
- **Quality** — `eslint-prettier` (v9 flat config)
- **DevOps** — `git-hooks` (pre-commit + pre-push doc-update guard), `github-actions-ci`, `dockerfile-deploy` (multi-stage alpine + non-root), `vercel-deploy`, `dependabot-config`

Free-tier defaults across the board: every service in the production preset has a real free tier.

## Architecture (at a glance)

Three strict layers, downward-only imports:

```
Layer 3 — orchestrator + verify + CLI         (drive the B0→B6 lifecycle)
Layer 2 — composers (spec/manifest/applier)   (validate, sort, apply)
Layer 1 — primitives (file/shell/git/journal) (audited, reversible)

Integration registry — 22 manifest-driven units in `integrations/`
```

See `HOW_IT_WORKS.md` for diagrams + the full lifecycle sequence.

## Quick start

```bash
pnpm install
pnpm test                                  # 139 tests, ~5s
tsx cli.ts list-integrations               # see what's in the registry
tsx cli.ts scaffold examples/spec-fullstack.json ./my-app --install
```

## Adding an integration

Read `PREFLIGHT_CHECKLIST.md` first (10 rules learned the hard way), then copy any existing integration as a template:

```
integrations/<name>/
├── manifest.json     # IntegrationManifest (Zod-validated)
├── patch/            # files copied verbatim into target
├── merge/            # JSON deep-merged into target files
├── fence/            # text bodies fence-appended into shared files
├── env.template      # appended into target's .env.example
└── dev-defaults.env  # appended into target's .env.local
```

After your manifest passes the landmine suite (`pnpm vitest run __tests__/landmines.test.ts`), you're done.

## License

MIT. See `LICENSE`.

## Status

v0.1.0-alpha. Not yet published. Local development.
