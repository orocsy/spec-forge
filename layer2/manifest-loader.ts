/**
 * Manifest loader — read manifest dirs from a registry and topo-sort.
 *
 * Registry layout (one dir per integration):
 *
 *   integrations/
 *     <integration-name>/
 *       manifest.json           # IntegrationManifest
 *       patch/                  # files copied verbatim into target
 *         <relative-path>...
 *       env.template            # optional: lines appended to .env.example
 *       dev-defaults.env        # optional: lines appended to .env.local in dev
 *       fence/<fence_id>.txt    # optional: body for `files_appended`
 */

import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  BootstrapError,
  IntegrationManifest,
  manifests as manifestValidator,
  type IntegrationManifest as IntegrationManifestT,
} from '../layer1/index.js';

export interface LoadedIntegration {
  manifest: IntegrationManifestT;
  /** Absolute path to the integration's directory in the registry. */
  dir: string;
  /** Relative paths under `patch/` that exist on disk. */
  patchFiles: string[];
  /** Map of fence_id → body text loaded from `fence/<fence_id>.txt`. */
  fenceBodies: Record<string, string>;
  /** Map of `merge/<patch_file>` → parsed JSON to deep-merge into target. */
  jsonMergeBodies: Record<string, unknown>;
  /** Raw text of `env.template`, if present. */
  envTemplate: string | null;
  /** Raw text of `dev-defaults.env`, if present. */
  devDefaults: string | null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        out.push(relative(root, abs).split(sep).join('/'));
      }
    }
  }
  if (await exists(root)) await walk(root);
  return out.sort();
}

/** Load + validate ONE integration directory. */
export async function loadIntegration(integrationDir: string): Promise<LoadedIntegration> {
  const manifestPath = join(integrationDir, 'manifest.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (cause) {
    throw new BootstrapError(
      'MANIFEST_INVALID',
      `cannot read manifest at ${manifestPath}`,
      { details: { dir: integrationDir }, cause }
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new BootstrapError('MANIFEST_INVALID', `manifest at ${manifestPath} is not valid JSON`, {
      details: { dir: integrationDir },
      cause,
    });
  }
  const validation = IntegrationManifest.safeParse(parsed);
  if (!validation.success) {
    throw new BootstrapError(
      'MANIFEST_INVALID',
      `manifest at ${manifestPath} fails schema`,
      { details: { dir: integrationDir, issues: validation.error.issues } }
    );
  }
  const manifest = validation.data;

  // Cross-check: every files_owned path should exist under patch/
  const patchRoot = join(integrationDir, 'patch');
  const patchFiles = await listFilesRecursive(patchRoot);
  const patchSet = new Set(patchFiles);
  for (const owned of manifest.files_owned) {
    if (!patchSet.has(owned)) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `manifest "${manifest.name}" claims files_owned[${JSON.stringify(owned)}] but no such file exists under patch/`,
        { details: { dir: integrationDir, expected: owned, got: patchFiles } }
      );
    }
  }

  // Load fence bodies
  const fenceBodies: Record<string, string> = {};
  for (const ref of manifest.files_appended) {
    // fence_id "@scope/name" → file "fence/scope__name.txt"
    const safe = ref.fence_id.replace(/^@/, '').replace(/[\/]/g, '__');
    const fencePath = join(integrationDir, 'fence', `${safe}.txt`);
    const body = await readIfExists(fencePath);
    if (body === null) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `manifest "${manifest.name}" references fence "${ref.fence_id}" but ${fencePath} is missing`,
        { details: { dir: integrationDir, fence_id: ref.fence_id, expected: fencePath } }
      );
    }
    fenceBodies[ref.fence_id] = body;
  }

  // Load json_merge patch bodies
  const jsonMergeBodies: Record<string, unknown> = {};
  for (const ref of manifest.json_merges) {
    const patchPath = join(integrationDir, 'merge', ref.patch_file);
    const raw = await readIfExists(patchPath);
    if (raw === null) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `manifest "${manifest.name}" references json_merge patch "${ref.patch_file}" but ${patchPath} is missing`,
        { details: { dir: integrationDir, patch_file: ref.patch_file, expected: patchPath } }
      );
    }
    try {
      jsonMergeBodies[ref.patch_file] = JSON.parse(raw);
    } catch (cause) {
      throw new BootstrapError(
        'MANIFEST_INVALID',
        `json_merge patch "${ref.patch_file}" in manifest "${manifest.name}" is not valid JSON`,
        { details: { dir: integrationDir, patch_file: ref.patch_file }, cause }
      );
    }
  }

  return {
    manifest,
    dir: integrationDir,
    patchFiles,
    fenceBodies,
    jsonMergeBodies,
    envTemplate: await readIfExists(join(integrationDir, 'env.template')),
    devDefaults: await readIfExists(join(integrationDir, 'dev-defaults.env')),
  };
}

/** Load every integration named in a registry. */
export async function loadIntegrationsByName(
  registryDir: string,
  names: string[]
): Promise<LoadedIntegration[]> {
  const out: LoadedIntegration[] = [];
  for (const name of names) {
    const dir = join(registryDir, name);
    if (!(await exists(dir))) {
      throw new BootstrapError(
        'INTEGRATION_NOT_FOUND',
        `integration "${name}" not found at ${dir}`,
        { details: { registry: registryDir, name } }
      );
    }
    out.push(await loadIntegration(dir));
  }
  return out;
}

/**
 * Topological sort by `depends_on_integrations`. Throws on cycles
 * (which manifest-validator should have already caught — defensive).
 */
export function topoSort(loaded: LoadedIntegration[]): LoadedIntegration[] {
  const byName = new Map<string, LoadedIntegration>();
  for (const l of loaded) byName.set(l.manifest.name, l);

  const result: LoadedIntegration[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string, stack: string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new BootstrapError(
        'INTEGRATION_CONFLICT',
        `dependency cycle: ${[...stack, name].join(' → ')}`
      );
    }
    visiting.add(name);
    const node = byName.get(name);
    if (!node) {
      throw new BootstrapError(
        'INTEGRATION_NOT_FOUND',
        `dependency "${name}" not in loaded set`,
        { details: { name } }
      );
    }
    for (const dep of node.manifest.depends_on_integrations) {
      visit(dep, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    result.push(node);
  }

  for (const l of loaded) visit(l.manifest.name, []);
  return result;
}

/**
 * Convenience: load + validate as a set + topo-sort. The single entry
 * point Layer 3 uses.
 */
export async function loadAndOrder(
  registryDir: string,
  names: string[]
): Promise<LoadedIntegration[]> {
  const loaded = await loadIntegrationsByName(registryDir, names);
  manifestValidator.assertSetValid(loaded.map((l) => l.manifest));
  return topoSort(loaded);
}
