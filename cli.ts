#!/usr/bin/env tsx
/**
 * dev-pipeline bootstrap CLI.
 *
 * Designed for an LLM agent (Claude Code) to drive — every command is
 * idempotent and prints structured JSON to stderr-channel for parsing,
 * with human-readable text on stdout.
 *
 * Commands:
 *   scaffold <spec.json> <out-dir>     B0→B6 driver
 *   validate <spec.json>               schema-validate a spec
 *   inspect  <out-dir>                 print the journal of a bootstrap run
 *   list-integrations [registry-dir]   print available integrations
 */

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { isBootstrapError, journal as journalLib } from './layer1/index.js';
import { loadIntegration, loadSpec } from './layer2/index.js';
import { orchestrate, rollback } from './layer3/orchestrator.js';
import { verifyProject } from './layer3/verify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_REGISTRY = resolve(__dirname, 'integrations');

function usage(): never {
  console.log(`dev-pipeline bootstrap

Usage:
  cli.ts scaffold <spec.json> <out-dir> [--registry <dir>] [--install] [--verify]
  cli.ts validate <spec.json>
  cli.ts inspect  <out-dir>
  cli.ts list-integrations [registry-dir]
  cli.ts verify   <project-dir> [--registry <dir>]
  cli.ts rollback <journal.jsonl> [--dry-run]
`);
  process.exit(1);
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function cmdScaffold(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [specPath, outDir] = positional;
  if (!specPath || !outDir) usage();
  const registryDir =
    typeof flags['registry'] === 'string' ? flags['registry'] : DEFAULT_REGISTRY;

  const result = await orchestrate({
    specPath: resolve(specPath),
    outDir: resolve(outDir),
    registryDir: resolve(registryDir),
    install: flags['install'] === true,
  });

  console.log(`✓ Bootstrap complete in ${result.durationMs}ms`);
  console.log(`  out:        ${result.outDir}`);
  console.log(`  journal:    ${result.journalPath}`);
  console.log(`  spec:       ${result.spec.spec.meta.name} v${result.spec.spec.meta.version}`);
  console.log(`  integrations: ${result.integrations.map((i) => i.manifest.name).join(', ')}`);
  if (result.commitSha) {
    console.log(`  commit:     ${result.commitSha.slice(0, 8)}`);
  }
  if (result.installResult) {
    console.log(
      `  install:    ${result.installResult.ok ? '✓' : '✗'} ${result.installResult.command} (${result.installResult.durationMs}ms)`
    );
  }
  for (const r of result.applyResults) {
    console.log(
      `    [${r.integration}] ${r.filesWritten.length} files, ${r.jsonMerges.length} merges, ${r.fencesUpserted.length} fences, env+${r.envLinesAppended}/${r.devDefaultsAppended}`
    );
  }

  // Optional verify pass after scaffold
  let verifyOk: boolean | undefined;
  if (flags['verify'] === true) {
    if (!flags['install']) {
      console.log('⚠  --verify requires --install (deps must be present); skipping verify');
    } else {
      const v = await verifyProject({
        projectDir: result.outDir,
        registryDir: resolve(registryDir),
      });
      console.log(`  verify:     ${v.overallStatus} (${v.totalDurationMs}ms)`);
      for (const r of v.results) {
        const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '·';
        console.log(`    ${icon} ${r.integration}: ${r.status}${r.command ? ` — ${r.command}` : ''}`);
        if (r.stderr) {
          console.log(`        ${r.stderr.split('\n').slice(0, 2).join(' / ').slice(0, 200)}`);
        }
      }
      verifyOk = v.overallStatus === 'pass';
    }
  }

  // Machine-readable line for agents
  console.error(
    '@@RESULT@@ ' +
      JSON.stringify({
        ok: true,
        outDir: result.outDir,
        journalPath: result.journalPath,
        commitSha: result.commitSha,
        integrations: result.integrations.map((i) => i.manifest.name),
        installed: result.installResult?.ok ?? null,
        verified: verifyOk ?? null,
      })
  );
}

async function cmdVerify(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [projectDir] = positional;
  if (!projectDir) usage();
  const registryDir =
    typeof flags['registry'] === 'string' ? flags['registry'] : DEFAULT_REGISTRY;

  const v = await verifyProject({
    projectDir: resolve(projectDir),
    registryDir: resolve(registryDir),
  });
  console.log(`Verify: ${v.overallStatus} (${v.totalDurationMs}ms)`);
  for (const r of v.results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '·';
    console.log(`  ${icon} ${r.integration}: ${r.status}${r.command ? ` — ${r.command}` : ''}`);
    if (r.stderr) {
      console.log(`      ${r.stderr.split('\n').slice(0, 2).join(' / ').slice(0, 200)}`);
    }
  }
  console.error(
    '@@RESULT@@ ' +
      JSON.stringify({
        ok: v.overallStatus === 'pass',
        overallStatus: v.overallStatus,
        results: v.results.map((r) => ({
          integration: r.integration,
          status: r.status,
          exitCode: r.exitCode,
        })),
      })
  );
  if (v.overallStatus !== 'pass') process.exit(2);
}

async function cmdValidate(args: string[]): Promise<void> {
  const [specPath] = args;
  if (!specPath) usage();
  const result = await loadSpec(resolve(specPath));
  console.log(`✓ Spec valid: ${result.spec.meta.name} v${result.spec.meta.version}`);
  console.log(`  features:     ${result.spec.features.length}`);
  console.log(`  entities:     ${result.spec.data_model.length}`);
  console.log(`  integrations: ${result.spec.integrations.length}`);
  console.error('@@RESULT@@ ' + JSON.stringify({ ok: true, name: result.spec.meta.name }));
}

async function cmdInspect(args: string[]): Promise<void> {
  const [outDir] = args;
  if (!outDir) usage();
  const candidate = `${resolve(outDir)}.journal.jsonl`;
  const entries = await journalLib.readAll(candidate);
  console.log(`Journal: ${candidate}`);
  console.log(`Entries: ${entries.length}`);
  for (const e of entries) {
    const inv = e.inverse ? ` ⤺ ${e.inverse.event}` : '';
    const data = e.data ? ` ${JSON.stringify(e.data)}` : '';
    console.log(`  [${e.ts}] ${e.phase} ${e.event} ${e.outcome}${inv}${data}`);
  }
}

async function cmdListIntegrations(args: string[]): Promise<void> {
  const registryDir = args[0] ? resolve(args[0]) : DEFAULT_REGISTRY;
  const entries = await fs.readdir(registryDir, { withFileTypes: true });
  const found: Array<{ name: string; category: string; version: string; description?: string | undefined }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(registryDir, e.name);
    try {
      const i = await loadIntegration(dir);
      found.push({
        name: i.manifest.name,
        category: i.manifest.category,
        version: i.manifest.version,
        description: i.manifest.description,
      });
    } catch {
      // skip non-manifest dirs
    }
  }
  console.log(`Registry: ${registryDir}`);
  console.log(`Integrations available: ${found.length}`);
  for (const i of found) {
    console.log(`  ${i.name.padEnd(28)} ${i.category.padEnd(14)} v${i.version}`);
    if (i.description) console.log(`    ${i.description}`);
  }
  console.error('@@RESULT@@ ' + JSON.stringify({ ok: true, integrations: found }));
}

