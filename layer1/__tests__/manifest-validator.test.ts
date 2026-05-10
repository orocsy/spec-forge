import { describe, expect, it } from 'vitest';
import { assertSetValid, validateOne, validateSet } from '../manifest-validator.js';

const stripe = {
  name: 'stripe',
  category: 'payments' as const,
  version: '1.0.0',
  files_owned: ['src/lib/stripe.ts'],
  env_vars: {
    STRIPE_SECRET_KEY: {
      scope: 'server' as const,
      dev_strategy: 'use_test_default' as const,
      dev_default: 'sk_test_xxx',
      prod_strategy: 'prompt_user' as const,
    },
  },
};

const clerk = {
  name: 'clerk',
  category: 'auth' as const,
  version: '1.0.0',
  files_owned: ['src/lib/auth.ts'],
};

describe('validateOne', () => {
  it('accepts a valid manifest', () => {
    expect(validateOne(stripe).ok).toBe(true);
  });

  it('reports issues with bad env_vars', () => {
    const r = validateOne({
      ...stripe,
      env_vars: {
        FOO: {
          scope: 'server',
          dev_strategy: 'use_test_default',
          // dev_default missing
          prod_strategy: 'prompt_user',
        },
      },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a path declared in both files_owned and files_appended', () => {
    const r = validateOne({
      ...stripe,
      files_appended: [{ path: 'src/lib/stripe.ts', fence_id: '@stripe/x' }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toMatch(/files_owned and files_appended/);
  });
});

describe('validateSet', () => {
  it('passes for two non-conflicting integrations', () => {
    const r = validateSet([stripe, clerk]);
    expect(r.ok).toBe(true);
    expect(r.manifests).toHaveLength(2);
  });

  it('detects file ownership conflicts across integrations', () => {
    const r = validateSet([
      stripe,
      { ...clerk, files_owned: ['src/lib/stripe.ts'] }, // collide with stripe
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toMatch(/file ownership conflict/);
  });

  it('detects missing dependencies', () => {
    const r = validateSet([{ ...stripe, depends_on_integrations: ['nonexistent'] }]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.message).toMatch(/depends_on_integrations references "nonexistent"/);
  });

  it('detects dependency cycles', () => {
    const a = { name: 'a', category: 'jobs' as const, version: '1', depends_on_integrations: ['b'] };
    const b = { name: 'b', category: 'jobs' as const, version: '1', depends_on_integrations: ['a'] };
    const r = validateSet([a, b]);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /cycle/i.test(i.message))).toBe(true);
  });
});

describe('assertSetValid', () => {
  it('returns the manifests on success', () => {
    const r = assertSetValid([stripe, clerk]);
    expect(r).toHaveLength(2);
  });

  it('throws IntegrationConflictError on file ownership conflict', () => {
    let caught: { name?: string; code?: string } | null = null;
    try {
      assertSetValid([stripe, { ...clerk, files_owned: ['src/lib/stripe.ts'] }]);
    } catch (e) {
      caught = e as { name?: string; code?: string };
    }
    expect(caught?.name).toBe('IntegrationConflictError');
    expect(caught?.code).toBe('INTEGRATION_CONFLICT');
  });
});
