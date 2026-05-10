/**
 * CLI integration tests — spawn `tsx cli.ts` as a real subprocess so
 * we exercise the same code path an LLM agent would call.
 *
 * Each test runs in <2s on a warm tsx cache.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const CLI = join(ROOT, 'cli.ts');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('node', ['--import', 'tsx', CLI, ...args], {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectP(new Error(`cli timeout after ${options.timeoutMs ?? 30_000}ms`));
    }, options.timeoutMs ?? 30_000);
    child.on('error', rejectP);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveP({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function parseResultLine(stderr: string): unknown {
  const match = /@@RESULT@@ (.+)$/m.exec(stderr);
  return match ? JSON.parse(match[1]!) : null;
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(tmpdir(), 'cli-test-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const goodSpec = {
  meta: {
    name: 'cli-test-app',
    description: 'spec for cli tests',
    spec_schema_version: 1,
  },
};

describe('cli: usage', () => {
  it('exits 1 with usage when no command provided', async () => {
    const r = await runCli([]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('Usage:');
  });

  it('exits 1 with usage on unknown command', async () => {
    const r = await runCli(['nonexistent']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('Usage:');
  });
});

describe('cli: validate', () => {
  it('exits 0 on a valid spec', async () => {
    const specPath = join(tmp, 'spec.json');
    await fs.writeFile(specPath, JSON.stringify(goodSpec));
    const r = await runCli(['validate', specPath]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Spec valid');
    expect(r.stdout).toContain('cli-test-app');
    const result = parseResultLine(r.stderr) as { ok: boolean; name?: string };
    expect(result.ok).toBe(true);
    expect(result.name).toBe('cli-test-app');
  });

  it('exits 2 on an invalid spec', async () => {
    const specPath = join(tmp, 'bad.json');
    await fs.writeFile(specPath, JSON.stringify({ meta: { name: 'NOT_KEBAB' } }));
    const r = await runCli(['validate', specPath]);
    expect(r.exitCode).toBe(2);
    const result = parseResultLine(r.stderr) as { ok: boolean; code?: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SPEC_INVALID');
  });

  it('exits 2 on a missing spec', async () => {
    const r = await runCli(['validate', join(tmp, 'nope.json')]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('SPEC_INVALID');
  });
});

describe('cli: list-integrations', () => {
  it('lists the bundled integrations', async () => {
    const r = await runCli(['list-integrations']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('nodejs-typescript-base');
    expect(r.stdout).toContain('eslint-prettier');
    const result = parseResultLine(r.stderr) as {
      ok: boolean;
      integrations: Array<{ name: string }>;
    };
    expect(result.ok).toBe(true);
    const names = result.integrations.map((i) => i.name);
    expect(names).toContain('nodejs-typescript-base');
    expect(names).toContain('eslint-prettier');
  });
});

describe('cli: scaffold + inspect', () => {
  it('scaffolds a real project from a minimal spec', async () => {
    const specPath = join(tmp, 'spec.json');
    const outDir = join(tmp, 'out');
    await fs.writeFile(
      specPath,
      JSON.stringify({
        meta: {
          name: 'scaffold-test',
          description: 'cli scaffold test',
          spec_schema_version: 1,
        },
        integrations: [
          { name: 'nodejs-typescript-base', category: 'observability', version: '1.0.0' },
        ],
      })
    );
    const r = await runCli(['scaffold', specPath, outDir], { timeoutMs: 60_000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Bootstrap complete');

    // Real files exist
    expect((await fs.readFile(join(outDir, 'package.json'), 'utf8')).length).toBeGreaterThan(0);
    expect((await fs.readFile(join(outDir, 'src/index.ts'), 'utf8')).length).toBeGreaterThan(0);

    // package.json substituted variables
    const pkg = JSON.parse(await fs.readFile(join(outDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('scaffold-test');

    // Git repo + commit
    const gitLog = await fs.readFile(join(outDir, '.git/HEAD'), 'utf8');
    expect(gitLog).toContain('main');

    // Inspect can read the journal
    const inspectR = await runCli(['inspect', outDir]);
    expect(inspectR.exitCode).toBe(0);
    expect(inspectR.stdout).toContain('spec.parsed');
    expect(inspectR.stdout).toContain('integrations.applied');
    expect(inspectR.stdout).toContain('bootstrap.complete');
  });

  it('refuses to scaffold into a non-empty dir', async () => {
    const specPath = join(tmp, 'spec.json');
    const outDir = join(tmp, 'out');
    await fs.writeFile(specPath, JSON.stringify(goodSpec));
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(join(outDir, 'sentinel'), 'x');
    const r = await runCli(['scaffold', specPath, outDir], { timeoutMs: 30_000 });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('PRECONDITION_FAILED');
  });
});

describe('cli: rollback', () => {
  it('reports the planned action count in dry-run', async () => {
    // Produce a journal first via scaffold
    const specPath = join(tmp, 'spec.json');
    const outDir = join(tmp, 'out');
    await fs.writeFile(
      specPath,
      JSON.stringify({
        meta: {
          name: 'rollback-test',
          description: 'cli rollback test',
          spec_schema_version: 1,
        },
        integrations: [
          { name: 'nodejs-typescript-base', category: 'observability', version: '1.0.0' },
        ],
      })
    );
    const scaffoldR = await runCli(['scaffold', specPath, outDir], { timeoutMs: 60_000 });
    expect(scaffoldR.exitCode).toBe(0);

    const journalPath = `${outDir}.journal.jsonl`;
    const r = await runCli(['rollback', journalPath, '--dry-run']);
    expect(r.exitCode).toBe(0);
    const result = parseResultLine(r.stderr) as { planned: number; executed: number };
    expect(result.planned).toBeGreaterThan(0);
    expect(result.executed).toBe(0);
  });
});
