/**
 * Spec loader — read a project spec from disk and validate it.
 *
 * v1 supports JSON only. YAML support deferred — when needed, add the
 * `yaml` npm dep rather than hand-rolling (per "libraries first" rule).
 */

import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

import { BootstrapError, ProjectSpec, type ProjectSpec as ProjectSpecT } from '../layer1/index.js';

export interface LoadedSpec {
  spec: ProjectSpecT;
  source: string;
  format: 'json';
}

export async function loadSpec(specPath: string): Promise<LoadedSpec> {
  const ext = extname(specPath).toLowerCase();
  if (ext !== '.json') {
    throw new BootstrapError(
      'SPEC_INVALID',
      `spec extension "${ext}" is not supported in v1 (use .json; YAML support is planned)`,
      { details: { path: specPath } }
    );
  }

  let raw: string;
  try {
    raw = await fs.readFile(specPath, 'utf8');
  } catch (cause) {
    throw new BootstrapError('SPEC_INVALID', `cannot read spec at ${specPath}`, {
      details: { path: specPath },
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new BootstrapError('SPEC_INVALID', `spec at ${specPath} is not valid JSON`, {
      details: { path: specPath },
      cause,
    });
  }

  const result = ProjectSpec.safeParse(parsed);
  if (!result.success) {
    throw new BootstrapError('SPEC_INVALID', `spec at ${specPath} fails schema validation`, {
      details: { path: specPath, issues: result.error.issues },
    });
  }

  return { spec: result.data, source: specPath, format: 'json' };
}

/** Convenience for callers that already have a parsed object. */
export function validateSpec(input: unknown): ProjectSpecT {
  const result = ProjectSpec.safeParse(input);
  if (!result.success) {
    throw new BootstrapError('SPEC_INVALID', 'spec fails schema validation', {
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}
