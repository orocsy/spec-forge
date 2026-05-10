/**
 * Integration applier — apply ONE LoadedIntegration to a target tree.
 *
 * Steps (per integration):
 *   1. Copy every patch file into target. Files in `files_owned` are
 *      written via `writeFile` (full overwrite, hash-tracked). Files
 *      NOT in files_owned but present under patch/ are still written
 *      (mainly for first-of-its-kind files like `package.json` that
 *      another integration will append to via fence-marker).
 *   2. For each `files_appended[i]`, upsert the fence body into the
 *      target file. Caller's responsibility that the target file
 *      already exists at this point — typically a base integration
 *      writes package.json, then a later integration fence-appends
 *      scripts into it.
 *   3. Append env.template lines to `<target>/.env.example` and
 *      dev-defaults to `<target>/.env.local` (each guarded by fence
 *      so re-applying is idempotent).
 *
 * Variable substitution: any `{{var.name}}` token in patch files is
 * replaced with values from `vars`. We use a tiny placeholder syntax
 * instead of a full templating engine — keeps the surface obvious.
 */

import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  BootstrapError,
  fileOps,
  type BootstrapPhase,
} from '../layer1/index.js';
import type { LoadedIntegration } from './manifest-loader.js';

export interface ApplyContext {
  journalPath: string;
  run_id: string;
  /** Defaults to 'B2' — the manifest-application phase. */
  phase?: BootstrapPhase;
  /** Target project directory. Created if missing. */
  targetDir: string;
  /** Variables for `{{...}}` substitution in patch files. */
  vars?: Record<string, string>;
}

// Negative lookbehind for `$` excludes GitHub Actions' `${{ ... }}` syntax,
// which is a literal expression in workflow YAML — not our placeholder.
const PLACEHOLDER_RE = /(?<!\$)\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;

function substitute(content: string, vars: Record<string, string>): string {
  return content.replace(PLACEHOLDER_RE, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key]!;
    }
    // Unresolved placeholder is a hard error — better to fail than ship
    // a literal `{{var.name}}` into the user's code.
    throw new BootstrapError(
      'PRECONDITION_FAILED',
      `unresolved placeholder ${match} (no var named "${key}" provided)`
    );
  });
}

export interface ApplyResult {
  integration: string;
  filesWritten: string[];
  fencesUpserted: string[];
  jsonMerges: string[];
  envLinesAppended: number;
  devDefaultsAppended: number;
}

/**
 * Deep-merge `patch` into `base`. Object keys recurse; arrays are
 * concatenated and de-duplicated by JSON.stringify; everything else
 * is replaced. Idempotent.
 *
 * Special sentinel: a patch value of `"$delete"` removes that key from
 * the base. This lets a downstream integration drop a base key it
 * doesn't want (e.g. Next.js dropping `rootDir` from a base tsconfig).
 *
 * Example:
 *   base   = { compilerOptions: { rootDir: 'src', strict: true } }
 *   patch  = { compilerOptions: { rootDir: '$delete', noEmit: true } }
 *   result = { compilerOptions: { strict: true, noEmit: true } }
 */
const DELETE_SENTINEL = '$delete';

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(patch)) {
    const seen = new Set<string>();
    const result: unknown[] = [];
    for (const item of [...base, ...patch]) {
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }
  if (
    base !== null &&
    typeof base === 'object' &&
    !Array.isArray(base) &&
    patch !== null &&
    typeof patch === 'object' &&
    !Array.isArray(patch)
  ) {
    const baseObj = base as Record<string, unknown>;
    const patchObj = patch as Record<string, unknown>;
    const out: Record<string, unknown> = { ...baseObj };
    for (const k of Object.keys(patchObj)) {
      const pv = patchObj[k];
      if (pv === DELETE_SENTINEL) {
        delete out[k];
        continue;
      }
      out[k] = k in baseObj ? deepMerge(baseObj[k], pv) : pv;
    }
    return out;
  }
  // Primitive or type mismatch — patch wins (unless it's the delete sentinel,
  // which only makes sense at the object-key level).
  return patch;
}

