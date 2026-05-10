import { describe, expect, it } from 'vitest';
import {
  ProjectSpec,
  IntegrationManifest,
  BootstrapJournalEntry,
  FieldSpec,
  EntitySpec,
} from '../schemas.js';

describe('FieldSpec', () => {
  it('accepts a simple string field', () => {
    expect(FieldSpec.parse({ name: 'phone', type: 'string' })).toMatchObject({
      name: 'phone',
      type: 'string',
      optional: false,
      unique: false,
    });
  });

  it('rejects PascalCase field names (those are entities)', () => {
    expect(() => FieldSpec.parse({ name: 'Phone', type: 'string' })).toThrow();
  });

  it('relation fields require a `references` target', () => {
    expect(() => FieldSpec.parse({ name: 'tenant', type: 'relation' })).toThrow(
      /references/i
    );
    expect(() =>
      FieldSpec.parse({ name: 'tenant', type: 'relation', references: 'Tenant' })
    ).not.toThrow();
  });

  it('enum fields require non-empty enum_values', () => {
    expect(() => FieldSpec.parse({ name: 'role', type: 'enum' })).toThrow(/enum_values/i);
    expect(() =>
      FieldSpec.parse({ name: 'role', type: 'enum', enum_values: ['admin', 'user'] })
    ).not.toThrow();
  });
});

describe('EntitySpec', () => {
  it('requires PascalCase entity names', () => {
    expect(() =>
      EntitySpec.parse({ name: 'customer', fields: [{ name: 'id', type: 'string' }] })
    ).toThrow();
    expect(() =>
      EntitySpec.parse({ name: 'Customer', fields: [{ name: 'id', type: 'string' }] })
    ).not.toThrow();
  });

  it('rejects entities with no fields', () => {
    expect(() => EntitySpec.parse({ name: 'Customer', fields: [] })).toThrow();
  });
});

describe('ProjectSpec', () => {
  const minimal = {
    meta: {
      name: 'demo-app',
      description: 'demo application for tests',
      spec_schema_version: 1 as const,
    },
  };

  it('accepts a minimal spec and applies defaults', () => {
    const r = ProjectSpec.parse(minimal);
    expect(r.meta.name).toBe('demo-app');
    expect(r.deploy.target).toBe('vercel');
    expect(r.observability.error_tracking).toBe(true);
    expect(r.non_functional.multi_tenant).toBe(false);
    expect(r.data_model).toEqual([]);
  });

  it('rejects PascalCase project name', () => {
    expect(() =>
      ProjectSpec.parse({
        ...minimal,
        meta: { ...minimal.meta, name: 'DemoApp' },
      })
    ).toThrow();
  });

  it('rejects feature ids that do not match F<n>', () => {
    expect(() =>
      ProjectSpec.parse({
        ...minimal,
        features: [{ id: 'feature-1', title: 'do something useful', done_when: ['x'] }],
      })
    ).toThrow();
  });

  it('requires at least one done_when per feature', () => {
    expect(() =>
      ProjectSpec.parse({
        ...minimal,
        features: [{ id: 'F1', title: 'do something useful', done_when: [] }],
      })
    ).toThrow();
  });
});

describe('IntegrationManifest', () => {
  const valid = {
    name: 'stripe',
    category: 'payments',
    version: '1.0.0',
    env_vars: {
      STRIPE_SECRET_KEY: {
        scope: 'server',
        dev_strategy: 'use_test_default',
        dev_default: 'sk_test_xxx',
        prod_strategy: 'prompt_user',
      },
    },
  };

  it('accepts a complete manifest', () => {
    expect(() => IntegrationManifest.parse(valid)).not.toThrow();
  });

  it('rejects use_test_default without dev_default', () => {
    expect(() =>
      IntegrationManifest.parse({
        ...valid,
        env_vars: {
          STRIPE_SECRET_KEY: {
            scope: 'server',
            dev_strategy: 'use_test_default',
            prod_strategy: 'prompt_user',
          },
        },
      })
    ).toThrow();
  });

  it('rejects fence ids that do not match @scope/name', () => {
    expect(() =>
      IntegrationManifest.parse({
        ...valid,
        files_appended: [{ path: 'src/middleware.ts', fence_id: 'plain-name' }],
      })
    ).toThrow();
  });
});

describe('BootstrapJournalEntry', () => {
  it('accepts a basic entry', () => {
    const r = BootstrapJournalEntry.parse({
      ts: '2026-05-07T12:00:00Z',
      run_id: 'run-1',
      phase: 'B0',
      event: 'prd.parsed',
    });
    expect(r.outcome).toBe('ok');
  });

  it('validates the inverse action discriminator', () => {
    expect(() =>
      BootstrapJournalEntry.parse({
        ts: '2026-05-07T12:00:00Z',
        run_id: 'run-1',
        phase: 'B2',
        event: 'file.write',
        inverse: { event: 'unknown.thing' },
      })
    ).toThrow();
  });
});
