# LEARNINGS_APPLIED

> Single source of truth: every class of bug the scaffold pre-empts by construction.
>
> Rule of thumb: if a class of bug has cost a real project a fix commit, the
> scaffold must make that bug **impossible by construction** — not just
> documented as a footgun.

## How to use

1. **Before adding a new integration**, scan the table below and check whether
   any landmine applies. If yes, encode the prevention into the integration's
   manifest / patch files / merge files / tests.
2. **After adding a new integration**, run the landmine suite and add a new
   row + assertion if you discovered something a real project had already paid
   for.
3. **Never ship a scaffold fix that wasn't first listed here.** A fix that
   isn't on this list is evidence we are still building from scratch instead
   of from learnings.

---

## Landmines pre-empted by the scaffold

Every row below started life as a real bug in a production codebase. The
"prevention" column is how the scaffold makes that exact class of bug
impossible to ship by default.

| # | Landmine | Prevention | Test |
|---|----------|-----------|------|
| 1 | `prisma generate` not run after install → `Cannot find module '@prisma/client'` at build time | The `prisma` integration's `merge/package.json` adds `scripts.postinstall = "prisma generate"`. pnpm/npm/yarn run it automatically. **No custom executor in the orchestrator.** | `landmines.test.ts` → `landmine: prisma codegen` |
| 2 | `.next` / `.turbo` / `.pnpm-store` / `*.tsbuildinfo` accidentally committed | `nodejs-typescript-base/patch/.gitignore` ignores all of these plus `!.env.example` to keep the committed template | `landmines.test.ts` → `landmine: .gitignore covers known build/IDE/env outputs` |
| 3 | Build broken silently because no `type-check` script in CI | `nodejs-typescript-base/patch/package.json` ships `type-check` and `clean` scripts | `landmines.test.ts` → `landmine: type-check + clean scripts` |
| 4 | `pnpm format:check` flags `pnpm-lock.yaml` | `eslint-prettier/patch/.prettierignore` excludes `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` | `landmines.test.ts` → `landmine: prettier ignores lockfiles` |
| 5 | ESLint v9 uses flat config (`eslint.config.js`); `.eslintrc.json` no longer auto-discovered | `eslint-prettier/patch/eslint.config.js` (flat), no `.eslintrc.json` | `landmines.test.ts` → `landmine: ESLint v9 flat config` |
| 6 | `.env.example` rendered with `// === ===` slash comments instead of `# === ===` | `detectCommentStyle()` regex handles dotfiles `(^\|\/)\.env(\..+)?$` | `landmines.test.ts` → `landmine: env files use # comments` |
| 7 | DB-driver integration falsely depends on the ORM integration — they should be siblings on `DATABASE_URL` | Each driver integration has `depends_on_integrations: []`. They both read `DATABASE_URL` independently | `landmines.test.ts` → `landmine: postgres driver does NOT depend on prisma` |
| 8 | Bumping a major version in lockstep with what npm publishes as `latest` | `next-app` integration name is unversioned; manifest declares `^16.2.0`. Regression test asserts `^16.x` is current stable | `landmines.test.ts` → `landmine: Next.js stable major` |
| 9 | Next.js `tsconfig` conflicts with base `rootDir`/`outDir` | JSON-merge `$delete` sentinel; `next-app/merge/tsconfig.json` deletes `rootDir` + `outDir` | `landmines.test.ts` → `landmine: Next.js tsconfig drops base rootDir/outDir` |
| 10 | `DATABASE_URL` duplicated by two integrations (ORM + driver) | Only DB-driver siblings ship env templates with `DATABASE_URL`. ORM (`prisma`) deliberately has no `env.template`. | (file-presence check; row 7 enforces) |
| 11 | Scaffolding into a non-empty directory clobbers user files | Orchestrator throws `PRECONDITION_FAILED` if `outDir` is non-empty | `cli.test.ts` → "refuses to scaffold into a non-empty dir" |
| 12 | `predev` should warm up local infra (`docker compose up -d` + `pg_isready` + `redis-cli ping`) before starting dev | `postgres-local-docker` integration's `predev` script and `redis-local-docker`'s `compose.redis.yml` | (live smoke needs docker daemon) |
| 13 | Multi-stage Dockerfile must use alpine + openssl + non-root uid 1001 + HEALTHCHECK + **schema files copied BEFORE `pnpm install`** so `postinstall: prisma generate` finds them | `dockerfile-deploy/patch/Dockerfile` ships this verbatim | `landmines.test.ts` → 4 assertions (COPY ordering, frozen-lockfile, uid 1001, openssl) |
| 14 | `pnpm install --frozen-lockfile` in Docker / CI (otherwise reproducibility silently broken) | `dockerfile-deploy/patch/Dockerfile` + `github-actions-ci/patch/.github/workflows/ci.yml` | `landmines.test.ts` → 2 assertions |
| 15 | Pre-commit hook: lint → tsc, blocking | `git-hooks/patch/.githooks/pre-commit` + `prepare` script that wires `core.hooksPath` | **Live-smoked** — hook fires on real `git commit`, blocks when eslint can't run |
| 16 | Pre-push hook: build gate + **doc-update guard** (block pushes that ship substantive code without a `*.md` tick) | `git-hooks/patch/.githooks/pre-push` with `SUBSTANTIVE_RE` / `MECHANICAL_RE` filter, `SKIP_DOC_GUARD=1` audit-logged override | `landmines.test.ts` → 3 assertions |
| 17 | Auto dep updates (avoid silent CVE drift) | `dependabot-config` integration with grouped minor+patch + separate majors | – |
| 18 | Playwright headed-by-default in local dev so humans actually **see** the browser flow; trace + screenshot on failure always-on | `playwright-e2e/patch/playwright.config.ts` (headed default; `PLAYWRIGHT_HEADLESS=1` to override) | `landmines.test.ts` → 3 assertions (headless override, always-on trace, step helper attach) |
| 19 | Date / `process.env` / path code passes on UTC dev machines but breaks under non-UTC user TZ | `vitest/patch/src/__tests__/index.test.ts` ships a `vi.stubEnv('TZ', …)` × 3-zones sample test | `landmines.test.ts` → asserts the sample test references multiple zones |
| 20 | GitHub Actions `${{ … }}` substitution syntax mistaken for the scaffold's `{{ var }}` placeholder syntax | Placeholder regex uses negative lookbehind `(?<!\$)` to skip `$`-prefixed expressions | `landmines.test.ts` → 2 assertions |
| 21 | E2E selectors silently drift after a UI refactor (the `[data-testid="phone"]` → `[name="phone-number"]` class of bug) | The `step()` helper in `playwright-e2e` attaches a screenshot per call so trace viewer makes the drift visible | (defensive — caller-side discipline still required) |
| 22 | "Build before claiming success" — green unit tests don't mean it ships | Default scaffold-output package.json runs `tsc --noEmit` separately from `build`; `pre-push` hook gates on `pnpm build` | row 3 + row 16 |

