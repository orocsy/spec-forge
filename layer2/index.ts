/**
 * Layer 2 barrel.
 *
 *   import { loadSpec, loadAndOrder, applyAll } from '@dev-pipeline/bootstrap/layer2';
 */

export { loadSpec, validateSpec, type LoadedSpec } from './spec-loader.js';
export {
  loadIntegration,
  loadIntegrationsByName,
  loadAndOrder,
  topoSort,
  type LoadedIntegration,
} from './manifest-loader.js';
export {
  applyIntegration,
  applyAll,
  type ApplyContext,
  type ApplyResult,
} from './integration-applier.js';
