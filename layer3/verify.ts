/**
 * Verify a scaffolded project — run each applied integration's
 * `verification.dev` shell command from the project root and report
 * pass/fail per integration.
 *
 * Read by `cli.ts verify <project-dir>` and surfaced in the journal.
 */

import { join, resolve } from 'node:path';

import { BootstrapError, journal, shell, type BootstrapPhase } from '../layer1/index.js';
import { loadIntegration } from '../layer2/index.js';

export interface VerifyOptions {
  projectDir: string;
  registryDir: string;
  /** Override journal path (default: `<projectDir>.journal.jsonl`). */
  journalPath?: string;
  runId?: string;
  /** Per-command timeout, ms. Default 60s. */
  timeoutMs?: number;
}

export interface IntegrationVerifyResult {
  integration: string;
  command: string | null;
  status: 'pass' | 'fail' | 'skipped' | 'no_command';
  exitCode: number | null;
  durationMs: number;
  stderr?: string;
}

export interface VerifyResult {
  projectDir: string;
  results: IntegrationVerifyResult[];
  overallStatus: 'pass' | 'fail' | 'partial';
  totalDurationMs: number;
}

/**
 * Read the journal, discover which integrations were applied, then
 * execute each one's `verification.dev` in the project root.
 */
export async function verifyProject(options: VerifyOptions): Promise<VerifyResult> {
  const start = Date.now();
  const projectDir = resolve(options.projectDir);
  const journalPath = options.journalPath ?? `${projectDir}.journal.jsonl`;
  const runId = options.runId ?? `verify-${Date.now()}`;

  const entries = await journal.readAll(journalPath);
  if (entries.length === 0) {
    throw new BootstrapError(
      'PRECONDITION_FAILED',
      `no journal at ${journalPath} — was this project scaffolded by dev-pipeline?`
    );
  }
  // Find the integrations.resolved entry to learn the order
  const resolved = entries.find((e) => e.event === 'integrations.resolved');
  if (!resolved || !resolved.data) {
    throw new BootstrapError(
      'PRECONDITION_FAILED',
      `journal at ${journalPath} has no integrations.resolved entry`
    );
  }
  const order = (resolved.data['order'] as string[]) ?? [];

  const results: IntegrationVerifyResult[] = [];
  const ctx = { journalPath, run_id: runId, phase: 'B5' as BootstrapPhase };

  for (const name of order) {
    const integDir = join(options.registryDir, name);
    let command: string | null = null;
    try {
      const loaded = await loadIntegration(integDir);
      command = loaded.manifest.verification.dev ?? null;
    } catch (err) {
      // Integration was renamed/deleted from the registry. Mark as skipped
      // so we still produce a row.
      await journal.record(journalPath, {
        ...ctx,
        event: 'verify.skipped',
        outcome: 'warn',
        data: { integration: name, reason: 'integration not found in registry' },
      });
      results.push({
        integration: name,
        command: null,
        status: 'skipped',
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }

    if (!command) {
      results.push({
        integration: name,
        command: null,
        status: 'no_command',
        exitCode: null,
        durationMs: 0,
      });
      await journal.record(journalPath, {
        ...ctx,
        event: 'verify.no_command',
        outcome: 'ok',
        data: { integration: name },
      });
      continue;
    }

    const stepStart = Date.now();
    const r = await shell.shellLine(ctx, command, {
      cwd: projectDir,
      timeoutMs: options.timeoutMs ?? 60_000,
      throwOnFailure: false,
    });
    const stepDur = Date.now() - stepStart;
    const passed = r.exitCode === 0;
    results.push({
      integration: name,
      command,
      status: passed ? 'pass' : 'fail',
      exitCode: r.exitCode,
      durationMs: stepDur,
      ...(passed ? {} : { stderr: r.stderr.slice(0, 1500) }),
    });
    await journal.record(journalPath, {
      ...ctx,
      event: passed ? 'verify.pass' : 'verify.fail',
      outcome: passed ? 'ok' : 'error',
      data: { integration: name, command, exit_code: r.exitCode, duration_ms: stepDur },
    });
  }

  const passes = results.filter((r) => r.status === 'pass').length;
  const fails = results.filter((r) => r.status === 'fail').length;
  const overallStatus: VerifyResult['overallStatus'] =
    fails === 0 ? 'pass' : passes === 0 ? 'fail' : 'partial';

  return {
    projectDir,
    results,
    overallStatus,
    totalDurationMs: Date.now() - start,
  };
}

