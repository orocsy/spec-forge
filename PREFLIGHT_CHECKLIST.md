# Scaffold Preflight Checklist

Before adding a new integration to the registry, walk this list. Each item is a class of bug that has cost real projects multiple fix commits — failing the check now means rediscovering the bug in every produced project.

## 1. Library-first reflex

> "Stop hand-rolling regex for solved domains."

Before writing any parser, validator, or formatter, ask:

- [ ] Is there a 100k+ download/week npm package that solves this? (Use it.)
- [ ] Could a TypeScript built-in (`URL`, `Intl.DateTimeFormat`, `Number.parse*`) handle it?
- [ ] Is there a Zod schema or validator decorator (`class-validator`) that would do this with a one-liner?

Red-flag phrases that mean **stop and reach for a lib**:

- "I'll just write a regex for…"
- "The library accepts too much…"
- "I only need the simple case…"
- "It's only 5 lines…"

If a library's default is "slightly wrong," **compose** it with a narrowing wrapper — don't replace it with hand-rolled code.

**Domains where this rule has burned real projects**:
- Hex colors → `class-validator` `@IsHexColor()`
- URL hostnames → `new URL(input).host`
- Date parsing → `date-fns` / `date-fns-tz` (NEVER hand-rolled `YYYY-MM-DD` regex)
- JSON / YAML → `JSON.parse` / `yaml` package
- Phone numbers → `libphonenumber-js`

## 2. Environment invariance

Any code that touches one of these MUST get a TZ-override or path-override test:

- [ ] `new Date()` / `Date.now()`
- [ ] `parseISO`, `format`, `Intl.DateTimeFormat`
- [ ] Anything reading `process.env`
- [ ] Anything reading paths from `path.resolve(process.cwd(), …)`

**Test pattern** (already in the `vitest` integration's `src/__tests__/index.test.ts`):

```ts
it.each([
  ['Asia/Hong_Kong'],
  ['America/Los_Angeles'],
  ['UTC'],
])('produces the same output under TZ=%s', (tz) => {
  vi.stubEnv('TZ', tz);
  expect(myFn(instant)).toBe(expected);
});
```

> "Works on our UTC server" ≠ "works in general."

## 3. Codegen at install time

If your integration generates code at install time (Prisma, GraphQL codegen, tRPC routers, Drizzle Kit, etc.):

- [ ] Use the standard `package.json` `postinstall` script (NOT a custom `post_install_commands` field — the npm lifecycle is the right hook).
- [ ] In any Dockerfile, copy the schema/source file BEFORE `pnpm install --frozen-lockfile`.
- [ ] Add a regression assertion in `__tests__/landmines.test.ts` proving the COPY ordering.

## 4. Multi-stage Dockerfile invariants

If you're adding a deploy adapter that produces a Dockerfile:

- [ ] Multi-stage (builder + runner)
- [ ] Alpine base image
- [ ] `apk add openssl` if Prisma is in the dep set (Prisma engine needs it)
- [ ] Non-root user (`uid 1001`)
- [ ] `HEALTHCHECK` that pings a real endpoint
- [ ] `pnpm install --frozen-lockfile` (not plain `pnpm install`)
- [ ] Schema files copied BEFORE `pnpm install` (so `postinstall: prisma generate` can find them)

## 5. Visual verification

If your integration touches a UI:

- [ ] Add a sample E2E spec (Playwright) that exercises the produced UI.
- [ ] Use the `step()` helper to attach screenshots at each meaningful state.
- [ ] Default to **headed** in local; `PLAYWRIGHT_HEADLESS=1` for CI.
- [ ] Trace + screenshot on failure are always-on.

## 6. Self-contained verification

Each integration's `verification.dev` command must be:

- [ ] Self-contained — does not depend on other integrations' scripts (e.g. don't run `pnpm build` if a downstream integration could override the `build` script).
- [ ] Cheap — runs in <5s.
- [ ] Boolean — exit code 0 = pass, non-zero = fail (no string parsing).

Examples that follow this rule:
- ✅ `pnpm exec tsc --version`
- ✅ `node -e "require('@neondatabase/serverless'); console.log('ok')"`
- ❌ `pnpm run build && node dist/index.js` (fragile if downstream changes `build`)
- ❌ `pnpm exec tailwindcss --help` (Tailwind v4 dropped this CLI; broke verify)

## 7. Workflow / PR / process guards

These are git-hooks integration features. Verify:

- [ ] `pre-commit` runs lint + type-check
- [ ] `pre-push` runs build
- [ ] `pre-push` blocks pushes that ship substantive code without a doc tick
- [ ] Both have `SKIP_*` env-var overrides for incidents (audit-logged)

## 8. Free-tier first

Tier-1 default (the `examples/spec-production.json` preset) MUST use only free tiers:

- [ ] Auth: `auth-better-auth` (free OSS, no MAU cap) — NOT Clerk (10k MAU cap)
- [ ] DB: `postgres-neon` (0.5GB free) or `postgres-local-docker` (free, self-hosted)
- [ ] Cache: `redis-local-docker` (free, self-hosted) — NOT Upstash unless you opt in
- [ ] Email: `email-resend` (3k/month free)
- [ ] Errors: `observability-sentry` (5k events/month free)
- [ ] Analytics: `analytics-umami` (10k events/month free hosted)
- [ ] CI: `github-actions-ci` (free for public; generous private)
- [ ] Hosting: `vercel-deploy` (Hobby tier free) or `dockerfile-deploy` for self-host
- [ ] Deps: `dependabot-config` (free GitHub)

Paid alternatives (`auth-clerk`, `analytics-plausible`) are kept in the registry but NOT in the default spec preset.

## 9. Regression assertion required

For every new integration:

- [ ] Add a test in `__tests__/landmines.test.ts` that asserts the most fragile invariant from this checklist (e.g. "Dockerfile orders prisma BEFORE pnpm install", "GitHub Actions `${{ }}` survives placeholder substitution").
- [ ] Run the full test suite — must stay green.

## 10. App-domain logic stays out of the scaffold

The scaffold ships **shapes**, not **app logic**. Things that DO NOT belong in any integration:

- Multi-tenancy filters / `tenantId` patterns — domain-specific
- Booking-style concurrency (Redis lock + serializable transactions) — domain-specific
- CRUD generators — generic CRUD = bad CRUD
- Business rules of any kind

If a future integration encodes domain logic, push back: it belongs in the user's app code, not the scaffold registry.
