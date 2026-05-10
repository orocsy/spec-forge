# Layer 1 — Primitives

Foundation for the bootstrap subsystem. Pure functions where possible, side-effect functions wrapped with audit-trail emission.

**Target size: ~500 LOC across this directory.**

## Modules in this layer

| File | Purpose | Side-effects? |
|------|---------|---------------|
| `schemas.ts` | Zod schemas for every contract (ProjectSpec, IntegrationManifest, BootstrapJournalEntry, etc.) | No — pure |
| `file-ops.ts` | Idempotent file write/patch with content-hash check; fence-marker section parser | Yes (fs) — audited |
| `git-ops.ts` | Branch, commit, push, fetch, status, diff helpers — wrapping `simple-git` or shelling out to `git` | Yes (git) — audited |
| `shell-exec.ts` | Run a command, capture stdout/stderr/exit; timeout; environment override; audit | Yes (proc) — audited |
| `journal.ts` | Append-only `.claude/.bootstrap-journal.jsonl`; provides `record(event)`, `replay(filter)`, `inverse(event)` | Yes (fs) — audited |
| `manifest-validator.ts` | Validate `IntegrationManifest` against the registry schema; resolve dependencies | No — pure |
| `secret-stores.ts` | Adapters for `.env.local`, GitHub Actions secrets, Vercel env vars (read/write) | Yes (cli/api) — audited |
| `dev-defaults.ts` | The registry of safe-to-commit sandbox keys per integration (Stripe `pk_test_…`, Clerk dev instance, etc.) | No — pure data |
| `errors.ts` | Typed error classes: `BootstrapError`, `IntegrationConflictError`, `SecretMissingError`, etc. | No |
| `types.ts` | Re-export of inferred types from schemas.ts for ergonomic imports | No |

## Audit contract (every side-effecting function follows it)

```ts
import { record } from './journal';

export async function writeFile(path: string, content: string): Promise<void> {
  const before = await tryRead(path);
  await fs.writeFile(path, content);
  await record({
    event: 'file.write',
    path,
    sha_before: before ? sha256(before) : null,
    sha_after: sha256(content),
    inverse: before ? { event: 'file.restore', path, content: before } : { event: 'file.delete', path },
  });
}
```

The `inverse` field is what makes rollback trivial — replay the journal in reverse, dispatch each `inverse`.

## File-ops fence-marker contract (used by §22 of the design doc)

```ts
// Read a fenced region from a file.
// "=== @clerk/middleware ==="
// ...content...
// "=== /@clerk/middleware ==="
parseFencedSection(content: string, fenceId: string): {
  before: string;
  inside: string;
  after: string;
} | null;

// Replace a fenced section idempotently.
// If fence not present → append at top of file.
// If fence present and inside content matches → no-op (idempotent).
// If fence present and inside differs from expected hash → return ConflictResult for 3-way merge.
upsertFencedSection(filePath: string, fenceId: string, content: string, expectedHash: string | null): UpsertResult;
```

## Schemas — the contracts every layer relies on