export async function applyIntegration(
  ctx: ApplyContext,
  integration: LoadedIntegration
): Promise<ApplyResult> {
  const targetDir = resolve(ctx.targetDir);
  await fs.mkdir(targetDir, { recursive: true });

  const fileCtx = {
    journalPath: ctx.journalPath,
    run_id: ctx.run_id,
    phase: ctx.phase ?? ('B2' as BootstrapPhase),
  };
  const vars = ctx.vars ?? {};
  const filesWritten: string[] = [];
  const fencesUpserted: string[] = [];
  const jsonMerges: string[] = [];

  // 1. Copy patch files
  for (const rel of integration.patchFiles) {
    const sourcePath = join(integration.dir, 'patch', rel);
    const destPath = join(targetDir, rel);
    let content: string;
    try {
      content = await fs.readFile(sourcePath, 'utf8');
    } catch (cause) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `cannot read patch file ${sourcePath}`,
        { details: { integration: integration.manifest.name, file: rel }, cause }
      );
    }
    const rendered = substitute(content, vars);
    await fs.mkdir(dirname(destPath), { recursive: true });
    await fileOps.writeFile(fileCtx, destPath, rendered);
    filesWritten.push(rel);
  }

  // 2. Fence appends
  for (const ref of integration.manifest.files_appended) {
    const targetPath = join(targetDir, ref.path);
    const body = integration.fenceBodies[ref.fence_id];
    if (body === undefined) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `fence body missing for "${ref.fence_id}" — should have been caught at load time`,
        { details: { integration: integration.manifest.name, fence: ref.fence_id } }
      );
    }
    // Target must already exist — ensure a base integration created it.
    try {
      await fs.access(targetPath);
    } catch {
      throw new BootstrapError(
        'PRECONDITION_FAILED',
        `integration "${integration.manifest.name}" wants to fence-append into ${ref.path} but the file does not exist (a base integration must create it first)`,
        { details: { integration: integration.manifest.name, fence: ref.fence_id, path: ref.path } }
      );
    }
    const rendered = substitute(body, vars);
    await fileOps.upsertFenced(fileCtx, targetPath, ref.fence_id, rendered);
    fencesUpserted.push(`${ref.path}#${ref.fence_id}`);
  }

  // 2.5 JSON merges — preserves JSON validity (unlike fence-append)
  for (const merge of integration.manifest.json_merges) {
    const targetPath = join(targetDir, merge.file);
    let existing: Record<string, unknown> = {};
    if (await pathExists(targetPath)) {
      const raw = await fs.readFile(targetPath, 'utf8');
      try {
        existing = JSON.parse(raw) as Record<string, unknown>;
      } catch (cause) {
        throw new BootstrapError(
          'PRECONDITION_FAILED',
          `cannot json_merge into ${merge.file}: existing file is not valid JSON`,
          { details: { integration: integration.manifest.name, path: merge.file }, cause }
        );
      }
    }
    const patchRaw = integration.jsonMergeBodies[merge.patch_file];
    if (patchRaw === undefined) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `json_merge body missing for "${merge.patch_file}" — should have been caught at load time`,
        { details: { integration: integration.manifest.name, patch_file: merge.patch_file } }
      );
    }
    // Render placeholders in the JSON: stringify, substitute, parse back
    const patchRendered = JSON.parse(substitute(JSON.stringify(patchRaw), vars));
    const merged = deepMerge(existing, patchRendered);
    await fileOps.writeFile(fileCtx, targetPath, JSON.stringify(merged, null, 2) + '\n');
    jsonMerges.push(`${merge.file} ← ${merge.patch_file}`);
  }

  // 3. env.template → .env.example (fence per integration)
  let envLinesAppended = 0;
  if (integration.envTemplate && integration.envTemplate.trim().length > 0) {
    const envExamplePath = join(targetDir, '.env.example');
    if (!(await pathExists(envExamplePath))) {
      await fileOps.writeFile(fileCtx, envExamplePath, '');
    }
    const fenceId = `@${integration.manifest.name}/env`;
    const rendered = substitute(integration.envTemplate, vars);
    await fileOps.upsertFenced(fileCtx, envExamplePath, fenceId, rendered.trimEnd(), {
      sectionTitle: `# ${integration.manifest.name} (${integration.manifest.category})`,
    });
    envLinesAppended = rendered.split('\n').filter((l) => l.trim().length > 0).length;
  }

  // 4. dev-defaults.env → .env.local (fence per integration)
  let devDefaultsAppended = 0;
  if (integration.devDefaults && integration.devDefaults.trim().length > 0) {
    const envLocalPath = join(targetDir, '.env.local');
    if (!(await pathExists(envLocalPath))) {
      await fileOps.writeFile(fileCtx, envLocalPath, '');
    }
    const fenceId = `@${integration.manifest.name}/dev-defaults`;
    const rendered = substitute(integration.devDefaults, vars);
    await fileOps.upsertFenced(fileCtx, envLocalPath, fenceId, rendered.trimEnd(), {
      sectionTitle: `# ${integration.manifest.name} dev defaults`,
    });
    devDefaultsAppended = rendered.split('\n').filter((l) => l.trim().length > 0).length;
  }

  return {
    integration: integration.manifest.name,
    filesWritten,
    fencesUpserted,
    jsonMerges,
    envLinesAppended,
    devDefaultsAppended,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Apply many integrations in order; returns per-integration results. */
export async function applyAll(
  ctx: ApplyContext,
  integrations: LoadedIntegration[]
): Promise<ApplyResult[]> {
  const out: ApplyResult[] = [];
  for (const i of integrations) {
    out.push(await applyIntegration(ctx, i));
  }
  return out;
}
