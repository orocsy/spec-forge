/**
 * Git operations — thin audited wrapper over the local `git` CLI.
 *
 * Why no `simple-git` library? Two reasons:
 *   1. We already have `shell-exec` with audit + timeout; reusing it keeps
 *      every git invocation in the journal.
 *   2. `simple-git` carries an additional npm dep + its own subprocess
 *      handling — duplicating ours.
 */

import { exec, type ShellContext, type ShellResult } from './shell-exec.js';
import { record } from './journal.js';
import { BootstrapError } from './errors.js';

export interface GitContext extends ShellContext {
  cwd: string;
}

async function git(ctx: GitContext, args: string[], options: { quiet?: boolean } = {}): Promise<ShellResult> {
  return exec(
    ctx,
    'git',
    args,
    {
      cwd: ctx.cwd,
      timeoutMs: 30_000,
      throwOnFailure: !options.quiet,
    }
  );
}

export async function getCurrentBranch(ctx: GitContext): Promise<string> {
  const r = await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.stdout.trim();
}

export async function getHeadSha(ctx: GitContext): Promise<string> {
  const r = await git(ctx, ['rev-parse', 'HEAD']);
  return r.stdout.trim();
}

/**
 * Like getHeadSha but tolerates a fresh repo with no commits yet.
 * Returns `null` for an empty repo so the caller can treat the first
 * commit as a special case (no inverse `git.reset` target available).
 */
export async function getHeadShaIfAny(ctx: GitContext): Promise<string | null> {
  const r = await git(ctx, ['rev-parse', '--verify', '--quiet', 'HEAD'], { quiet: true });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim();
}

export async function isWorkingTreeClean(ctx: GitContext): Promise<boolean> {
  const r = await git(ctx, ['status', '--porcelain']);
  return r.stdout.trim().length === 0;
}

export async function fetchRemote(
  ctx: GitContext,
  remote = 'origin',
  options: { prune?: boolean } = {}
): Promise<void> {
  const args = ['fetch', remote];
  if (options.prune) args.push('--prune');
  await git(ctx, args);
}

export async function checkoutBranch(
  ctx: GitContext,
  branch: string,
  options: { create?: boolean; from?: string } = {}
): Promise<void> {
  const beforeBranch = await getCurrentBranch(ctx);
  const args = ['switch'];
  if (options.create) args.push('-c');
  args.push(branch);
  if (options.from) args.push(options.from);
  await git(ctx, args);
  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'git.checkout',
    data: { from: beforeBranch, to: branch, created: !!options.create },
    inverse: { event: 'shell.exec', command: `git -C ${ctx.cwd} switch ${beforeBranch}` },
  });
}

export interface CommitOptions {
  signoff?: boolean;
  allowEmpty?: boolean;
  authorName?: string;
  authorEmail?: string;
}

export async function stage(ctx: GitContext, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(ctx, ['add', '--', ...paths]);
}

export async function commit(
  ctx: GitContext,
  message: string,
  options: CommitOptions = {}
): Promise<string> {
  // Tolerate a fresh repo with no commits yet — the very first commit
  // has no before-SHA to roll back to. We still emit a journal entry
  // (the inverse becomes `shell.exec` of `git update-ref -d HEAD` so
  // rollback removes the commit + ref entirely).
  const beforeSha = await getHeadShaIfAny(ctx);
  const args = ['commit', '-m', message];
  if (options.signoff) args.push('--signoff');
  if (options.allowEmpty) args.push('--allow-empty');

  const env: Record<string, string | undefined> = {};
  if (options.authorName) env['GIT_AUTHOR_NAME'] = options.authorName;
  if (options.authorEmail) env['GIT_AUTHOR_EMAIL'] = options.authorEmail;

  await exec(ctx, 'git', args, {
    cwd: ctx.cwd,
    timeoutMs: 60_000,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  });
  const afterSha = await getHeadSha(ctx);

  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'git.commit',
    data: { sha: afterSha, before_sha: beforeSha, message },
    inverse: beforeSha
      ? { event: 'git.reset', to: beforeSha }
      : { event: 'shell.exec', command: `git -C ${ctx.cwd} update-ref -d HEAD` },
  });

  return afterSha;
}

export async function push(
  ctx: GitContext,
  remote = 'origin',
  branch?: string,
  options: { setUpstream?: boolean } = {}
): Promise<void> {
  const target = branch ?? (await getCurrentBranch(ctx));
  const args = ['push'];
  if (options.setUpstream) args.push('-u');
  args.push(remote, target);
  await git(ctx, args);
  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'git.push',
    data: { remote, branch: target, set_upstream: !!options.setUpstream },
  });
}

export async function clone(
  ctx: ShellContext,
  url: string,
  destination: string,
  options: { ref?: string; depth?: number } = {}
): Promise<void> {
  const args = ['clone'];
  if (options.depth) args.push('--depth', String(options.depth));
  if (options.ref) args.push('--branch', options.ref);
  args.push(url, destination);

  await exec(ctx, 'git', args, { timeoutMs: 120_000 });

  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'git.clone',
    data: { url, destination, ref: options.ref, depth: options.depth },
    inverse: { event: 'shell.exec', command: `rm -rf ${destination}` },
  });
}

export async function ensureCleanTreeOrThrow(ctx: GitContext): Promise<void> {
  const clean = await isWorkingTreeClean(ctx);
  if (!clean) {
    throw new BootstrapError(
      'PRECONDITION_FAILED',
      `working tree at ${ctx.cwd} is not clean — commit or stash before running bootstrap`
    );
  }
}

export async function isBehindMain(ctx: GitContext, mainBranch = 'main'): Promise<boolean> {
  const r = await git(
    ctx,
    ['rev-list', '--left-right', '--count', `HEAD...origin/${mainBranch}`],
    { quiet: true }
  );
  if (r.exitCode !== 0) return false;
  const [_ahead, behind] = r.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10));
  return (behind ?? 0) > 0;
}
