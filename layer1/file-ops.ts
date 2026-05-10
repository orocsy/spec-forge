/**
 * File operations — idempotent write/patch + fence-marker section upsert.
 *
 * Every fs side-effect emits a journal entry with an `inverse` action so
 * rollback can undo it. Hash-based conflict detection prevents silently
 * stomping human edits between bootstrap runs.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import { BootstrapError, FileHashConflictError } from './errors.js';
import { record } from './journal.js';
import type { BootstrapJournalEntry } from './schemas.js';

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface FileOpContext {
  journalPath: string;
  run_id: string;
  phase: BootstrapJournalEntry['phase'];
}

async function tryRead(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export interface WriteFileOptions {
  /**
   * Hash of the content we expected to find at the path. If set and the
   * actual hash differs, we throw `FileHashConflictError` instead of
   * overwriting — this catches "human edited the file between bootstrap
   * runs" and forces a 3-way merge.
   */
  expectedHash?: string | null;
  /** If `true`, only emit a journal entry when content actually changed. */
  skipIfUnchanged?: boolean;
}

export interface WriteFileResult {
  changed: boolean;
  pathHash: string;
}

/**
 * Idempotent write. Same content → no-op. Different content + matching
 * `expectedHash` → write + emit journal entry. Different content + hash
 * mismatch → throw.
 */
export async function writeFile(
  ctx: FileOpContext,
  path: string,
  content: string,
  options: WriteFileOptions = {}
): Promise<WriteFileResult> {
  const before = await tryRead(path);
  const beforeHash = before === null ? null : sha256(before);
  const afterHash = sha256(content);

  if (beforeHash === afterHash) {
    if (!options.skipIfUnchanged) {
      await record(ctx.journalPath, {
        run_id: ctx.run_id,
        phase: ctx.phase,
        event: 'file.write.noop',
        data: { path, hash: afterHash },
      });
    }
    return { changed: false, pathHash: afterHash };
  }

  if (options.expectedHash !== undefined && options.expectedHash !== beforeHash) {
    throw new FileHashConflictError(path, options.expectedHash ?? '<absent>', beforeHash ?? '<absent>');
  }

  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, content, 'utf8');

  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'file.write',
    data: { path, sha_before: beforeHash, sha_after: afterHash, bytes: Buffer.byteLength(content) },
    inverse:
      before !== null
        ? { event: 'file.restore', path, content: before }
        : { event: 'file.delete', path },
  });

  return { changed: true, pathHash: afterHash };
}

export async function deleteFile(ctx: FileOpContext, path: string): Promise<void> {
  const before = await tryRead(path);
  if (before === null) {
    return;
  }
  await fs.rm(path, { force: true });
  await record(ctx.journalPath, {
    run_id: ctx.run_id,
    phase: ctx.phase,
    event: 'file.delete',
    data: { path },
    inverse: { event: 'file.restore', path, content: before },
  });
}

/**
 * Fence-marker section upsert.
 *
 * Convention: `// === @scope/name ===\n...\n// === /@scope/name ===\n`
 * Comment style auto-detected (//, #, <!-- -->); pass explicit `comment`
 * if the auto-detect can't infer (e.g. for bare data files).
 */
export type CommentStyle = 'slash' | 'hash' | 'html';

const COMMENT_PRESETS: Record<CommentStyle, { open: string; close: string }> = {
  slash: { open: '// ', close: '' },
  hash: { open: '# ', close: '' },
  html: { open: '<!-- ', close: ' -->' },
};

export interface FencedSection {
  before: string;
  inside: string;
  after: string;
}

export interface UpsertFencedOptions {
  comment?: CommentStyle;
  /**
   * Hash of the content we expected inside the fence. If set and inside
   * has been edited away from this hash, we throw FileHashConflictError.
   */
  expectedInsideHash?: string | null;
  /** If file doesn't exist, what initial body to wrap the section in. */
  initialBody?: string;
  /**
   * Optional human-readable heading rendered immediately ABOVE the open
   * fence on first insertion. Useful for env files / READMEs where the
   * fence boundary needs context. Re-applies do not duplicate the title
   * (we look for it before re-inserting).
   */
  sectionTitle?: string;
}

export type UpsertResult =
  | { kind: 'inserted'; insideHash: string }
  | { kind: 'updated'; insideHash: string; previousInsideHash: string }
  | { kind: 'unchanged'; insideHash: string };

function detectCommentStyle(filePath: string): CommentStyle {
  // Dotfiles like `.env`, `.env.local`, `.env.example` use # comments.
  if (/(^|\/)\.env(\..+)?$/i.test(filePath)) return 'hash';
  if (/\.(ya?ml|py|sh|toml|env|prisma|gitignore|prettierignore|dockerignore)$/i.test(filePath))
    return 'hash';
  if (/\.(html?|xml|md|svelte|vue)$/i.test(filePath)) return 'html';
  return 'slash';
}

