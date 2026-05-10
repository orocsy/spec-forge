/**
 * Layer 3 — orchestrator.
 *
 * Drives B0 → B6 for a single bootstrap run:
 *   B0  parse spec
 *   B1  resolve integrations (load + validate set + topo-sort)
 *   B2  apply integrations (patch files + fence appends + env files)
 *   B3  initialise git + first commit
 *   B4  install deps  (deferred — caller's responsibility for now)
 *   B5  verify        (deferred)
 *   B6  finalise + summary
 *
 * On failure at any step, the journal contains the inverse-action chain
 * and `rollback()` walks it backward.
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import {
  BootstrapError,
  fileOps,
  gitOps,
  journal,
  shell,
  type BootstrapPhase,
} from '../layer1/index.js';
import {
  applyAll,
  loadAndOrder,
  loadSpec,
  type ApplyResult,
  type LoadedIntegration,
  type LoadedSpec,
} from '../layer2/index.js';

export interface OrchestrateOptions {
  /** Path to spec.json. */
  specPath: string;
  /** Path to integration registry root. */
  registryDir: string;
  /** Where the new project is created. */
  outDir: string;
  /** Optional run id (defaults to timestamp). */
  runId?: string;
  /** Override journal path (default: `<outDir>.journal.jsonl`). */
  journalPath?: string;
  /** Skip git init if true. */
  skipGit?: boolean;
  /** If true, run the project's install step (B4) after commit. */
  install?: boolean;
  /** Override package manager. Defaults to detected pnpm/npm/yarn. */
  packageManager?: 'pnpm' | 'npm' | 'yarn';
  /** Install timeout in ms. Default 10 minutes. */
  installTimeoutMs?: number;
  /** Extra vars merged into placeholder substitution. */
  extraVars?: Record<string, string>;
}

export interface InstallResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
}

export interface OrchestrateResult {
  outDir: string;
  journalPath: string;
  runId: string;
  spec: LoadedSpec;
  integrations: LoadedIntegration[];
  applyResults: ApplyResult[];
  commitSha: string | null;
  installResult: InstallResult | null;
  durationMs: number;
}

async function detectPackageManager(): Promise<'pnpm' | 'npm' | 'yarn'> {
  // Prefer pnpm because most modern Node projects assume it; fall back
  // to npm which ships with Node itself.
  for (const pm of ['pnpm', 'npm', 'yarn'] as const) {
    try {
      const r = await shell.exec(
        { journalPath: '/dev/null', run_id: 'pm-detect', phase: 'B4' as BootstrapPhase },
        pm,
        ['--version'],
        { timeoutMs: 5_000, throwOnFailure: false }
      );
      if (r.exitCode === 0) return pm;
    } catch {
      /* continue */
    }
  }
  return 'npm';
}

