import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  commit,
  ensureCleanTreeOrThrow,
  getCurrentBranch,
  getHeadSha,
  isWorkingTreeClean,
  stage,
  type GitContext,
} from '../git-ops.js';
import { exec } from '../shell-exec.js';
import { readAll } from '../journal.js';

let tmpDir: string;
let journalDir: string;
let ctx: GitContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'bootstrap-git-'));
  // Keep the journal OUTSIDE the git repo so it doesn't dirty the working
  // tree (every test asserts on clean-tree state at some point).
  journalDir = await fs.mkdtemp(join(tmpdir(), 'bootstrap-git-journal-'));
  ctx = {
    cwd: tmpDir,
    journalPath: join(journalDir, 'journal.jsonl'),
    run_id: 'r1',
    phase: 'B2',
  };
  // Init a real git repo so the wrapper has something to talk to.
  // exec from shell-exec wires the audit; we use throwOnFailure so any
  // missing-git environment fails the test loudly rather than silently.
  await exec(ctx, 'git', ['init', '-b', 'main'], { cwd: tmpDir });
  await exec(ctx, 'git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  await exec(ctx, 'git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  await exec(ctx, 'git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir });
  // Need an initial commit so HEAD exists.
  await fs.writeFile(join(tmpDir, 'seed.txt'), 'seed\n', 'utf8');
  await exec(ctx, 'git', ['add', 'seed.txt'], { cwd: tmpDir });
  await exec(ctx, 'git', ['commit', '-m', 'init'], { cwd: tmpDir });
  // Reset journal so per-test assertions don't see setup noise.
  await fs.writeFile(ctx.journalPath, '', 'utf8');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.rm(journalDir, { recursive: true, force: true });
});

describe('getCurrentBranch + getHeadSha', () => {
  it('reports the initial branch and HEAD sha', async () => {
    expect(await getCurrentBranch(ctx)).toBe('main');
    const sha = await getHeadSha(ctx);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('isWorkingTreeClean', () => {
  it('is true after the seed commit', async () => {
    expect(await isWorkingTreeClean(ctx)).toBe(true);
  });

  it('is false when an untracked file is present', async () => {
    await fs.writeFile(join(tmpDir, 'dirty.txt'), 'dirty\n', 'utf8');
    expect(await isWorkingTreeClean(ctx)).toBe(false);
  });
});

describe('ensureCleanTreeOrThrow', () => {
  it('passes silently when clean', async () => {
    await expect(ensureCleanTreeOrThrow(ctx)).resolves.toBeUndefined();
  });

  it('throws PRECONDITION_FAILED when dirty', async () => {
    await fs.writeFile(join(tmpDir, 'dirty.txt'), 'x\n', 'utf8');
    await expect(ensureCleanTreeOrThrow(ctx)).rejects.toMatchObject({
      name: 'BootstrapError',
      code: 'PRECONDITION_FAILED',
    });
  });
});

describe('stage + commit', () => {
  it('commits a new file and emits git.commit with reset inverse', async () => {
    const beforeSha = await getHeadSha(ctx);
    const path = join(tmpDir, 'a.txt');
    await fs.writeFile(path, 'hello\n', 'utf8');
    await stage(ctx, ['a.txt']);
    const newSha = await commit(ctx, 'add a');
    expect(newSha).not.toBe(beforeSha);
    const entries = await readAll(ctx.journalPath);
    const commitEntry = entries.find((e) => e.event === 'git.commit');
    expect(commitEntry).toBeTruthy();
    expect(commitEntry).toMatchObject({
      event: 'git.commit',
      data: { sha: newSha, before_sha: beforeSha, message: 'add a' },
      inverse: { event: 'git.reset', to: beforeSha },
    });
  });

  it('stage([]) is a no-op', async () => {
    await stage(ctx, []);
  });
});
