/**
 * Zod schemas — the contracts every layer above this depends on.
 *
 * Rules of the road:
 *   - Every cross-module input/output has a Zod schema here.
 *   - Inferred TypeScript types are exported alongside (`type Foo = z.infer<typeof Foo>`).
 *   - Schemas validate at the boundary; downstream code trusts the type.
 */

import { z } from 'zod';

// ─── Project Spec ──────────────────────────────────────────────────

export const FieldType = z.enum([
  'string',
  'number',
  'boolean',
  'datetime',
  'json',
  'enum',
  'relation',
]);

export const FieldSpec = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z][a-zA-Z0-9_]*$/, 'field names use camelCase / snake_case starting with lowercase'),
    type: FieldType,
    optional: z.boolean().default(false),
    unique: z.boolean().default(false),
    references: z.string().optional(),
    enum_values: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .refine((f) => f.type !== 'relation' || !!f.references, {
    message: "fields with type='relation' must include `references`",
    path: ['references'],
  })
  .refine((f) => f.type !== 'enum' || (f.enum_values && f.enum_values.length > 0), {
    message: "fields with type='enum' must include non-empty `enum_values`",
    path: ['enum_values'],
  });

export const EntitySpec = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Za-z0-9]*$/, 'entity names are PascalCase'),
  description: z.string().optional(),
  fields: z.array(FieldSpec).min(1),
});

export const FeatureSpec = z.object({
  id: z.string().regex(/^F[0-9]+$/, 'feature ids look like F1, F2, ...'),
  title: z.string().min(5).max(120),
  description: z.string().optional(),
  user_role: z.string().optional(),
  done_when: z
    .array(z.string().min(3))
    .min(1, 'every feature needs at least one acceptance criterion'),
  needs: z.array(z.string()).default([]),
});

export const RouteSpec = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().regex(/^\/[a-z0-9\-/_:[\]]+$/i),
  auth: z.enum(['public', 'user', 'admin']).default('user'),
});

export const IntegrationCategory = z.enum([
  'auth',
  'payments',
  'database',
  'email',
  'storage',
  'observability',
  'realtime',
  'ai',
  'search',
  'flags',
  'jobs',
  'ratelimit',
]);

export const IntegrationRef = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  category: IntegrationCategory,
  version: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

export const DeployTarget = z.enum([
  'vercel',
  'cloudflare-pages',
  'netlify',
  'render',
  'fly',
  'self-host-docker',
]);

export const DeploySpec = z
  .object({
    target: DeployTarget.default('vercel'),
    region: z.string().optional(),
  })
  .default({});

export const ObservabilitySpec = z
  .object({
    error_tracking: z.boolean().default(true),
    analytics: z.boolean().default(true),
    ai_tracing: z.boolean().default(false),
  })
  .default({});

export const NonFunctionalSpec = z
  .object({
    multi_tenant: z.boolean().default(false),
    i18n: z.array(z.string()).default([]),
    scale_target: z.string().optional(),
    data_sensitivity: z.string().optional(),
  })
  .default({});

export const ProjectSpec = z.object({
  meta: z.object({
    name: z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z][a-z0-9-]*$/, "project names are kebab-case (lowercase, digits, hyphen)"),
    description: z.string().min(10),
    version: z.string().default('0.0.1'),
    spec_schema_version: z.literal(1),
  }),
  data_model: z.array(EntitySpec).default([]),
  api_routes: z.array(RouteSpec).default([]),
  features: z.array(FeatureSpec).default([]),
  integrations: z.array(IntegrationRef).default([]),
  deploy: DeploySpec,
  observability: ObservabilitySpec,
  non_functional: NonFunctionalSpec,
});

export type ProjectSpec = z.infer<typeof ProjectSpec>;
export type FeatureSpec = z.infer<typeof FeatureSpec>;
export type EntitySpec = z.infer<typeof EntitySpec>;
export type IntegrationRef = z.infer<typeof IntegrationRef>;
export type DeployTarget = z.infer<typeof DeployTarget>;

// ─── Integration Manifest ──────────────────────────────────────────