async function cmdRollback(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const [journalPath] = positional;
  if (!journalPath) usage();
  const result = await rollback(resolve(journalPath), { dryRun: !!flags['dry-run'] });
  console.log(
    `Rollback ${flags['dry-run'] ? 'dry-run' : 'executed'}: ${result.executed}/${result.planned} actions`
  );
  console.error(
    '@@RESULT@@ ' +
      JSON.stringify({ ok: true, planned: result.planned, executed: result.executed })
  );
}

const [, , command, ...rest] = process.argv;

try {
  switch (command) {
    case 'scaffold':
      await cmdScaffold(rest);
      break;
    case 'validate':
      await cmdValidate(rest);
      break;
    case 'inspect':
      await cmdInspect(rest);
      break;
    case 'list-integrations':
      await cmdListIntegrations(rest);
      break;
    case 'verify':
      await cmdVerify(rest);
      break;
    case 'rollback':
      await cmdRollback(rest);
      break;
    default:
      usage();
  }
} catch (err) {
  if (isBootstrapError(err)) {
    console.error(`✗ ${err.code}: ${err.message}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    console.error('@@RESULT@@ ' + JSON.stringify({ ok: false, code: err.code, message: err.message }));
  } else {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    console.error('@@RESULT@@ ' + JSON.stringify({ ok: false, message: String(err) }));
  }
  process.exit(2);
}