```ts
// schemas.ts (sketch)

export const EntitySpec = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
  fields: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'datetime', 'json', 'enum', 'relation']),
    optional: z.boolean().default(false),
    unique: z.boolean().default(false),
    references: z.string().optional(), // for 'relation' type
    enum_values: z.array(z.string()).optional(),
  })),
});

export const FeatureSpec = z.object({
  id: z.string().regex(/^F[0-9]+$/),
  title: z.string().min(5),
  description: z.string().optional(),
  user_role: z.string().optional(),
  done_when: z.array(z.string()).min(1), // "done when" criteria — used by verify-traceability
  needs: z.array(z.string()).default([]), // domain tags ('scheduling', 'auth-customer', etc.)
});

export const IntegrationRef = z.object({
  name: z.string(),                // e.g. 'stripe'
  category: z.enum(['auth','payments','database','email','storage','observability','realtime','ai','search','flags','jobs','ratelimit']),
  version: z.string().optional(),  // pin
  config: z.record(z.unknown()).optional(),
});

export const ProjectSpec = z.object({
  meta: z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    description: z.string().min(10),
    version: z.string().default('0.0.1'),
    spec_schema_version: z.literal(1),
  }),
  data_model: z.array(EntitySpec).default([]),
  api_routes: z.array(z.object({
    method: z.enum(['GET','POST','PUT','PATCH','DELETE']),
    path: z.string(),
    auth: z.enum(['public','user','admin']).default('user'),
  })).default([]),
  features: z.array(FeatureSpec).default([]),
  integrations: z.array(IntegrationRef).default([]),
  deploy: z.object({
    target: z.enum(['vercel','cloudflare-pages','netlify','render','fly','self-host-docker']).default('vercel'),
    region: z.string().optional(),
  }).default({}),
  observability: z.object({
    error_tracking: z.boolean().default(true),
    analytics: z.boolean().default(true),
    ai_tracing: z.boolean().default(false),
  }).default({}),
  non_functional: z.object({
    multi_tenant: z.boolean().default(false),
    i18n: z.array(z.string()).default([]),
    scale_target: z.string().optional(),
    data_sensitivity: z.string().optional(),
  }).default({}),
});

export type ProjectSpec = z.infer<typeof ProjectSpec>;

export const IntegrationManifest = z.object({
  name: z.string(),
  category: IntegrationRef.shape.category,
  version: z.string(),
  depends_on_integrations: z.array(z.string()).default([]),
  depends_on_packages: z.record(z.string()).default({}),
  env_vars: z.record(z.object({
    scope: z.enum(['server','client']),
    required: z.boolean().default(true),
    dev_strategy: z.enum(['use_test_default','prompt_user','generate_random','skip_with_todo','sidecar_capture']),
    dev_default: z.string().optional(),
    prod_strategy: z.enum(['prompt_user','generate_random','create_endpoint_then_prompt','skip_with_todo']),
    prod_doc_link: z.string().url().optional(),
  })).default({}),
  files_owned: z.array(z.string()).default([]),       // exclusive ownership
  files_appended: z.array(z.object({                  // shared with marker fence
    path: z.string(),
    fence_id: z.string(),
  })).default([]),
  compose_services: z.array(z.string()).default([]),
  mcp_servers: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  post_install_steps: z.array(z.string()).default([]),
  verification: z.object({
    dev: z.string().optional(),                       // shell snippet that returns 0 on success
    ci: z.string().optional(),                        // path-glob that must exist after install
  }).default({}),
});

export type IntegrationManifest = z.infer<typeof IntegrationManifest>;

export const BootstrapJournalEntry = z.object({
  ts: z.string().datetime(),
  phase: z.enum(['B0','B1','B2','B3','B4','B5','B6']),
  event: z.string(),
  outcome: z.enum(['ok','warn','error']).default('ok'),
  data: z.record(z.unknown()).optional(),
  inverse: z.unknown().optional(),
});
```

## Test contract

Every Layer 1 module ships with a `*.test.ts` next to it.

- `file-ops.test.ts` — round-trip a file, idempotent re-write returns no-op, fence-marker upsert preserves content outside markers, conflict on hash mismatch
- `journal.test.ts` — record N events, replay forward, replay reverse, filter by phase
- `manifest-validator.test.ts` — valid manifest passes; missing required field fails; circular deps detected
- `shell-exec.test.ts` — captures stdout/stderr/exit; timeout fires; env override applied; audit emitted
- `secret-stores.test.ts` — `.env.local` round-trips; GitHub adapter mocked via `gh` CLI; Vercel adapter mocked via `vercel` CLI

**No layer above Layer 1 is allowed direct fs/git/proc/network access.** Always go through Layer 1. This is the discipline that makes idempotency, rollback, and audit work.

---

*Status: directory + skeleton README + schema sketches. No `.ts` source yet — that's Day 1 of the build plan in §26/§30.*
