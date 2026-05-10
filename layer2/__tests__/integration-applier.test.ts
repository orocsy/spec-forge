import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyIntegration } from '../integration-applier.js';
import { loadIntegration } from '../manifest-loader.js';

let registry: string;
let target: string;
let journalPath: string;

async function writeIntegration(
  name: string,
  manifest: Record<string, unknown>,
  patchFiles: Record<string, string> = {},
  fences: Record<string, string> = {},
  files: { envTemplate?: string; devDefaults?: string } = {},
  merges: Record<string, string> = {}
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
  for (const [rel, content] of Object.entries(merges)) {
    const p = join(dir, 'merge', rel);
    await fs.mkdir(join(p, '..'), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  }
  if (files.envTemplate) await fs.writeFile(join(dir, 'env.template'), files.envTemplate, 'utf8');
  if (files.devDefaults)
    await fs.writeFile(join(dir, 'dev-defaults.env'), files.devDefaults, 'utf8');
}

beforeEach(async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'applier-'));
  registry = join(root, 'reg');
  target = join(root, 'target');
  journalPath = join(root, 'journal.jsonl');
  await fs.mkdir(registry, { recursive: true });
  await fs.mkdir(target, { recursive: true });
});

afterEach(async () => {
  // tmpdir cleanup
});

const ctx = (overrides: Partial<{ targetDir: string; vars: Record<string, string> }> = {}) => ({
  journalPath,
  run_id: 'test',
  targetDir: overrides.targetDir ?? target,
  ...(overrides.vars ? { vars: overrides.vars } : {}),
});

describe('applyIntegration — patch copy', () => {
  it('copies patch files into target', async () => {
    await writeIntegration(
      'base',
      { name: 'base', category: 'observability', version: '1.0.0', files_owned: ['package.json'] },
      { 'package.json': '{"name":"app"}', 'src/index.ts': 'export {};' }
    );
    const loaded = await loadIntegration(join(registry, 'base'));
    const r = await applyIntegration(ctx(), loaded);
    expect(r.filesWritten).toEqual(['package.json', 'src/index.ts']);
    expect(await fs.readFile(join(target, 'package.json'), 'utf8')).toBe('{"name":"app"}');
  });

  it('substitutes {{var.name}} placeholders', async () => {
    await writeIntegration(
      'base',
      { name: 'base', category: 'observability', version: '1.0.0' },
      { 'package.json': '{"name":"{{project.name}}"}' }
    );
    const loaded = await loadIntegration(join(registry, 'base'));
    await applyIntegration(ctx({ vars: { 'project.name': 'demo' } }), loaded);
    expect(await fs.readFile(join(target, 'package.json'), 'utf8')).toBe('{"name":"demo"}');
  });

  it('throws on unresolved placeholders', async () => {
    await writeIntegration(
      'base',
      { name: 'base', category: 'observability', version: '1.0.0' },
      { 'src/x.ts': 'const x = "{{undefined.var}}";' }
    );
    const loaded = await loadIntegration(join(registry, 'base'));
    await expect(applyIntegration(ctx(), loaded)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('undefined.var'),
    });
  });
});

describe('applyIntegration — fence append', () => {
  it('upserts fence body into existing target file', async () => {
    // Base creates package.json
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['package.json'],
      },
      { 'package.json': '{\n  "name": "app"\n}\n' }
    );
    // Add-on appends scripts via fence
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        files_appended: [{ path: 'package.json', fence_id: '@addon/scripts' }],
      },
      {},
      { '@addon/scripts': '"lint": "eslint ."' }
    );
    const base = await loadIntegration(join(registry, 'base'));
    const addon = await loadIntegration(join(registry, 'addon'));

    await applyIntegration(ctx(), base);
    const r = await applyIntegration(ctx(), addon);

    expect(r.fencesUpserted).toEqual(['package.json#@addon/scripts']);
    const final = await fs.readFile(join(target, 'package.json'), 'utf8');
    expect(final).toContain('"name": "app"');
    expect(final).toContain('"lint": "eslint ."');
    expect(final).toMatch(/=== @addon\/scripts ===/);
  });

  it('rejects when fence target file does not exist yet', async () => {
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        files_appended: [{ path: 'package.json', fence_id: '@addon/scripts' }],
      },
      {},
      { '@addon/scripts': '"lint": "eslint ."' }
    );
    const addon = await loadIntegration(join(registry, 'addon'));
    await expect(applyIntegration(ctx(), addon)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('does not exist'),
    });
  });
});

