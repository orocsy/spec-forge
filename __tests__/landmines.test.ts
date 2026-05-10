/**
 * Landmine regression tests — assert that the bundled integration set
 * pre-empts every known real-world bug class. If you add a new
 * integration and one of these tests fails, you are about to ship a
 * regression of a bug real-world already paid for.
 *
 * Each test cites the real-world source of the learning so future
 * maintainers know WHY this assertion exists.
 *
 * Run with: pnpm vitest run __tests__/landmines.test.ts
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadIntegration, loadIntegrationsByName } from '../layer2/index.js';
import { orchestrate } from '../layer3/orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const REGISTRY = join(ROOT, 'integrations');

describe('landmine: prisma codegen runs automatically', () => {
 it('prisma integration declares `postinstall: prisma generate`', async () => {
 const i = await loadIntegration(join(REGISTRY, 'prisma'));
 const merge = i.jsonMergeBodies['package.json'] as {
 scripts?: Record<string, string>;
 };
 expect(merge.scripts?.postinstall).toBe('prisma generate');
 });

 it('prisma manifest does NOT use a custom post_install_commands escape hatch', async () => {
 const raw = await fs.readFile(join(REGISTRY, 'prisma', 'manifest.json'), 'utf8');
 expect(raw).not.toMatch(/post_install_commands/);
 });
});

describe('landmine: .gitignore covers known build/IDE/env outputs', () => {
 let outDir: string;
 let journalPath: string;
 beforeEach(async () => {
 outDir = await fs.mkdtemp(join(tmpdir(), 'landmine-gitignore-'));
 journalPath = `${outDir}.journal.jsonl`;
 // mkdtemp creates a non-empty dir; orchestrator refuses non-empty.
 await fs.rm(outDir, { recursive: true, force: true });
 });
 afterEach(async () => {
 await fs.rm(outDir, { recursive: true, force: true });
 await fs.rm(journalPath, { force: true });
 });

 it('a fresh scaffold ignores .next, .turbo, .pnpm-store, *.tsbuildinfo, but tracks .env.example', async () => {
 const specPath = join(outDir + '-spec.json');
 await fs.writeFile(
 specPath,
 JSON.stringify({
 meta: {
 name: 'landmine-test',
 description: 'gitignore landmine regression',
 spec_schema_version: 1,
 },
 integrations: [
 { name: 'nodejs-typescript-base', category: 'observability', version: '1.0.0' },
 ],
 })
 );
 await orchestrate({
 specPath,
 outDir,
 registryDir: REGISTRY,
 skipGit: true, // we just want the file tree, not the commit
 });
 const gitignore = await fs.readFile(join(outDir, '.gitignore'), 'utf8');
 // Known real-world landmines:
 expect(gitignore).toMatch(/\.next/);
 expect(gitignore).toMatch(/\.turbo/);
 expect(gitignore).toMatch(/\.pnpm-store/);
 expect(gitignore).toMatch(/\*\.tsbuildinfo/);
 // Pattern: ignore all .env* EXCEPT .env.example (committed template).
 expect(gitignore).toMatch(/!\.env\.example/);
 expect(gitignore).toMatch(/\.env\.\*\.local/);
 await fs.rm(specPath, { force: true });
 });
});

describe('landmine: type-check + clean scripts present', () => {
 it('nodejs-typescript-base ships a `type-check` and `clean` script', async () => {
 const i = await loadIntegration(join(REGISTRY, 'nodejs-typescript-base'));
 const pkgRaw = await fs.readFile(
 join(i.dir, 'patch', 'package.json'),
 'utf8'
 );
 const pkg = JSON.parse(pkgRaw) as { scripts: Record<string, string> };
 expect(pkg.scripts['type-check']).toBe('tsc --noEmit');
 expect(pkg.scripts['clean']).toBeTruthy();
 });
});

describe('landmine: prettier ignores lockfiles', () => {
 it('eslint-prettier ships .prettierignore that excludes pnpm-lock.yaml', async () => {
 const i = await loadIntegration(join(REGISTRY, 'eslint-prettier'));
 const ignore = await fs.readFile(
 join(i.dir, 'patch', '.prettierignore'),
 'utf8'
 );
 expect(ignore).toMatch(/pnpm-lock\.yaml/);
 expect(ignore).toMatch(/package-lock\.json/);
 expect(ignore).toMatch(/yarn\.lock/);
 });
});

describe('landmine: ESLint v9 flat config (NOT .eslintrc.json)', () => {
 it('eslint-prettier ships eslint.config.js (flat), not .eslintrc.json', async () => {
 const i = await loadIntegration(join(REGISTRY, 'eslint-prettier'));
 const files = i.patchFiles;
 expect(files).toContain('eslint.config.js');
 expect(files).not.toContain('.eslintrc.json');
 });
});

describe('landmine: env files use # comments (not //)', () => {
 it('detectCommentStyle picks # for .env, .env.local, .env.example', async () => {
 // Indirect test through fileOps — apply a fake integration with env.template
 // would be heavy; instead just import detectCommentStyle by behavior.
 const { fileOps } = await import('../layer1/index.js');
 // Apply an upsertFenced into a freshly-created `.env.example` and read.
 const tmp = await fs.mkdtemp(join(tmpdir(), 'env-style-'));
 const envPath = join(tmp, '.env.example');
 const journalPath = join(tmp, 'j.jsonl');
 await fileOps.upsertFenced(
 { journalPath, run_id: 't', phase: 'B2' },
 envPath,
 '@x/y',
 'FOO=bar'
 );
 const content = await fs.readFile(envPath, 'utf8');
 expect(content).toMatch(/# === @x\/y ===/); // hash style, not //
 expect(content).not.toMatch(/\/\/ === @x\/y ===/);
 await fs.rm(tmp, { recursive: true, force: true });
 });
});

describe('landmine: postgres-neon does NOT depend on prisma (Day 3 decoupling)', () => {
 it('postgres-neon manifest declares no integration deps', async () => {
 const i = await loadIntegration(join(REGISTRY, 'postgres-neon'));
 expect(i.manifest.depends_on_integrations).toEqual([]);
 });
});

describe('landmine: Next.js is on a STABLE major (per npm latest dist-tag)', () => {
 // We hardcode this as a regression check — every time the scaffold's
 // Next major bumps, this test should bump too. Keeps the integration
 // honest about the version it claims to support.
 it('next-app advertises a v16.x stable major', async () => {
 const i = await loadIntegration(join(REGISTRY, 'next-app'));
 const merge = i.jsonMergeBodies['package.json'] as {
 dependencies?: Record<string, string>;
 };
 expect(merge.dependencies?.next).toMatch(/^\^16\./);
 });
});

describe('landmine: Next.js tsconfig drops base rootDir/outDir (Day 3 $delete sentinel)', () => {
 it('next-app json_merge for tsconfig deletes rootDir + outDir', async () => {
 const i = await loadIntegration(join(REGISTRY, 'next-app'));
 const tsMerge = i.jsonMergeBodies['tsconfig.json'] as {
 compilerOptions: Record<string, unknown>;
 };
 expect(tsMerge.compilerOptions.rootDir).toBe('$delete');
 expect(tsMerge.compilerOptions.outDir).toBe('$delete');
 });
});

describe('landmine: GitHub Actions `${{ ... }}` is NOT mistaken for a scaffold placeholder', () => {
 it('github-actions-ci ships a workflow with literal `${{ github.ref }}` and `${{ env.NODE_VERSION }}` that survives substitution', async () => {
 const i = await loadIntegration(join(REGISTRY, 'github-actions-ci'));
 // The patch file must contain GH Actions expressions that would
 // otherwise look like our placeholders.
 const wf = await fs.readFile(
 join(i.dir, 'patch', '.github/workflows/ci.yml'),
 'utf8'
 );
 expect(wf).toMatch(/\$\{\{\s*github\.ref\s*\}\}/);
 expect(wf).toMatch(/\$\{\{\s*env\.NODE_VERSION\s*\}\}/);
 });

 it('placeholder regex excludes `$`-prefixed expressions (negative lookbehind)', async () => {
 const { applyIntegration, loadIntegration: loadI } = await import('../layer2/index.js');
 const tmp = await fs.mkdtemp(join(tmpdir(), 'gh-actions-'));
 const journalPath = join(tmp, 'j.jsonl');
 const target = join(tmp, 'out');
 const i = await loadI(join(REGISTRY, 'github-actions-ci'));
 await applyIntegration(
 { journalPath, run_id: 't', targetDir: target, vars: {} },
 i
 );
 const written = await fs.readFile(
 join(target, '.github/workflows/ci.yml'),
 'utf8'
 );
 // `${{ github.ref }}` must survive verbatim.
 expect(written).toMatch(/\$\{\{\s*github\.ref\s*\}\}/);
 await fs.rm(tmp, { recursive: true, force: true });
 });
});

describe('landmine: Dockerfile orders prisma schema BEFORE pnpm install', () => {
 it('dockerfile-deploy COPY prisma comes before RUN pnpm install', async () => {
 const i = await loadIntegration(join(REGISTRY, 'dockerfile-deploy'));
 const df = await fs.readFile(join(i.dir, 'patch', 'Dockerfile'), 'utf8');
 const prismaIdx = df.indexOf('COPY prisma');
 const installIdx = df.search(/RUN\s+pnpm\s+install/);
 expect(prismaIdx).toBeGreaterThan(-1);
 expect(installIdx).toBeGreaterThan(-1);
 expect(prismaIdx).toBeLessThan(installIdx);
 });

 it('dockerfile-deploy uses --frozen-lockfile (CI / Docker invariant)', async () => {
 const i = await loadIntegration(join(REGISTRY, 'dockerfile-deploy'));
 const df = await fs.readFile(join(i.dir, 'patch', 'Dockerfile'), 'utf8');
 expect(df).toMatch(/pnpm install --frozen-lockfile/);
 });

 it('dockerfile-deploy uses non-root user', async () => {
 const i = await loadIntegration(join(REGISTRY, 'dockerfile-deploy'));
 const df = await fs.readFile(join(i.dir, 'patch', 'Dockerfile'), 'utf8');
 expect(df).toMatch(/--uid 1001/);
 expect(df).toMatch(/USER nextjs/);
 });

 it('dockerfile-deploy installs openssl for Prisma engine (alpine specifics)', async () => {
 const i = await loadIntegration(join(REGISTRY, 'dockerfile-deploy'));
 const df = await fs.readFile(join(i.dir, 'patch', 'Dockerfile'), 'utf8');
 expect(df).toMatch(/apk add[^\n]+openssl/);
 });
});

describe('landmine: github-actions-ci uses --frozen-lockfile', () => {
 it('CI workflow runs `pnpm install --frozen-lockfile`', async () => {
 const i = await loadIntegration(join(REGISTRY, 'github-actions-ci'));
 const wf = await fs.readFile(join(i.dir, 'patch', '.github/workflows/ci.yml'), 'utf8');
 expect(wf).toMatch(/pnpm install --frozen-lockfile/);
 });
});

describe('landmine: git-hooks wires .githooks via core.hooksPath (no husky)', () => {
 it('install-git-hooks.sh sets core.hooksPath', async () => {
 const i = await loadIntegration(join(REGISTRY, 'git-hooks'));
 const installSh = await fs.readFile(
 join(i.dir, 'patch', 'scripts/install-git-hooks.sh'),
 'utf8'
 );
 expect(installSh).toMatch(/git config core\.hooksPath \.githooks/);
 });

 it('package.json `prepare` script runs install-git-hooks.sh', async () => {
 const i = await loadIntegration(join(REGISTRY, 'git-hooks'));
 const merge = i.jsonMergeBodies['package.json'] as { scripts?: Record<string, string> };
 expect(merge.scripts?.prepare).toMatch(/install-git-hooks\.sh/);
 });
});

describe('landmine: pre-push doc-update guard', () => {
 it('pre-push has the SUBSTANTIVE_RE / MECHANICAL_RE detection', async () => {
 const i = await loadIntegration(join(REGISTRY, 'git-hooks'));
 const hook = await fs.readFile(join(i.dir, 'patch', '.githooks/pre-push'), 'utf8');
 expect(hook).toMatch(/SUBSTANTIVE_RE=/);
 expect(hook).toMatch(/MECHANICAL_RE=/);
 });

 it('pre-push allows incident override via SKIP_DOC_GUARD=1 (audit-logged)', async () => {
 const i = await loadIntegration(join(REGISTRY, 'git-hooks'));
 const hook = await fs.readFile(join(i.dir, 'patch', '.githooks/pre-push'), 'utf8');
 expect(hook).toMatch(/SKIP_DOC_GUARD/);
 expect(hook).toMatch(/log_override/);
 });

 it('pre-push blocks substantive code without a doc tick', async () => {
 const i = await loadIntegration(join(REGISTRY, 'git-hooks'));
 const hook = await fs.readFile(join(i.dir, 'patch', '.githooks/pre-push'), 'utf8');
 expect(hook).toMatch(/PUSH BLOCKED.*substantive code/);
 // Substantive matches *.ts but mechanical regex excludes *.test.ts and *.spec.ts
 expect(hook).toMatch(/spec\|test/);
 });
});

describe('landmine: playwright-e2e is headed-by-default in local', () => {
 it('config respects PLAYWRIGHT_HEADLESS=1 + CI but defaults to headed locally', async () => {
 const i = await loadIntegration(join(REGISTRY, 'playwright-e2e'));
 const cfg = await fs.readFile(join(i.dir, 'patch', 'playwright.config.ts'), 'utf8');
 expect(cfg).toMatch(/PLAYWRIGHT_HEADLESS/);
 expect(cfg).toMatch(/headless = isCI/);
 });

 it('always-on trace + screenshot on failure (so flakes are debuggable)', async () => {
 const i = await loadIntegration(join(REGISTRY, 'playwright-e2e'));
 const cfg = await fs.readFile(join(i.dir, 'patch', 'playwright.config.ts'), 'utf8');
 expect(cfg).toMatch(/trace:\s*'retain-on-failure'/);
 expect(cfg).toMatch(/screenshot:\s*'only-on-failure'/);
 });

 it('ships a step() helper that attaches a screenshot per call (integration-walkthrough pattern)', async () => {
 const i = await loadIntegration(join(REGISTRY, 'playwright-e2e'));
 const helper = await fs.readFile(join(i.dir, 'patch', 'tests/helpers/step.ts'), 'utf8');
 expect(helper).toMatch(/testInfo\.attach/);
 expect(helper).toMatch(/page\.screenshot/);
 });
});

describe('landmine: vitest sample teaches TZ-invariance', () => {
 it('sample test uses vi.stubEnv("TZ", …) under multiple zones', async () => {
 const i = await loadIntegration(join(REGISTRY, 'vitest'));
 const sample = await fs.readFile(join(i.dir, 'patch', 'src/__tests__/index.test.ts'), 'utf8');
 expect(sample).toMatch(/Asia\/Hong_Kong/);
 expect(sample).toMatch(/America\/Los_Angeles/);
 expect(sample).toMatch(/vi\.stubEnv\(['"]TZ['"]/);
 });
});

describe('landmine: integration set installs and verifies cleanly (smoke)', () => {
 it('all 22 Day-6 integrations load + topo-sort without errors', async () => {
 const all = await loadIntegrationsByName(REGISTRY, [
 'ai-sdk',
 'analytics-plausible',
 'analytics-umami',
 'auth-better-auth',
 'auth-clerk',
 'dependabot-config',
 'dockerfile-deploy',
 'email-resend',
 'eslint-prettier',
 'git-hooks',
 'github-actions-ci',
 'next-app',
 'nodejs-typescript-base',
 'observability-sentry',
 'playwright-e2e',
 'postgres-local-docker',
 'postgres-neon',
 'prisma',
 'redis-local-docker',
 'tailwind-v4',
 'vercel-deploy',
 'vitest',
 ]);
 expect(all).toHaveLength(22);
 });

 it('all 21 Day-5 integrations load + topo-sort without errors', async () => {
 const all = await loadIntegrationsByName(REGISTRY, [
 'ai-sdk',
 'analytics-plausible',
 'analytics-umami',
 'auth-better-auth',
 'auth-clerk',
 'dependabot-config',
 'dockerfile-deploy',
 'email-resend',
 'eslint-prettier',
 'git-hooks',
 'github-actions-ci',
 'next-app',
 'nodejs-typescript-base',
 'observability-sentry',
 'postgres-local-docker',
 'postgres-neon',
 'prisma',
 'redis-local-docker',
 'tailwind-v4',
 'vercel-deploy',
 'vitest',
 ]);
 expect(all).toHaveLength(21);
 });
});