export const SecretStrategy = z.enum([
  'use_test_default',
  'prompt_user',
  'generate_random',
  'skip_with_todo',
  'sidecar_capture',
  'create_endpoint_then_prompt',
]);

export const EnvVarSpec = z
  .object({
    scope: z.enum(['server', 'client']),
    required: z.boolean().default(true),
    description: z.string().optional(),
    dev_strategy: SecretStrategy,
    dev_default: z.string().optional(),
    prod_strategy: SecretStrategy,
    prod_doc_link: z.string().url().optional(),
  })
  .refine((s) => s.dev_strategy !== 'use_test_default' || !!s.dev_default, {
    message: "env vars using `use_test_default` must include a `dev_default`",
    path: ['dev_default'],
  });

export const IntegrationFileFenceRef = z.object({
  path: z.string(),
  fence_id: z
    .string()
    .regex(/^@[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/, 'fence ids look like @scope/name'),
});

export const JsonMergeRef = z.object({
  /** Target file in the project tree (must end in .json). */
  file: z.string().regex(/\.json$/, 'json_merges file must end in .json'),
  /** Path to the patch file inside the integration dir, relative to merge/. */
  patch_file: z.string().regex(/\.json$/, 'json_merges patch_file must end in .json'),
});

export const IntegrationVerification = z
  .object({
    dev: z.string().optional(),
    ci: z.string().optional(),
  })
  .default({});

export const IntegrationManifest = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  category: IntegrationCategory,
  version: z.string(),
  description: z.string().optional(),
  depends_on_integrations: z.array(z.string()).default([]),
  depends_on_packages: z.record(z.string()).default({}),
  env_vars: z.record(EnvVarSpec).default({}),
  files_owned: z.array(z.string()).default([]),
  files_appended: z.array(IntegrationFileFenceRef).default([]),
  json_merges: z.array(JsonMergeRef).default([]),
  compose_services: z.array(z.string()).default([]),
  mcp_servers: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  /**
   * Human-readable instructions shown to the user after scaffolding
   * (e.g. "create a Neon database at console.neon.tech and paste the URL").
   * Not executed.
   *
   * For codegen that MUST run after install (e.g. `prisma generate`),
   * do NOT add a custom executor. Use the npm-native `postinstall`
   * lifecycle script via `json_merges` into package.json — pnpm/npm/yarn
   * all run it automatically. (Learned from LuxeBook: `apps/api`
   * package.json has `"postinstall": "prisma generate"`.)
   */
  post_install_steps: z.array(z.string()).default([]),
  verification: IntegrationVerification,
});

export type IntegrationManifest = z.infer<typeof IntegrationManifest>;
export type EnvVarSpec = z.infer<typeof EnvVarSpec>;
export type SecretStrategy = z.infer<typeof SecretStrategy>;

// ─── Bootstrap Journal ─────────────────────────────────────────────

export const BootstrapPhase = z.enum(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']);

export const InverseAction = z.discriminatedUnion('event', [
  z.object({ event: z.literal('file.restore'), path: z.string(), content: z.string() }),
  z.object({ event: z.literal('file.delete'), path: z.string() }),
  z.object({
    event: z.literal('secret.unset'),
    name: z.string(),
    store: z.enum(['env_local', 'github', 'vercel']),
  }),
  z.object({ event: z.literal('git.reset'), to: z.string() }),
  z.object({ event: z.literal('shell.exec'), command: z.string() }),
  z.object({ event: z.literal('manifest.uninstall'), integration: z.string() }),
]);

export const BootstrapJournalEntry = z.object({
  ts: z.string().datetime({ offset: true }),
  run_id: z.string().min(1),
  phase: BootstrapPhase,
  event: z.string().min(1),
  outcome: z.enum(['ok', 'warn', 'error']).default('ok'),
  data: z.record(z.unknown()).optional(),
  inverse: InverseAction.optional(),
});

export type BootstrapJournalEntry = z.infer<typeof BootstrapJournalEntry>;
export type InverseAction = z.infer<typeof InverseAction>;
export type BootstrapPhase = z.infer<typeof BootstrapPhase>;