describe('applyIntegration — env.template + dev-defaults', () => {
  it('appends env.template lines into .env.example', async () => {
    await writeIntegration(
      'foo',
      { name: 'foo', category: 'observability', version: '1.0.0' },
      {},
      {},
      { envTemplate: 'FOO_API_KEY=\nFOO_REGION=us-east-1\n' }
    );
    const loaded = await loadIntegration(join(registry, 'foo'));
    const r = await applyIntegration(ctx(), loaded);
    const envExample = await fs.readFile(join(target, '.env.example'), 'utf8');
    expect(envExample).toContain('FOO_API_KEY=');
    expect(envExample).toContain('FOO_REGION=us-east-1');
    expect(envExample).toMatch(/=== @foo\/env ===/);
    expect(r.envLinesAppended).toBe(2);
  });

  it('appends dev defaults into .env.local', async () => {
    await writeIntegration(
      'foo',
      { name: 'foo', category: 'observability', version: '1.0.0' },
      {},
      {},
      { devDefaults: 'FOO_API_KEY=test_key\n' }
    );
    const loaded = await loadIntegration(join(registry, 'foo'));
    const r = await applyIntegration(ctx(), loaded);
    const envLocal = await fs.readFile(join(target, '.env.local'), 'utf8');
    expect(envLocal).toContain('FOO_API_KEY=test_key');
    expect(r.devDefaultsAppended).toBe(1);
  });

});

