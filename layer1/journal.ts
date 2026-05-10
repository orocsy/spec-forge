/**
 * Bootstrap journal — append-only audit log + rollback engine.
 *
 * Every side-effecting Layer 1 function emits a `BootstrapJournalEntry` here.
 * On failure, Layer 3 calls `replay(reverse=true)` to undo each step's `inverse`.
 *
 * The journal is also the project's permanent audit trail: future agents can
 * `git grep` for "why was this integration chosen" / "when was this secret set"
 * without re-derivation.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

import { BootstrapError } from './errors.js';
import { BootstrapJournalEntry, type InverseAction } from './schemas.js';

export interface JournalRecordInput {
  run_id: string;
  phase: BootstrapJournalEntry['phase'];
  event: string;
  outcome?: BootstrapJournalEntry['outcome'];
  data?: Record<string, unknown>;
  inverse?: InverseAction;
}

/**
 * Append a structured event to the journal file.
 *
 * Crash-safety: opens with O_APPEND so concurrent writers don't tear lines.
 * Each entry validates against the Zod schema BEFORE write — corrupt entries
 * never reach disk. If validation throws, the caller crashed early on bad
 * input rather than poisoning the audit trail.
 */
export async function record(
  journalPath: string,
  input: JournalRecordInput
): Promise<BootstrapJournalEntry> {
  const entry: BootstrapJournalEntry = BootstrapJournalEntry.parse({
    ts: new Date().toISOString(),
    run_id: input.run_id,
    phase: input.phase,
    event: input.event,
    outcome: input.outcome ?? 'ok',
    ...(input.data ? { data: input.data } : {}),
    ...(input.inverse ? { inverse: input.inverse } : {}),
  });

  await fs.mkdir(dirname(journalPath), { recursive: true });
  await fs.appendFile(journalPath, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/**
 * Read every entry from a journal file.
 * Throws `JOURNAL_CORRUPT` if any line fails Zod validation — the caller
 * decides whether to abort or attempt partial recovery.
 */
export async function readAll(journalPath: string): Promise<BootstrapJournalEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(journalPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const lines = raw.split('\n').filter((l) => l.length > 0);
  const result: BootstrapJournalEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (cause) {
      throw new BootstrapError('JOURNAL_CORRUPT', `journal line ${i + 1} is not valid JSON`, {
        details: { journalPath, lineNumber: i + 1, line },
        cause,
      });
    }
    const validated = BootstrapJournalEntry.safeParse(parsed);
    if (!validated.success) {
      throw new BootstrapError('JOURNAL_CORRUPT', `journal line ${i + 1} fails schema`, {
        details: { journalPath, lineNumber: i + 1, issues: validated.error.issues },
      });
    }
    result.push(validated.data);
  }

  return result;
}

export interface ReplayFilter {
  phase?: BootstrapJournalEntry['phase'];
  run_id?: string;
  reverse?: boolean;
  onlyWithInverse?: boolean;
}

/**
 * Iterate journal entries with optional filtering. Use `reverse: true` for
 * rollback — pairs nicely with `dispatchInverse` below.
 */
export async function replay(
  journalPath: string,
  filter: ReplayFilter = {}
): Promise<BootstrapJournalEntry[]> {
  const all = await readAll(journalPath);
  let filtered = all;

  if (filter.phase) {
    filtered = filtered.filter((e) => e.phase === filter.phase);
  }
  if (filter.run_id) {
    filtered = filtered.filter((e) => e.run_id === filter.run_id);
  }
  if (filter.onlyWithInverse) {
    filtered = filtered.filter((e) => e.inverse !== undefined);
  }
  if (filter.reverse) {
    filtered = [...filtered].reverse();
  }

  return filtered;
}

/**
 * Type-safe inverse-action handler shape. Each Layer 1 module that emits
 * inverse actions registers a handler here; orchestrator dispatches during
 * rollback.
 */
export interface InverseDispatcher {
  'file.restore': (action: Extract<InverseAction, { event: 'file.restore' }>) => Promise<void>;
  'file.delete': (action: Extract<InverseAction, { event: 'file.delete' }>) => Promise<void>;
  'secret.unset': (action: Extract<InverseAction, { event: 'secret.unset' }>) => Promise<void>;
  'git.reset': (action: Extract<InverseAction, { event: 'git.reset' }>) => Promise<void>;
  'shell.exec': (action: Extract<InverseAction, { event: 'shell.exec' }>) => Promise<void>;
  'manifest.uninstall': (
    action: Extract<InverseAction, { event: 'manifest.uninstall' }>
  ) => Promise<void>;
}

/**
 * Dispatch one inverse action. Caller passes a registry of handlers; this
 * function is just a typed switch + audit-on-failure.
 */
export async function dispatchInverse(
  action: InverseAction,
  handlers: InverseDispatcher
): Promise<void> {
  switch (action.event) {
    case 'file.restore':
      return handlers['file.restore'](action);
    case 'file.delete':
      return handlers['file.delete'](action);
    case 'secret.unset':
      return handlers['secret.unset'](action);
    case 'git.reset':
      return handlers['git.reset'](action);
    case 'shell.exec':
      return handlers['shell.exec'](action);
    case 'manifest.uninstall':
      return handlers['manifest.uninstall'](action);
    default: {
      // Exhaustiveness check — TS will error if a new InverseAction variant is
      // added and not handled above.
      const _exhaustive: never = action;
      throw new BootstrapError(
        'JOURNAL_CORRUPT',
        `unknown inverse action: ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

/** Helper for Layer 3: derive the full inverse plan from a journal. */
export async function inversePlan(journalPath: string): Promise<InverseAction[]> {
  const entries = await replay(journalPath, { reverse: true, onlyWithInverse: true });
  return entries.map((e) => e.inverse).filter((i): i is InverseAction => !!i);
}

/** Defensive deep-clone — avoids mutating the journal entry in-flight. */
export function cloneEntry(entry: BootstrapJournalEntry): BootstrapJournalEntry {
  // Structured-clone is preferable but adds a Node-version floor; JSON
  // round-trip is fine because journal entries are pure JSON anyway.
  return BootstrapJournalEntry.parse(JSON.parse(JSON.stringify(entry)) as unknown);
}

// Re-export the schema for callers that want to validate externally.
export { BootstrapJournalEntry } from './schemas.js';
export type { JournalRecordInput as RecordInput };
// Re-export Zod for advanced custom queries (kept narrow so we don't leak surface).
export const __schema = { entry: BootstrapJournalEntry } as const;
export const __z = z;
