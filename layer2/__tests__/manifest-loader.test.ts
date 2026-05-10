import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAndOrder, loadIntegration, topoSort } from '../manifest-loader.js';

let registry: string;

async function writeIntegration(
  name: string,
  manifest: Record<string, unknown>,
  patchFiles: Record<string, string> = {},
  fences: Record<string, string> = {},
  files: { envTemplate?: string; devDefaults?: string } = {}
): Promise<void> {
  const dir = join(registry, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  for (const [rel, content] of Object.entries(patchFiles)) {
    const p = join(dir, 'patch', rel);
    await fs.mkdir(join(p, '..'), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  }
  for (const [fenceId, body] of Object.entries(fences)) {
    const safe = fenceId.replace(/^@/, '').replace(/[\/]/g, '__');
    await fs.mkdir(join(dir, 'fence'), { recursive: true });
    await fs.writeFile(join(dir, 'fence', `${safe}.txt`), body, 'utf8');
  }
  if (files.envTemplate) await fs.writeFile(join(dir, 'env.template'), files.envTemplate, 'utf8');
  if (files.devDefaults)
    await fs.writeFile(join(dir, 'dev-defaults.env'), files.devDefaults, 'utf8');
}

beforeEach(async () => {
  registry = await fs.mkdtemp(join(tmpdir(), 'manifest-registry-'));
});
afterEach(async () => {
  await fs.rm(registry, { recursive: true, force: true });
});

const baseManifest = (name: string, extras: Record<string, unknown> = {}) => ({
  name,
  category: 'observability',
  version: '1.0.0',
  ...extras,
});

describe('loadIntegration', () => {
  it('loads a minimal integration', async () => {
    await writeIntegration('foo', baseManifest('foo'));
    const r = await loadIntegration(join(registry, 'foo'));
    expect(r.manifest.name).toBe('foo');
    expect(r.patchFiles).toEqual([]);
  });

  it('lists patch files', async () => {
    await writeIntegration('foo', baseManifest('foo'), {
      'package.json': '{"name":"foo"}',
      'src/index.ts': 'export {};',
    });
    const r = await loadIntegration(join(registry, 'foo'));
    expect(r.patchFiles).toEqual(['package.json', 'src/index.ts']);
  });

  it('rejects when files_owned references missing patch file', async () => {
    await writeIntegration(
      'foo',
      baseManifest('foo', { files_owned: ['package.json'] }),
      { 'tsconfig.json': '{}' }
    );
    await expect(loadIntegration(join(registry, 'foo'))).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
      message: expect.stringContaining('files_owned'),
    });
  });

  it('loads fence bodies referenced by files_appended', async () => {
    await writeIntegration(
      'foo',
      baseManifest('foo', {
        files_appended: [{ path: 'package.json', fence_id: '@foo/scripts' }],
      }),
      {},
      { '@foo/scripts': 'lint: eslint .' }
    );
    const r = await loadIntegration(join(registry, 'foo'));
    expect(r.fenceBodies['@foo/scripts']).toBe('lint: eslint .');
  });

  it('rejects when a fence body file is missing', async () => {
    await writeIntegration(
      'foo',
      baseManifest('foo', {
        files_appended: [{ path: 'package.json', fence_id: '@foo/scripts' }],
      })
    );
    await expect(loadIntegration(join(registry, 'foo'))).rejects.toMatchObject({
      code: 'MANIFEST_INVALID',
      message: expect.stringContaining('fence'),
    });
  });

  it('loads env.template and dev-defaults.env when present', async () => {
    await writeIntegration(
      'foo',
      baseManifest('foo'),
      {},
      {},
      { envTemplate: 'FOO_API_KEY=', devDefaults: 'FOO_API_KEY=test' }
    );
    const r = await loadIntegration(join(registry, 'foo'));
    expect(r.envTemplate).toContain('FOO_API_KEY');
    expect(r.devDefaults).toContain('test');
  });
});

describe('topoSort', () => {
  it('orders dependencies before dependents', async () => {
    await writeIntegration('a', baseManifest('a'));
    await writeIntegration('b', baseManifest('b', { depends_on_integrations: ['a'] }));
    await writeIntegration('c', baseManifest('c', { depends_on_integrations: ['b'] }));
    const loaded = [
      await loadIntegration(join(registry, 'c')),
      await loadIntegration(join(registry, 'b')),
      await loadIntegration(join(registry, 'a')),
    ];
    const sorted = topoSort(loaded);
    expect(sorted.map((s) => s.manifest.name)).toEqual(['a', 'b', 'c']);
  });

  it('throws on cycles', async () => {
    await writeIntegration('a', baseManifest('a', { depends_on_integrations: ['b'] }));
    await writeIntegration('b', baseManifest('b', { depends_on_integrations: ['a'] }));
    const loaded = [
      await loadIntegration(join(registry, 'a')),
      await loadIntegration(join(registry, 'b')),
    ];
    expect(() => topoSort(loaded)).toThrowError(/cycle/i);
  });
});

describe('loadAndOrder', () => {
  it('returns INTEGRATION_NOT_FOUND when an integration is missing', async () => {
    await writeIntegration('a', baseManifest('a'));
    await expect(loadAndOrder(registry, ['a', 'nope'])).rejects.toMatchObject({
      code: 'INTEGRATION_NOT_FOUND',
    });
  });

  it('detects cross-integration file ownership conflicts', async () => {
    await writeIntegration('a', baseManifest('a', { files_owned: ['shared.ts'] }), {
      'shared.ts': '/* a */',
    });
    await writeIntegration('b', baseManifest('b', { files_owned: ['shared.ts'] }), {
      'shared.ts': '/* b */',
    });
    await expect(loadAndOrder(registry, ['a', 'b'])).rejects.toMatchObject({
      code: 'INTEGRATION_CONFLICT',
    });
  });
});
