import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteFile,
  parseFenced,
  removeFenced,
  sha256,
  upsertFenced,
  writeFile,
  type FileOpContext,
} from '../file-ops.js';
import { readAll } from '../journal.js';

let tmpDir: string;
let ctx: FileOpContext;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'bootstrap-fileops-'));
  ctx = { journalPath: join(tmpDir, 'journal.jsonl'), run_id: 'r1', phase: 'B2' };
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('writeFile', () => {
  it('writes new content and emits a journal entry with file.delete inverse', async () => {
    const path = join(tmpDir, 'a/b/c.txt');
    const r = await writeFile(ctx, path, 'hello\n');
    expect(r.changed).toBe(true);
    expect(await fs.readFile(path, 'utf8')).toBe('hello\n');
    const entries = await readAll(ctx.journalPath);
    expect(entries[0]).toMatchObject({
      event: 'file.write',
      inverse: { event: 'file.delete', path },
    });
  });

  it('overwrites existing content with file.restore inverse', async () => {
    const path = join(tmpDir, 'x.txt');
    await writeFile(ctx, path, 'first\n');
    await writeFile(ctx, path, 'second\n');
    const entries = await readAll(ctx.journalPath);
    expect(entries[1]).toMatchObject({
      event: 'file.write',
      inverse: { event: 'file.restore', path, content: 'first\n' },
    });
  });

  it('is idempotent — same content emits a noop entry, not write', async () => {
    const path = join(tmpDir, 'x.txt');
    await writeFile(ctx, path, 'same\n');
    await writeFile(ctx, path, 'same\n');
    const entries = await readAll(ctx.journalPath);
    expect(entries[0]?.event).toBe('file.write');
    expect(entries[1]?.event).toBe('file.write.noop');
  });

  it('skipIfUnchanged skips the noop entry too', async () => {
    const path = join(tmpDir, 'x.txt');
    await writeFile(ctx, path, 'same\n');
    await writeFile(ctx, path, 'same\n', { skipIfUnchanged: true });
    expect(await readAll(ctx.journalPath)).toHaveLength(1);
  });

  it('throws FileHashConflictError when expectedHash mismatches', async () => {
    const path = join(tmpDir, 'x.txt');
    await writeFile(ctx, path, 'original\n');
    await fs.writeFile(path, 'human edited\n', 'utf8');
    await expect(
      writeFile(ctx, path, 'new\n', { expectedHash: sha256('original\n') })
    ).rejects.toMatchObject({ name: 'FileHashConflictError', code: 'FILE_HASH_CONFLICT' });
  });
});

describe('deleteFile', () => {
  it('emits file.restore inverse with prior content', async () => {
    const path = join(tmpDir, 'x.txt');
    await writeFile(ctx, path, 'bye\n');
    await deleteFile(ctx, path);
    const entries = await readAll(ctx.journalPath);
    expect(entries[1]).toMatchObject({
      event: 'file.delete',
      inverse: { event: 'file.restore', path, content: 'bye\n' },
    });
    await expect(fs.readFile(path)).rejects.toThrow();
  });

  it('is a no-op when the file does not exist', async () => {
    await deleteFile(ctx, join(tmpDir, 'nope.txt'));
    expect(await readAll(ctx.journalPath)).toEqual([]);
  });
});

describe('parseFenced', () => {
  it('finds and splits a fenced section (slash-comment)', () => {
    const src = `top\n// === @x/y ===\ninside\n// === /@x/y ===\nbottom`;
    const r = parseFenced(src, '@x/y', 'slash');
    expect(r).toMatchObject({
      before: 'top\n',
      inside: 'inside',
      after: '\nbottom',
    });
  });

  it('returns null when the open marker is missing', () => {
    expect(parseFenced('plain', '@x/y', 'slash')).toBeNull();
  });

  it('throws when open is found but close is missing', () => {
    expect(() => parseFenced('// === @x/y ===\nlonely', '@x/y', 'slash')).toThrow(
      /close marker missing/i
    );
  });
});

describe('upsertFenced', () => {
  it('inserts into a new file with an open + close marker', async () => {
    const path = join(tmpDir, 'm.ts');
    const r = await upsertFenced(ctx, path, '@clerk/middleware', 'import x;');
    expect(r.kind).toBe('inserted');
    const final = await fs.readFile(path, 'utf8');
    expect(final).toContain('// === @clerk/middleware ===');
    expect(final).toContain('// === /@clerk/middleware ===');
    expect(final).toContain('import x;');
  });

  it('appends a fence to an existing file without one', async () => {
    const path = join(tmpDir, 'm.ts');
    await writeFile(ctx, path, 'export const foo = 1;\n');
    const r = await upsertFenced(ctx, path, '@clerk/middleware', 'import x;');
    expect(r.kind).toBe('inserted');
    const final = await fs.readFile(path, 'utf8');
    expect(final.startsWith('export const foo = 1;')).toBe(true);
    expect(final).toContain('// === @clerk/middleware ===');
  });

  it('updates inside content when fence already exists', async () => {
    const path = join(tmpDir, 'm.ts');
    await upsertFenced(ctx, path, '@x/y', 'old body');
    const r = await upsertFenced(ctx, path, '@x/y', 'new body');
    expect(r.kind).toBe('updated');
    const final = await fs.readFile(path, 'utf8');
    expect(final).toContain('new body');
    expect(final).not.toContain('old body');
  });

  it('returns "unchanged" when inside content matches existing', async () => {
    const path = join(tmpDir, 'm.ts');
    await upsertFenced(ctx, path, '@x/y', 'same');
    const r = await upsertFenced(ctx, path, '@x/y', 'same');
    expect(r.kind).toBe('unchanged');
  });

  it('throws on hash conflict when expectedInsideHash drifts', async () => {
    const path = join(tmpDir, 'm.ts');
    await upsertFenced(ctx, path, '@x/y', 'original');
    // Simulate human edit inside the fence
    let final = await fs.readFile(path, 'utf8');
    final = final.replace('original', 'human-edited');
    await fs.writeFile(path, final, 'utf8');
    await expect(
      upsertFenced(ctx, path, '@x/y', 'new', { expectedInsideHash: sha256('original') })
    ).rejects.toMatchObject({ name: 'FileHashConflictError', code: 'FILE_HASH_CONFLICT' });
  });

  it('uses hash-style comments for .yml files', async () => {
    const path = join(tmpDir, 'compose.yml');
    await upsertFenced(ctx, path, '@stripe/svc', '  stripe-cli:\n    image: stripe/cli');
    const final = await fs.readFile(path, 'utf8');
    expect(final).toContain('# === @stripe/svc ===');
  });
});

describe('removeFenced', () => {
  it('strips the fence + content, leaves surrounding intact', async () => {
    const path = join(tmpDir, 'm.ts');
    await writeFile(ctx, path, 'top\n');
    await upsertFenced(ctx, path, '@x/y', 'middle');
    expect(await removeFenced(ctx, path, '@x/y')).toBe(true);
    const final = await fs.readFile(path, 'utf8');
    expect(final).not.toContain('@x/y');
    expect(final).toContain('top');
  });

  it('returns false when the fence is not present', async () => {
    const path = join(tmpDir, 'm.ts');
    await writeFile(ctx, path, 'plain\n');
    expect(await removeFenced(ctx, path, '@x/y')).toBe(false);
  });
});
