# Layer 3 — Orchestrator

Runs the bootstrap workflow. Stitches Layer 2 modules together, manages the rollback journal, drives Layer 1 side effects, surfaces decisions to the user via the chosen Layer 4 surface.

**Target size: ~300 LOC.**

## Single entrypoint

```ts
// orchestrator.ts
import type { BootstrapInput, BootstrapResult, Mode } from '../layer1/types';

export async function bootstrap(input: BootstrapInput): Promise<BootstrapResult> {
  // Phases B0..B6 — see ../docs/zero-to-running-design.md §3
  // Each phase calls Layer 2 modules + emits journal entries via Layer 1.
}
```

`Mode` is `'interactive' | 'mcp' | 'cli' | 'headless'` (see Layer 4 contract in §17 of the design doc).

## Phase sequence (matches §3 of the design doc)

| Phase | Calls | Surfaces to user? |
|-------|-------|-------------------|
| B0 — PRD parse | `prd-parser` (Layer 2) | If `_clarifications.length > 0` |
| B1 — Stack decide | `stack-decider` (Layer 2) | **Yes — Gate G0** (mandatory approval) |
| B2 — Scaffold | `git-clone` (Layer 1), `integration-applier` (Layer 2 × N integrations) | No |
| B3 — Secret bootstrap | `secret-broker` (Layer 2), `secret-stores` (Layer 1) | If any var has `dev_strategy: prompt_user` |
| B4 — Dev smoke | `dev-orchestrator` (Layer 2), `shell-exec` (Layer 1) | Only on failure |
| B5 — CI/CD | `ci-generator` (Layer 2), `file-ops` (Layer 1) | No |
| B6 — First MIU | Hands off to `/dev-pipeline:plan` | **Yes — Gate G1** when plan command resumes |

## Rollback journal

The orchestrator opens a journal at `bootstrap-journal-<run-id>.jsonl`. Every phase emits entries via `journal.record(...)`. On any phase failure:

```ts
async function rollback(journalPath: string) {
  const events = await journal.replay(journalPath);
  for (const event of events.reverse()) {
    if (event.inverse) {
      await dispatch(event.inverse); // file restore, secret unset, git reset, etc.
    }
  }
}
```

The journal is kept on success too — it's the project's bootstrap audit trail. It's the single source for "why was this integration chosen" debugging.

## Idempotency handling

If `bootstrap` is invoked on a project that already has a `bootstrap.lock` file, the orchestrator switches to **diff mode**:
- Compare current spec to the locked spec
- For each diff: produce an additive patch (don't re-run integrations that haven't changed)
- For changed integrations: 3-way merge against marker fences
- For removed integrations: run their declared `inverse` actions

This is what makes "same PRD → same project" + "evolved PRD → minimal diff" both work.

## Mode-specific surfacing

| Mode | Clarifying-question handling | Gate handling |
|------|-----------------------------|---------------|
| `interactive` (Claude Code slash) | Pause; emit a chat message; wait for user reply in transcript | Same — wait for user `[Y]` |
| `mcp` (any LLM agent) | Return `{ status: 'needs_input', missing: [...] }`; caller re-invokes with answers | Return `{ status: 'awaiting_g0', ... }`; caller calls `bootstrap.approve_g0()` |
| `cli` (shell) | Exit non-zero with JSON to stderr if any input missing | Print to stdout, accept `--auto-approve` flag for headless |
| `headless` (CI) | Fail fast on any missing input — must be deterministic from inputs | `--auto-approve` is required; otherwise fail |

## Telemetry hook

Each phase emits a structured event to `.claude/agent-events.jsonl` per §25 of the design doc. Optional opt-in anonymous shipping to a registry-author endpoint for "which PRD signals fail to parse" feedback.

---

*Status: directory + skeleton README. The orchestrator is the last module to write because it depends on all of Layer 1 and Layer 2.*