## Landmines STILL NOT YET in the scaffold

| Landmine | Where it should land |
|----------|----------------------|
| App-domain timezone formatting (server-authoritative date strings, frontend reads pre-formatted labels) | Documentation in a future `nestjs-api` or `node-server` integration; not encoded in the scaffold itself because it's app-logic |
| Library-first reflex (no hand-rolled regex for hex/url/date/json/phone) | Documented in `PREFLIGHT_CHECKLIST.md`; not enforceable mechanically |
| External-credentials-first (surface every API key required at G1 of planning, not when the integration runs) | Future `setup-keys.sh` script in scaffolded projects + a "claim free tiers" interactive checklist |

## Process — adding a new integration

1. **Read this file top to bottom.** Especially the "NOT YET in the scaffold"
   section — if your new integration touches one of those areas, encode the
   prevention now.
2. **Look for prior art.** Has another mature codebase done this thing
   already? If yes, copy the **shape** (idiomatic mechanism), not the
   **literal code** (which may be on older deps).
3. **Run the landmine suite.** `pnpm vitest run __tests__/landmines.test.ts`.
   No regressions allowed.
4. **If you discover a new bug class while building**, ask: did prior art
   already solve this? If yes — that's a process failure (you should have
   read this file). Fix the integration AND add a row to the table above AND
   add an assertion.
