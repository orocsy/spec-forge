/**
 * Integration manifest validator.
 *
 * Two responsibilities:
 *   1. Validate a single manifest's shape (Zod) + cross-field invariants.
 *   2. Validate a *set* of manifests for cross-integration consistency
 *      (file ownership conflicts, dependency cycles, missing deps).
 */

import { BootstrapError, IntegrationConflictError } from './errors.js';
import { IntegrationManifest } from './schemas.js';
import type { IntegrationManifest as IntegrationManifestType } from './schemas.js';

export interface ValidationIssue {
  manifest: string;
  message: string;
  path?: (string | number)[];
}

export interface ManifestValidationResult {
  ok: boolean;
  manifest: IntegrationManifestType | null;
  issues: ValidationIssue[];
}

export function validateOne(raw: unknown): ManifestValidationResult {
  const parsed = IntegrationManifest.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      manifest: null,
      issues: parsed.error.issues.map((i) => ({
        manifest: typeof raw === 'object' && raw !== null && 'name' in raw ? String((raw as { name: unknown }).name) : '<unknown>',
        message: i.message,
        path: [...i.path] as (string | number)[],
      })),
    };
  }

  const m = parsed.data;
  const issues: ValidationIssue[] = [];

  // Cross-field invariant: every fence in `files_appended` must reference a
  // file that's NOT in `files_owned` of the same integration (you either
  // own a file exclusively, or share it via a fence — not both).
  const owned = new Set(m.files_owned);
  for (const fence of m.files_appended) {
    if (owned.has(fence.path)) {
      issues.push({
        manifest: m.name,
        message: `path "${fence.path}" is in both files_owned and files_appended — pick one`,
        path: ['files_appended'],
      });
    }
  }

  // Every env var with strategy `use_test_default` must have a `dev_default`.
  // (Already enforced by the schema's `.refine()`, but doubled here for
  // friendlier error messages in batch validation.)
  for (const [name, spec] of Object.entries(m.env_vars)) {
    if (spec.dev_strategy === 'use_test_default' && !spec.dev_default) {
      issues.push({
        manifest: m.name,
        message: `env var "${name}" uses use_test_default but has no dev_default value`,
        path: ['env_vars', name, 'dev_default'],
      });
    }
  }

  return { ok: issues.length === 0, manifest: m, issues };
}

export interface SetValidationResult {
  ok: boolean;
  manifests: IntegrationManifestType[];
  issues: ValidationIssue[];
}

/**
 * Validate a chosen set of integrations together.
 *
 * Checks:
 *   - Every manifest is individually valid (delegates to validateOne)
 *   - No two manifests claim the same path in `files_owned`
 *   - Every `depends_on_integrations` entry resolves to a manifest in the set
 *   - No dependency cycles
 */
export function validateSet(raws: unknown[]): SetValidationResult {
  const issues: ValidationIssue[] = [];
  const manifests: IntegrationManifestType[] = [];

  for (const raw of raws) {
    const r = validateOne(raw);
    issues.push(...r.issues);
    if (r.manifest) manifests.push(r.manifest);
  }
  if (issues.length > 0) {
    return { ok: false, manifests, issues };
  }

  // Cross-manifest: file ownership conflicts
  const ownerMap = new Map<string, string[]>();
  for (const m of manifests) {
    for (const path of m.files_owned) {
      const owners = ownerMap.get(path) ?? [];
      owners.push(m.name);
      ownerMap.set(path, owners);
    }
  }
  for (const [path, owners] of ownerMap) {
    if (owners.length > 1) {
      issues.push({
        manifest: owners.join(','),
        message: `file ownership conflict on "${path}" — claimed by [${owners.join(', ')}]`,
        path: ['files_owned'],
      });
    }
  }

  // Dependency resolution
  const nameSet = new Set(manifests.map((m) => m.name));
  for (const m of manifests) {
    for (const dep of m.depends_on_integrations) {
      if (!nameSet.has(dep)) {
        issues.push({
          manifest: m.name,
          message: `depends_on_integrations references "${dep}" which is not in the chosen integration set`,
          path: ['depends_on_integrations'],
        });
      }
    }
  }

  // Cycle detection (depth-first)
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byName = new Map(manifests.map((m) => [m.name, m] as const));

  function visit(name: string, stack: string[]): void {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const cycle = [...stack.slice(stack.indexOf(name)), name];
      issues.push({
        manifest: name,
        message: `dependency cycle detected: ${cycle.join(' → ')}`,
        path: ['depends_on_integrations'],
      });
      return;
    }
    visiting.add(name);
    const m = byName.get(name);
    if (m) {
      for (const dep of m.depends_on_integrations) {
        visit(dep, [...stack, name]);
      }
    }
    visiting.delete(name);
    visited.add(name);
  }
  for (const m of manifests) visit(m.name, []);

  return { ok: issues.length === 0, manifests, issues };
}

/** Throw the first conflict as a typed error — convenient for orchestrator early-out. */
export function assertSetValid(raws: unknown[]): IntegrationManifestType[] {
  const r = validateSet(raws);
  if (r.ok) return r.manifests;

  const conflict = r.issues.find((i) => i.message.startsWith('file ownership conflict'));
  if (conflict) {
    const match = conflict.message.match(/"(.+?)"\s.*?\[(.+?)\]/);
    if (match) {
      throw new IntegrationConflictError(match[1]!, match[2]!.split(', '));
    }
  }
  throw new BootstrapError(
    'MANIFEST_INVALID',
    `${r.issues.length} manifest issue(s):\n` +
      r.issues
        .map((i) => ` - [${i.manifest}] ${i.message}${i.path ? ` (path: ${i.path.join('.')})` : ''}`)
        .join('\n'),
    { details: { issues: r.issues } }
  );
}