function fenceMarkers(comment: CommentStyle, fenceId: string): { open: string; close: string } {
  const c = COMMENT_PRESETS[comment];
  return {
    open: `${c.open}=== ${fenceId} ===${c.close}`,
    close: `${c.open}=== /${fenceId} ===${c.close}`,
  };
}

/**
 * Parse out a fenced region. Returns null if the fence isn't present.
 * Throws BootstrapError if open is found without matching close.
 */
export function parseFenced(
  source: string,
  fenceId: string,
  comment: CommentStyle
): FencedSection | null {
  const { open, close } = fenceMarkers(comment, fenceId);
  const openIdx = source.indexOf(open);
  if (openIdx === -1) return null;
  const closeIdx = source.indexOf(close, openIdx + open.length);
  if (closeIdx === -1) {
    throw new BootstrapError(
      'FILE_FENCE_NOT_FOUND',
      `open fence "${fenceId}" found but close marker missing`
    );
  }
  const insideStart = openIdx + open.length;
  const insideEnd = closeIdx;
  // Strip a single leading/trailing newline so callers don't accumulate them.
  let inside = source.slice(insideStart, insideEnd);
  if (inside.startsWith('\n')) inside = inside.slice(1);
  if (inside.endsWith('\n')) inside = inside.slice(0, -1);
  return {
    before: source.slice(0, openIdx),
    inside,
    after: source.slice(closeIdx + close.length),
  };
}

export async function upsertFenced(
  ctx: FileOpContext,
  filePath: string,
  fenceId: string,
  newInside: string,
  options: UpsertFencedOptions = {}
): Promise<UpsertResult> {
  const comment = options.comment ?? detectCommentStyle(filePath);
  const { open, close } = fenceMarkers(comment, fenceId);
  const newInsideHash = sha256(newInside);

  const existing = await tryRead(filePath);

  const titleLine = options.sectionTitle ? `${options.sectionTitle}\n` : '';

  // ── New file path ────────────────────────────────────────────────
  if (existing === null) {
    const initialBody = options.initialBody ?? '';
    const composed = `${initialBody}${initialBody && !initialBody.endsWith('\n') ? '\n' : ''}${titleLine}${open}\n${newInside}\n${close}\n`;
    await writeFile(ctx, filePath, composed);
    return { kind: 'inserted', insideHash: newInsideHash };
  }

  // ── Existing file, fence absent ──────────────────────────────────
  const parsed = parseFenced(existing, fenceId, comment);
  if (parsed === null) {
    // Don't duplicate sectionTitle if the user already has it in the file
    const titleAbsent = !options.sectionTitle || !existing.includes(options.sectionTitle);
    const titleToAppend = titleAbsent ? titleLine : '';
    const append = `${existing.endsWith('\n') ? '' : '\n'}${titleToAppend}${open}\n${newInside}\n${close}\n`;
    await writeFile(ctx, filePath, existing + append);
    return { kind: 'inserted', insideHash: newInsideHash };
  }

  // ── Fence exists, content matches ────────────────────────────────
  const oldInsideHash = sha256(parsed.inside);
  if (oldInsideHash === newInsideHash) {
    return { kind: 'unchanged', insideHash: newInsideHash };
  }

  // ── Fence exists, drift check ────────────────────────────────────
  if (options.expectedInsideHash !== undefined && options.expectedInsideHash !== oldInsideHash) {
    throw new FileHashConflictError(
      `${filePath}#${fenceId}`,
      options.expectedInsideHash ?? '<absent>',
      oldInsideHash
    );
  }

  // ── Fence exists, replace inside ─────────────────────────────────
  const composed = `${parsed.before}${open}\n${newInside}\n${close}${parsed.after}`;
  await writeFile(ctx, filePath, composed);
  return { kind: 'updated', insideHash: newInsideHash, previousInsideHash: oldInsideHash };
}

/** Remove a fenced section. No-op if the fence isn't present. */
export async function removeFenced(
  ctx: FileOpContext,
  filePath: string,
  fenceId: string,
  options: { comment?: CommentStyle } = {}
): Promise<boolean> {
  const existing = await tryRead(filePath);
  if (existing === null) return false;
  const comment = options.comment ?? detectCommentStyle(filePath);
  const parsed = parseFenced(existing, fenceId, comment);
  if (parsed === null) return false;
  const composed = `${parsed.before.replace(/\n$/, '')}${parsed.after.replace(/^\n/, '')}`;
  await writeFile(ctx, filePath, composed);
  return true;
}
