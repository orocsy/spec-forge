# Layer 2 — Domain modules

Pure (no I/O) business logic that the orchestrator (Layer 3) calls. Each module owns one concern, takes a typed input, returns a typed output. All side-effects delegate to Layer 1.

**Target size: ~1500 LOC across this directory.**

## Modules planned for this layer

| File | Purpose | Inputs | Outputs |
|------|---------|--------|---------|
| `prd-parser.ts` | Translate PRD text/image/markdown → `ProjectSpec` | PRD content (string), optional image refs | `ProjectSpec` (validated) + `_clarifications[]` |
| `stack-decider.ts` | Choose integrations + deploy target from spec | `ProjectSpec`, user preferences from `~/.claude/CLAUDE.md` | `StackDecision` (chosen integrations + alternatives + rationale) |
| `integration-applier.ts` | Apply one integration patch to a project tree (memory model) | `IntegrationManifest`, current project file tree | Set of file-write operations (idempotent), conflicts list |
| `secret-broker.ts` | Decide per-env-var: which strategy to use, where to write | `IntegrationManifest`, deploy target, current env state | List of `SecretAction` ops (write to `.env.local` / push to gh / push to vercel / generate / prompt) |
| `ci-generator.ts` | Generate stack-aware GitHub Actions workflows | `ProjectSpec`, deploy target, integration set | YAML files for `ci.yml`, `deploy-preview.yml`, `deploy-prod.yml` |
| `dev-orchestrator.ts` | Compute the `pnpm dev` script + docker-compose for the chosen integrations | Integration set, runtime preferences | `package.json#dev` value + `docker-compose.yml` content + readiness probes |
| `spec-codegen.ts` | Regenerate above-fence sections of generated files from spec | `ProjectSpec`, target file path | Updated file content (preserving below-fence content) |
| `migration-checker.ts` | Validate migration files declare idempotency clauses | List of new migration files | List of migration violations |

## Pure-function discipline

Every module is a pure function with this shape:

```ts
import type { ProjectSpec, StackDecision } from '../layer1/types';

export interface StackDeciderInput {
  spec: ProjectSpec;
  userPrefs: { skillsInstalled: string[]; preferredHosting?: string };
  registry: IntegrationRegistry; // loaded by Layer 3, passed in
}

export interface StackDeciderOutput {
  decision: StackDecision;
  rationale: string;            // markdown for the user to read at G0
  alternatives_per_layer: Record<string, string[]>;
}

export function decideStack(input: StackDeciderInput): StackDeciderOutput {
  // ... pure logic, no fs / network / shell ...
}
```

No I/O. No randomness without injected RNG. No `Date.now()` without injected clock. **This makes everything testable without mocks** and keeps reproducibility (§21) honest.

## Test contract

Each module ships with a `*.test.ts`:
- `prd-parser.test.ts` — golden-file tests against `skills/prd-parser/fixtures/*.md`
- `stack-decider.test.ts` — table-driven: spec input → expected decision (audit by reading rationale)
- `integration-applier.test.ts` — apply a fixture manifest to a fixture project tree, snapshot-test the result
- `secret-broker.test.ts` — for each strategy, table-driven outcomes
- `ci-generator.test.ts` — snapshot YAML output per stack combo
- `dev-orchestrator.test.ts` — given integration set, expected dev script + compose

## Why pure / not async

Three properties Layer 2 must guarantee:
1. **Reproducible** — same input, same output
2. **Replayable** — orchestrator can dry-run the whole bootstrap, then execute
3. **Testable** — no fs/network/git mocks; just plain function calls

Doing I/O in Layer 2 would break all three. I/O lives in Layer 1.

---

*Status: directory + skeleton README. No `.ts` source yet — Days 1-3 of §26/§30 build plan.*
