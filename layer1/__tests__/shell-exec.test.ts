import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exec, shellLine, type ShellContext } from '../shell-exec.js';
import { readAll } from '../journal.js';

let tmpDir: string;
let ctx: ShellContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'bootstrap-shell-'));
  ctx = { journalPath: join(tmpDir, 'journal.jsonl'), run_id: 'r1', phase: 'B4' };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('exec', () => {
  it('captures stdout + exit 0', async () => {
    const r = await exec(ctx, 'echo', ['hello']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe('hello');
    expect(r.stderr).toBe('');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stderr', async () => {
    const r = await exec(ctx, '/bin/sh', ['-c', '>&2 echo oops'], { throwOnFailure: false });
    expect(r.stderr.trim()).toBe('oops');
  });

  it('throws ShellFailedError on non-zero exit (default)', async () => {
    await expect(exec(ctx, '/bin/sh', ['-c', 'exit 7'])).rejects.toMatchObject({
      name: 'ShellFailedError',
      code: 'SHELL_FAILED',
    });
  });

  it('returns non-zero exit when throwOnFailure=false', async () => {
    const r = await exec(ctx, '/bin/sh', ['-c', 'exit 9'], { throwOnFailure: false });
    expect(r.exitCode).toBe(9);
  });

  it('respects timeoutMs and returns exitCode null', async () => {
    const r = await exec(ctx, '/bin/sh', ['-c', 'sleep 5'], {
      timeoutMs: 100,
      throwOnFailure: false,
    });
    expect(r.exitCode).toBeNull();
    expect(r.stderr).toMatch(/timeout/i);
  });

  it('passes env overrides', async () => {
    const r = await exec(ctx, '/bin/sh', ['-c', 'echo "$BOOTSTRAP_TEST_VAR"'], {
      env: { BOOTSTRAP_TEST_VAR: 'set-by-test' },
    });
    expect(r.stdout.trim()).toBe('set-by-test');
  });

  it('emits a journal entry with command + exit_code', async () => {
    await exec(ctx, 'echo', ['hi']);
    const entries = await readAll(ctx.journalPath);
    expect(entries[0]).toMatchObject({
      event: 'shell.exec',
      outcome: 'ok',
      data: { command: 'echo', args: ['hi'], exit_code: 0 },
    });
  });

  it('emits outcome=error when exit code != 0', async () => {
    await exec(ctx, '/bin/sh', ['-c', 'exit 3'], { throwOnFailure: false });
    const entries = await readAll(ctx.journalPath);
    expect(entries[0]?.outcome).toBe('error');
  });
});

describe('shellLine', () => {
  it('runs a piped expression', async () => {
    const r = await shellLine(ctx, "echo a b c | wc -w | tr -d ' '");
    expect(r.stdout.trim()).toBe('3');
  });
});
