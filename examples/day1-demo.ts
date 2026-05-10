#!/usr/bin/env tsx
/**
 * Day 1 capability demo.
 *
 * What this proves: Layer 1 primitives compose into a real workflow.
 * What this exposes: there is NO orchestrator yet — every step is hand-
 * coded here. Day 2 (integration-applier + manifest-loader + a thin
 * orchestrator) replaces this hand-coding with manifest-driven flow.
 *
 * Run:
 *   pnpm tsx examples/day1-demo.ts /tmp/demo-project
 *
 * Result: a tiny but real Node + TS project, git-initialised, with one
 * commit, plus a `.bootstrap-journal.jsonl` showing every audited step.
 */

import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

import {
  ProjectSpec,
  fileOps,
  gitOps,
  journal,
  shell,
  type BootstrapPhase,
} from '../layer1/index.js';

// ─── 1. Define a tiny spec (in real life, B0 would parse a PRD) ────

const spec = ProjectSpec.parse({
  meta: {
    name: 'hello-bootstrap',
    description: 'demo project produced by Layer 1 primitives only',
    spec_schema_version: 1,
  },
  features: [
    {
      id: 'F1',
      title: 'echo hello on startup',
      done_when: ['running `node dist/index.js` prints "hello, bootstrap"'],
    },
  ],
});

// ─── 2. Resolve target dir + reset ─────────────────────────────────

const targetDir = resolve(process.argv[2] ?? '/tmp/hello-bootstrap-demo');
const journalPath = `${targetDir}.journal.jsonl`;
const run_id = `demo-${Date.now()}`;

if (existsSync(targetDir)) {
  await rm(targetDir, { recursive: true, force: true });
}
if (existsSync(journalPath)) {
  await rm(journalPath, { force: true });
}
await mkdir(targetDir, { recursive: true });

console.log(`▶ Target:   ${targetDir}`);
console.log(`▶ Journal:  ${journalPath}`);
console.log(`▶ Spec:     ${spec.meta.name} — ${spec.meta.description}`);
console.log('');

// ─── 3. Drive the phases by hand (this is what Day 2 will automate) ─

const ctx = { journalPath, run_id, phase: 'B0' as BootstrapPhase };

await journal.record(journalPath, {
  ...ctx,
  event: 'spec.parsed',
  data: { name: spec.meta.name, features: spec.features.length },
});

// B2: scaffold files (in Day 2, integration manifests own this)
const fileCtx = { ...ctx, phase: 'B2' as BootstrapPhase };
await fileOps.writeFile(
  fileCtx,
  join(targetDir, 'package.json'),
  JSON.stringify(
    {
      name: spec.meta.name,
      version: spec.meta.version,
      description: spec.meta.description,
      type: 'module',
      scripts: { build: 'tsc', start: 'node dist/index.js' },
      devDependencies: { typescript: '^5.7.0', '@types/node': '^22.0.0' },
    },
    null,
    2
  ) + '\n'
);

await fileOps.writeFile(
  fileCtx,
  join(targetDir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        outDir: 'dist',
        strict: true,
        esModuleInterop: true,
      },
      include: ['src/**/*'],
    },
    null,
    2
  ) + '\n'
);

await fileOps.writeFile(
  fileCtx,
  join(targetDir, 'src/index.ts'),
  `export function greet(): string { return 'hello, bootstrap'; }\nconsole.log(greet());\n`
);

await fileOps.writeFile(fileCtx, join(targetDir, '.gitignore'), 'node_modules\ndist\n');

// Demonstrate the fence-marker primitive: README has a managed section
// that future integrations will append/update without overwriting human
// content.
await fileOps.writeFile(
  fileCtx,
  join(targetDir, 'README.md'),
  `# ${spec.meta.name}\n\n${spec.meta.description}\n\n_Hand-written content lives outside the fence._\n`
);
await fileOps.upsertFenced(
  fileCtx,
  join(targetDir, 'README.md'),
  '@bootstrap/feature-list',
  spec.features.map((f) => `- **${f.id}** ${f.title}`).join('\n'),
  { sectionTitle: '## Features (managed by bootstrap)' }
);

// B5: git init + first commit
const gitCtx = { ...ctx, phase: 'B5' as BootstrapPhase, cwd: targetDir };
await shell.exec(gitCtx, 'git', ['init', '-q', '-b', 'main'], { cwd: targetDir });
await shell.exec(gitCtx, 'git', ['config', 'user.name', 'bootstrap-demo'], { cwd: targetDir });
await shell.exec(gitCtx, 'git', ['config', 'user.email', 'demo@bootstrap.local'], {
  cwd: targetDir,
});

await gitOps.stage(gitCtx, ['package.json', 'tsconfig.json', 'src/index.ts', '.gitignore', 'README.md']);
const sha = await gitOps.commit(gitCtx, 'chore: bootstrap day-1 demo (Layer 1 primitives only)', {
  authorName: 'bootstrap-demo',
  authorEmail: 'demo@bootstrap.local',
});
console.log(`✓ Initial commit: ${sha.slice(0, 8)}`);

// ─── 4. Print the journal to show every audited step ───────────────

const entries = await journal.readAll(journalPath);
console.log('');
console.log(`▶ Journal: ${entries.length} entries`);
for (const e of entries) {
  const inv = e.inverse ? ` ⤺ ${e.inverse.event}` : '';
  console.log(`  ${e.phase} ${e.event.padEnd(18)} ${e.outcome}${inv}`);
}

console.log('');
console.log('─'.repeat(60));
console.log('What Day 1 demonstrates:');
console.log('  ✓ Spec validation (Zod)');
console.log('  ✓ Idempotent file writes with hash tracking');
console.log('  ✓ Fence-marker upsert (managed section in README)');
console.log('  ✓ Audited shell + git, full inverse-action chain');
console.log('  ✓ Replayable journal');
console.log('');
console.log('What Day 1 LACKS:');
console.log('  ✗ Manifest-driven integration application');
console.log('  ✗ Orchestrator that turns a spec into the right step sequence');
console.log('  ✗ Template registry (any new project re-implements this script)');
console.log('  ✗ CLI wrapper for an LLM agent to call');
console.log('  → Day 2 fills all four.');