export async function orchestrate(options: OrchestrateOptions): Promise<OrchestrateResult> {
  const start = Date.now();
  const outDir = resolve(options.outDir);
  const journalPath = options.journalPath ?? `${outDir}.journal.jsonl`;
  const runId = options.runId ?? `run-${Date.now()}`;

  const baseCtx = (phase: BootstrapPhase) => ({ journalPath, run_id: runId, phase });

  // Refuse to write into an existing non-empty directory.
  if (await pathExists(outDir)) {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      throw new BootstrapError(
        'PRECONDITION_FAILED',
        `outDir ${outDir} is not empty — refusing to overwrite`
      );
    }
  } else {
    await fs.mkdir(outDir, { recursive: true });
  }

  // ── B0: parse spec ───────────────────────────────────────────────
  const loadedSpec = await loadSpec(options.specPath);
  await journal.record(journalPath, {
    ...baseCtx('B0'),
    event: 'spec.parsed',
    data: {
      name: loadedSpec.spec.meta.name,
      version: loadedSpec.spec.meta.version,
      features: loadedSpec.spec.features.length,
      integrations: loadedSpec.spec.integrations.length,
    },
  });

  // ── B1: resolve integrations ─────────────────────────────────────
  // If no integrations specified, default to nodejs-typescript-base alone.
  const integrationNames =
    loadedSpec.spec.integrations.length > 0
      ? loadedSpec.spec.integrations.map((i) => i.name)
      : ['nodejs-typescript-base'];
  const integrations = await loadAndOrder(options.registryDir, integrationNames);
  await journal.record(journalPath, {
    ...baseCtx('B1'),
    event: 'integrations.resolved',
    data: { order: integrations.map((i) => i.manifest.name) },
  });

  // ── B2: apply integrations ───────────────────────────────────────
  const vars = {
    'project.name': loadedSpec.spec.meta.name,
    'project.description': loadedSpec.spec.meta.description,
    'project.version': loadedSpec.spec.meta.version,
    ...(options.extraVars ?? {}),
  };
  const applyResults = await applyAll(
    {
      journalPath,
      run_id: runId,
      phase: 'B2',
      targetDir: outDir,
      vars,
    },
    integrations
  );
  await journal.record(journalPath, {
    ...baseCtx('B2'),
    event: 'integrations.applied',
    data: {
      count: applyResults.length,
      total_files: applyResults.reduce((acc, r) => acc + r.filesWritten.length, 0),
      total_fences: applyResults.reduce((acc, r) => acc + r.fencesUpserted.length, 0),
    },
  });

  // ── B3: write README + git init + first commit ───────────────────
  const fileCtx = baseCtx('B3');
  await fileOps.writeFile(
    fileCtx,
    `${outDir}/README.md`,
    `# ${loadedSpec.spec.meta.name}\n\n${loadedSpec.spec.meta.description}\n\n` +
      `## Integrations\n\n${integrations.map((i) => `- **${i.manifest.name}** (${i.manifest.category}) v${i.manifest.version}`).join('\n')}\n\n` +
      `## Features\n\n${loadedSpec.spec.features.map((f) => `- **${f.id}** — ${f.title}`).join('\n') || '_(none yet)_'}\n\n` +
      `_Generated by dev-pipeline bootstrap. Re-running with the same spec is idempotent._\n`
  );

  let commitSha: string | null = null;
  if (!options.skipGit) {
    const gitCtx = { journalPath, run_id: runId, phase: 'B3' as BootstrapPhase, cwd: outDir };
    await shell.exec(gitCtx, 'git', ['init', '-q', '-b', 'main'], { cwd: outDir });
    await shell.exec(gitCtx, 'git', ['config', 'user.name', 'dev-pipeline-bootstrap'], {
      cwd: outDir,
    });
    await shell.exec(
      gitCtx,
      'git',
      ['config', 'user.email', 'bootstrap@dev-pipeline.local'],
      { cwd: outDir }
    );
    // Stage everything in the new tree
    await shell.exec(gitCtx, 'git', ['add', '-A'], { cwd: outDir });
    commitSha = await gitOps.commit(
      gitCtx,
      `chore: bootstrap ${loadedSpec.spec.meta.name} (${integrations.length} integration(s))`,
      {
        authorName: 'dev-pipeline-bootstrap',
        authorEmail: 'bootstrap@dev-pipeline.local',
      }
    );
  }

  // ── B4: optional install ─────────────────────────────────────────
  let installResult: InstallResult | null = null;
  if (options.install && (await pathExists(`${outDir}/package.json`))) {
    const pm = options.packageManager ?? (await detectPackageManager());
    const installArgs = pm === 'yarn' ? [] : ['install'];
    const installStart = Date.now();
    const r = await shell.exec(
      { journalPath, run_id: runId, phase: 'B4' as BootstrapPhase },
      pm,
      installArgs,
      {
        cwd: outDir,
        timeoutMs: options.installTimeoutMs ?? 10 * 60_000,
        throwOnFailure: false,
      }
    );
    installResult = {
      command: `${pm} ${installArgs.join(' ')}`.trim(),
      ok: r.exitCode === 0,
      exitCode: r.exitCode,
      durationMs: Date.now() - installStart,
    };
    await journal.record(journalPath, {
      ...baseCtx('B4'),
      event: installResult.ok ? 'install.ok' : 'install.fail',
      outcome: installResult.ok ? 'ok' : 'error',
      data: {
        package_manager: pm,
        exit_code: r.exitCode,
        duration_ms: installResult.durationMs,
      },
    });

    // Codegen (e.g. `prisma generate`) runs automatically via npm's
    // `postinstall` lifecycle script — pnpm/npm/yarn all honor it.
    // Integrations declare such commands in their `merge/package.json`
    // under `scripts.postinstall`; no custom executor needed here.
    // (LuxeBook precedent: apps/api uses this exact pattern.)
  }

  // ── B6: finalise ─────────────────────────────────────────────────
  await journal.record(journalPath, {
    ...baseCtx('B6'),
    event: 'bootstrap.complete',
    data: {
      out_dir: outDir,
      commit_sha: commitSha,
      installed: installResult?.ok ?? null,
      duration_ms: Date.now() - start,
    },
  });

  return {
    outDir,
    journalPath,
    runId,
    spec: loadedSpec,
    integrations,
    applyResults,
    commitSha,
    installResult,
    durationMs: Date.now() - start,
  };
}

/**
 * Roll back a partially-completed bootstrap by walking the journal
 * backward and dispatching each entry's inverse action.
 *
 * The destructive steps live in the dispatcher passed by the caller —
 * Layer 3 doesn't decide policy (e.g. should rollback `rm -rf` the
 * whole outDir? that's caller's call).
 */
export async function rollback(
  journalPath: string,
  options: { dryRun?: boolean } = {}
): Promise<{ planned: number; executed: number }> {
  const plan = await journal.inversePlan(journalPath);
  if (options.dryRun) {
    return { planned: plan.length, executed: 0 };
  }

  let executed = 0;
  for (const action of plan) {
    switch (action.event) {
      case 'file.delete':
        try {
          await fs.unlink(action.path);
          executed++;
        } catch {
          /* ignore — already gone */
        }
        break;
      case 'file.restore':
        try {
          await fs.writeFile(action.path, action.content, 'utf8');
          executed++;
        } catch {
          /* ignore */
        }
        break;
      case 'shell.exec':
        await shell.shellLine(
          { journalPath, run_id: 'rollback', phase: 'B6' as BootstrapPhase },
          action.command,
          { throwOnFailure: false, timeoutMs: 30_000 }
        );
        executed++;
        break;
      case 'git.reset':
        // The caller usually passes a cwd via env; here we just no-op.
        // Layer 3 callers should generally rollback by deleting outDir
        // in the new-project case.
        break;
      case 'secret.unset':
        // Future: dispatch to secret store. For v1, no-op.
        break;
      case 'manifest.uninstall':
        // Reserved for re-applying a manifest with --uninstall flag.
        break;
    }
  }
  return { planned: plan.length, executed };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
