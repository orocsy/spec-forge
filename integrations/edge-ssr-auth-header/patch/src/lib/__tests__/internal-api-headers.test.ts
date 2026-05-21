/**
 * Targets the security-sensitive paths in `getInternalApiHeaders`.
 *
 * Why each test exists:
 *   1. Returning `{}` on unset env is the safe default — real browsers don't
 *      carry the token, neither should an unconfigured SSR. Asserting this
 *      explicitly prevents a future refactor from accidentally injecting a
 *      hardcoded fallback (which would either break local dev or, worse,
 *      leak a fake header to the CDN).
 *   2. Whitespace handling catches the "paste with newline" foot-gun common
 *      when configuring env vars in cloud dashboards.
 *   3. The NEXT_PUBLIC_ guard is critical: if a future contributor renames
 *      the env, they MUST NOT use a `NEXT_PUBLIC_*` prefix or the token
 *      ends up in the browser bundle, defeating the whole point.
 *   4. Fresh-object-per-call prevents a class of bug where one fetch's
 *      header mutation bleeds into another.
 */
import { getInternalApiHeaders } from '../internal-api-headers';

describe('getInternalApiHeaders', () => {
  const originalToken = process.env.INTERNAL_API_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.INTERNAL_API_TOKEN;
    } else {
      process.env.INTERNAL_API_TOKEN = originalToken;
    }
  });

  it('returns empty object when INTERNAL_API_TOKEN env is unset', () => {
    delete process.env.INTERNAL_API_TOKEN;
    expect(getInternalApiHeaders()).toEqual({});
  });

  it('returns empty object when INTERNAL_API_TOKEN is empty string', () => {
    process.env.INTERNAL_API_TOKEN = '';
    expect(getInternalApiHeaders()).toEqual({});
  });

  it('returns empty object when INTERNAL_API_TOKEN is whitespace only', () => {
    process.env.INTERNAL_API_TOKEN = '   \n  ';
    expect(getInternalApiHeaders()).toEqual({});
  });

  it('emits x-internal-token header when value is set', () => {
    process.env.INTERNAL_API_TOKEN = 'cdn-bypass-token-abc123';
    expect(getInternalApiHeaders()).toEqual({
      'x-internal-token': 'cdn-bypass-token-abc123',
    });
  });

  it('trims surrounding whitespace from the token value', () => {
    process.env.INTERNAL_API_TOKEN = '\n  cdn-bypass-token-abc123  \n';
    expect(getInternalApiHeaders()).toEqual({
      'x-internal-token': 'cdn-bypass-token-abc123',
    });
  });

  it('does NOT read from NEXT_PUBLIC_INTERNAL_API_TOKEN (would leak to browser)', () => {
    process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN = 'leaked-to-browser';
    delete process.env.INTERNAL_API_TOKEN;
    expect(getInternalApiHeaders()).toEqual({});
    delete process.env.NEXT_PUBLIC_INTERNAL_API_TOKEN;
  });

  it('returns a fresh object each call (no cross-call mutation hazard)', () => {
    process.env.INTERNAL_API_TOKEN = 'tok';
    const first = getInternalApiHeaders();
    const second = getInternalApiHeaders();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
