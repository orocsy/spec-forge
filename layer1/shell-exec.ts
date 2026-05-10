/**
 * Shell execution with audit + timeout.
 *
 * Wraps `node:child_process.spawn` to capture stdout/stderr/exit, enforce
 * a hard timeout, and emit a journal entry per call. Layer 2/3 must use
 * this — never call spawn/exec directly.
 */

import { spawn, type SpawnOptions } from 'node:child_process';

import { ShellFailedError } from './errors.js';
import { record } from './journal.js';
import type { BootstrapJournalEntry } from './schemas.js';

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Hard timeout in ms. Default 60s. Set to 0 to disable. */
  timeoutMs?: number;
  /** Write stdin then close. */
  stdin?: string;
  /** Throw on non-zero exit. Default true. */
  throwOnFailure?: boolean;
}

export interface ShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ShellContext {
  journalPath: string;
  run_id: string;
  phase: BootstrapJournalEntry['phase'];
}

/**
 * Run a command with audit. Caller passes the command as `command` + `args`
 * (avoids shell-injection because we don't go through a shell). Use
 * `shellLine` for cases where you genuinely need a shell pipe.
 */
export async function exec(
  ctx: ShellContext,
  command: string,
  args: string[] = [],
  options: ShellOptions = {}
): Promise<ShellResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const throwOnFailure = options.throwOnFailure ?? true;
  const start = Date.now();

  const spawnOptions: SpawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: { ...process.env, ...options.env } as NodeJS.ProcessEnv } : {}),
  };

  const result = await new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(command, args, spawnOptions);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, timeoutMs)
        : null;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const exitCode = timedOut ? null : code;
      resolve({
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\n[killed: timeout ${timeoutMs}ms, signal=${signal}]` : stderr,
        durationMs: Date.now() - start,
      });
    });

    if (options.stdin) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });

  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'shell.exec',
    outcome: result.exitCode === 0 ? 'ok' : 'error',
    data: {
      command,
      args,
      cwd: options.cwd,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      stdout_bytes: Buffer.byteLength(result.stdout),
      stderr_bytes: Buffer.byteLength(result.stderr),
    },
  });

  if (result.exitCode !== 0 && throwOnFailure) {
    const fullCmd = `${command}${args.length ? ' ' + args.join(' ') : ''}`;
    throw new ShellFailedError(fullCmd, result.exitCode, result.stderr);
  }

  return result;
}

/**
 * Run a shell line that needs pipes/redirects. Less safe than `exec`
 * (passes through `/bin/sh -c`) — use only when necessary, never with
 * unvalidated input interpolation.
 */
export async function shellLine(
  ctx: ShellContext,
  line: string,
  options: ShellOptions = {}
): Promise<ShellResult> {
  return exec(ctx, '/bin/sh', ['-c', line], options);
}
