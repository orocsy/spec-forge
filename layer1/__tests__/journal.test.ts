import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dispatchInverse, inversePlan, readAll, record, replay } from '../journal.js';

let tmpDir: string;
let journalPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'bootstrap-journal-'));
  journalPath = join(tmpDir, 'journal.jsonl');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('record + readAll', () => {
  it('writes a valid entry that round-trips through readAll', async () => {
    await record(journalPath, {
      run_id: 'run-1',
      phase: 'B0',
      event: 'prd.parsed',
      data: { feature_count: 3 },
    });
    const entries = await readAll(journalPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      run_id: 'run-1',
      phase: 'B0',
      event: 'prd.parsed',
      outcome: 'ok',
      data: { feature_count: 3 },
    });
  });

  it('returns [] when the journal does not exist yet', async () => {
    expect(await readAll(join(tmpDir, 'nope.jsonl'))).toEqual([]);
  });

  it('throws JOURNAL_CORRUPT on invalid JSON', async () => {
    await fs.writeFile(journalPath, '{this-is-not-json\n', 'utf8');
    await expect(readAll(journalPath)).rejects.toMatchObject({
      name: 'BootstrapError',
      code: 'JOURNAL_CORRUPT',
    });
  });

  it('throws JOURNAL_CORRUPT on schema-invalid entry', async () => {
    await fs.writeFile(journalPath, JSON.stringify({ ts: 'not-a-date' }) + '\n', 'utf8');
    await expect(readAll(journalPath)).rejects.toThrow(/schema/i);
  });

  it('appends entries (does not overwrite)', async () => {
    await record(journalPath, { run_id: 'r1', phase: 'B0', event: 'one' });
    await record(journalPath, { run_id: 'r1', phase: 'B1', event: 'two' });
    await record(journalPath, { run_id: 'r1', phase: 'B2', event: 'three' });
    expect(await readAll(journalPath)).toHaveLength(3);
  });
});

describe('replay filters', () => {
  beforeEach(async () => {
    await record(journalPath, { run_id: 'r1', phase: 'B0', event: 'a' });
    await record(journalPath, {
      run_id: 'r1',
      phase: 'B2',
      event: 'b',
      inverse: { event: 'file.delete', path: '/tmp/x' },
    });
    await record(journalPath, { run_id: 'r2', phase: 'B0', event: 'c' });
  });

  it('filters by phase', async () => {
    const r = await replay(journalPath, { phase: 'B0' });
    expect(r.map((e) => e.event)).toEqual(['a', 'c']);
  });

  it('filters by run_id', async () => {
    const r = await replay(journalPath, { run_id: 'r2' });
    expect(r.map((e) => e.event)).toEqual(['c']);
  });

  it('keeps only entries with an inverse action', async () => {
    const r = await replay(journalPath, { onlyWithInverse: true });
    expect(r.map((e) => e.event)).toEqual(['b']);
  });

  it('reverse iteration', async () => {
    const r = await replay(journalPath, { reverse: true });
    expect(r.map((e) => e.event)).toEqual(['c', 'b', 'a']);
  });
});

describe('inversePlan + dispatchInverse', () => {
  it('builds a reverse-ordered plan of inverses', async () => {
    await record(journalPath, {
      run_id: 'r1',
      phase: 'B2',
      event: 'wrote-A',
      inverse: { event: 'file.delete', path: '/A' },
    });
    await record(journalPath, {
      run_id: 'r1',
      phase: 'B2',
      event: 'wrote-B',
      inverse: { event: 'file.delete', path: '/B' },
    });
    const plan = await inversePlan(journalPath);
    expect(plan.map((p) => (p.event === 'file.delete' ? p.path : '?'))).toEqual(['/B', '/A']);
  });

  it('dispatches each inverse to the right handler', async () => {
    const calls: string[] = [];
    const handlers = {
      'file.restore': async () => {
        calls.push('restore');
      },
      'file.delete': async () => {
        calls.push('delete');
      },
      'secret.unset': async () => {
        calls.push('unset');
      },
      'git.reset': async () => {
        calls.push('reset');
      },
      'shell.exec': async () => {
        calls.push('exec');
      },
      'manifest.uninstall': async () => {
        calls.push('uninstall');
      },
    };
    await dispatchInverse({ event: 'file.delete', path: '/x' }, handlers);
    await dispatchInverse({ event: 'git.reset', to: 'abc123' }, handlers);
    expect(calls).toEqual(['delete', 'reset']);
  });
});
