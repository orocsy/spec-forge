/**
 * Layer 1 barrel — single import surface for higher layers.
 *
 *   import { writeFile, exec, record, ProjectSpec } from '@dev-pipeline/bootstrap/layer1';
 */

export * from './errors.js';
export * from './schemas.js';
export * as journal from './journal.js';
export * as fileOps from './file-ops.js';
export * as shell from './shell-exec.js';
export * as gitOps from './git-ops.js';
export * as manifests from './manifest-validator.js';