describe('applyIntegration — json_merges', () => {
  it('deep-merges into an existing JSON file', async () => {
    // Base owns package.json
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['package.json'],
      },
      {
        'package.json': JSON.stringify(
          { name: 'app', scripts: { build: 'tsc' }, devDependencies: { typescript: '^5' } },
          null,
          2
        ),
      }
    );
    // Addon json-merges scripts + devDeps
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'package.json', patch_file: 'package.json' }],
      },
      {},
      {},
      {},
      {
        'package.json': JSON.stringify({
          scripts: { lint: 'eslint .' },
          devDependencies: { eslint: '^9' },
        }),
      }
    );

    const base = await loadIntegration(join(registry, 'base'));
    const addon = await loadIntegration(join(registry, 'addon'));
    await applyIntegration(ctx(), base);
    const r = await applyIntegration(ctx(), addon);

    expect(r.jsonMerges).toEqual(['package.json ← package.json']);
    const final = JSON.parse(await fs.readFile(join(target, 'package.json'), 'utf8'));
    expect(final.name).toBe('app');
    expect(final.scripts).toEqual({ build: 'tsc', lint: 'eslint .' });
    expect(final.devDependencies).toEqual({ typescript: '^5', eslint: '^9' });
  });

  it('honours $delete sentinel to drop a base key', async () => {
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['tsconfig.json'],
      },
      {
        'tsconfig.json': JSON.stringify(
          { compilerOptions: { rootDir: 'src', outDir: 'dist', strict: true } },
          null,
          2
        ),
      }
    );
    await writeIntegration(
      'next',
      {
        name: 'next',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'tsconfig.json', patch_file: 'tsconfig.json' }],
      },
      {},
      {},
      {},
      {
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            noEmit: true,
            rootDir: '$delete',
            outDir: '$delete',
          },
        }),
      }
    );

    await applyIntegration(ctx(), await loadIntegration(join(registry, 'base')));
    await applyIntegration(ctx(), await loadIntegration(join(registry, 'next')));

    const final = JSON.parse(await fs.readFile(join(target, 'tsconfig.json'), 'utf8'));
    expect(final.compilerOptions.rootDir).toBeUndefined();
    expect(final.compilerOptions.outDir).toBeUndefined();
    expect(final.compilerOptions.strict).toBe(true);
    expect(final.compilerOptions.noEmit).toBe(true);
  });

  it('produces valid JSON output (no fence-marker corruption)', async () => {
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['package.json'],
      },
      { 'package.json': '{"name":"x"}\n' }
    );
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'package.json', patch_file: 'package.json' }],
      },
      {},
      {},
      {},
      { 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) }
    );

    await applyIntegration(ctx(), await loadIntegration(join(registry, 'base')));
    await applyIntegration(ctx(), await loadIntegration(join(registry, 'addon')));

    // Must round-trip through JSON.parse without throwing
    const raw = await fs.readFile(join(target, 'package.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('substitutes {{...}} placeholders inside the merge patch', async () => {
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['config.json'],
      },
      { 'config.json': '{}' }
    );
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'config.json', patch_file: 'config.json' }],
      },
      {},
      {},
      {},
      { 'config.json': JSON.stringify({ name: '{{project.name}}' }) }
    );
    await applyIntegration(ctx(), await loadIntegration(join(registry, 'base')));
    await applyIntegration(
      ctx({ vars: { 'project.name': 'demo-app' } }),
      await loadIntegration(join(registry, 'addon'))
    );
    const final = JSON.parse(await fs.readFile(join(target, 'config.json'), 'utf8'));
    expect(final.name).toBe('demo-app');
  });

  it('is idempotent — re-applying produces the same JSON', async () => {
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['package.json'],
      },
      { 'package.json': '{"name":"x","scripts":{"build":"tsc"}}\n' }
    );
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'package.json', patch_file: 'package.json' }],
      },
      {},
      {},
      {},
      { 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) }
    );
    await applyIntegration(ctx(), await loadIntegration(join(registry, 'base')));
    const addon = await loadIntegration(join(registry, 'addon'));
    await applyIntegration(ctx(), addon);
    const first = await fs.readFile(join(target, 'package.json'), 'utf8');
    await applyIntegration(ctx(), addon);
    const second = await fs.readFile(join(target, 'package.json'), 'utf8');
    expect(first).toBe(second);
  });

  it('rejects when target file exists but is not valid JSON', async () => {
    await writeIntegration(
      'base',
      {
        name: 'base',
        category: 'observability',
        version: '1.0.0',
        files_owned: ['package.json'],
      },
      { 'package.json': 'this-is-not-json' }
    );
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'package.json', patch_file: 'package.json' }],
      },
      {},
      {},
      {},
      { 'package.json': '{"a":1}' }
    );
    await applyIntegration(ctx(), await loadIntegration(join(registry, 'base')));
    await expect(
      applyIntegration(ctx(), await loadIntegration(join(registry, 'addon')))
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('not valid JSON'),
    });
  });

  it('writes to a non-existent file by treating base as {}', async () => {
    // Some integrations may json_merge into a file no prior step created
    await writeIntegration(
      'addon',
      {
        name: 'addon',
        category: 'observability',
        version: '1.0.0',
        json_merges: [{ file: 'fresh.json', patch_file: 'fresh.json' }],
      },
      {},
      {},
      {},
      { 'fresh.json': JSON.stringify({ hello: 'world' }) }
    );
    await applyIntegration(ctx(), await loadIntegration(join(registry, 'addon')));
    const final = JSON.parse(await fs.readFile(join(target, 'fresh.json'), 'utf8'));
    expect(final).toEqual({ hello: 'world' });
  });

  it('rejects manifests with non-.json file in json_merges (schema)', async () => {
    await expect(
      writeIntegration(
        'addon',
        {
          name: 'addon',
          category: 'observability',
          version: '1.0.0',
          json_merges: [{ file: 'config.yaml', patch_file: 'config.yaml' }],
        },
        {},
        {},
        {},
        { 'config.yaml': 'a: 1' }
      ).then(() => loadIntegration(join(registry, 'addon')))
    ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });

  it('original env idempotent test — applying twice produces the same .env.example', async () => {
    await writeIntegration(
      'foo',
      { name: 'foo', category: 'observability', version: '1.0.0' },
      {},
      {},
      { envTemplate: 'FOO_API_KEY=\n' }
    );
    const loaded = await loadIntegration(join(registry, 'foo'));
    await applyIntegration(ctx(), loaded);
    const first = await fs.readFile(join(target, '.env.example'), 'utf8');
    await applyIntegration(ctx(), loaded);
    const second = await fs.readFile(join(target, '.env.example'), 'utf8');
    expect(first).toBe(second);
  });
});
