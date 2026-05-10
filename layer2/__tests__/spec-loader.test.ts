import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSpec, validateSpec } from '../spec-loader.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(join(tmpdir(), 'spec-loader-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const minimal = {
  meta: {
    name: 'demo-app',
    description: 'demo for tests',
    spec_schema_version: 1,
  },
};

describe('loadSpec', () => {
  it('loads + validates a JSON spec', async () => {
    const path = join(tmpDir, 'spec.json');
    await fs.writeFile(path, JSON.stringify(minimal), 'utf8');
    const r = await loadSpec(path);
    expect(r.format).toBe('json');
    expect(r.spec.meta.name).toBe('demo-app');
    expect(r.spec.deploy.target).toBe('vercel'); // default applied
  });

  it('rejects YAML in v1', async () => {
    const path = join(tmpDir, 'spec.yml');
    await fs.writeFile(path, 'meta:\n  name: x', 'utf8');
    await expect(loadSpec(path)).rejects.toMatchObject({ code: 'SPEC_INVALID' });
  });

  it('reports missing file with SPEC_INVALID', async () => {
    await expect(loadSpec(join(tmpDir, 'nope.json'))).rejects.toMatchObject({
      code: 'SPEC_INVALID',
    });
  });

  it('reports invalid JSON', async () => {
    const path = join(tmpDir, 'bad.json');
    await fs.writeFile(path, '{not-json', 'utf8');
    await expect(loadSpec(path)).rejects.toMatchObject({
      code: 'SPEC_INVALID',
      message: expect.stringContaining('not valid JSON'),
    });
  });

  it('reports schema violations with issues attached', async () => {
    const path = join(tmpDir, 'bad-schema.json');
    await fs.writeFile(path, JSON.stringify({ meta: { name: 'X' } }), 'utf8');
    try {
      await loadSpec(path);
      expect.fail('expected throw');
    } catch (err) {
      const e = err as { code?: string; details?: { issues?: unknown[] } };
      expect(e.code).toBe('SPEC_INVALID');
      expect(Array.isArray(e.details?.issues)).toBe(true);
    }
  });
});

describe('validateSpec (sync helper)', () => {
  it('returns parsed spec on success', () => {
    const r = validateSpec(minimal);
    expect(r.meta.name).toBe('demo-app');
  });

  it('throws on invalid input', () => {
    expect(() => validateSpec({ meta: {} })).toThrowError(/spec fails schema/);
  });
});
