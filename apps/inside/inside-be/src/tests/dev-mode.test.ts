import { describe, expect, test } from 'bun:test';
import {
  assertBypassNotProduction,
  InsecureConfigurationError,
  isDevMode,
  isProduction,
  shouldExposeDevLink,
} from '../services/dev-mode';

/**
 * Exposing a sign-in link is a complete authentication bypass, so the decision
 * is tested against the FULL truth table rather than the one path we happen to
 * run locally. Every production row must be false. No combination of flags may
 * reach the permissive branch.
 */
const ENVS = ['production', 'development', 'test', undefined, '', 'Production'];
const BOOLS = [true, false];

describe('shouldExposeDevLink — production is never permissive', () => {
  for (const bypassFlag of BOOLS) {
    for (const emailConfigured of BOOLS) {
      test(`production + bypass=${bypassFlag} + email=${emailConfigured} -> false`, () => {
        expect(
          shouldExposeDevLink({
            nodeEnv: 'production',
            bypassFlag,
            emailConfigured,
          }),
        ).toBe(false);
      });
    }
  }

  test('no environment value other than exact "production" is trusted to be safe', () => {
    // 'Production' is NOT production — the check is exact, so a typo in a
    // deploy config fails open to dev rather than silently half-enabling.
    // This is why the boot guard and the secrets guard both exist as well.
    expect(isProduction('Production')).toBe(false);
    expect(isProduction('production')).toBe(true);
  });
});

describe('shouldExposeDevLink — outside production', () => {
  const cases: Array<[boolean, boolean, boolean]> = [
    // bypassFlag, emailConfigured, expected
    [true, true, true], // operator explicitly asked
    [true, false, true], // asked, and email is unusable anyway
    [false, false, true], // no email configured: the alternative is a 502
    [false, true, false], // email works and nobody asked — send a real email
  ];

  for (const env of ENVS.filter((e) => e !== 'production')) {
    for (const [bypassFlag, emailConfigured, expected] of cases) {
      test(`env=${String(env)} bypass=${bypassFlag} email=${emailConfigured} -> ${expected}`, () => {
        expect(
          shouldExposeDevLink({ nodeEnv: env, bypassFlag, emailConfigured }),
        ).toBe(expected);
      });
    }
  }
});

describe('assertBypassNotProduction', () => {
  test('throws when the bypass is set in production', () => {
    expect(() =>
      assertBypassNotProduction({
        nodeEnv: 'production',
        bypassFlag: true,
      }),
    ).toThrow(InsecureConfigurationError);
  });

  test('allows production without the bypass', () => {
    expect(() =>
      assertBypassNotProduction({ nodeEnv: 'production', bypassFlag: false }),
    ).not.toThrow();
  });

  test('allows the bypass outside production', () => {
    for (const nodeEnv of ENVS.filter((e) => e !== 'production')) {
      expect(() =>
        assertBypassNotProduction({ nodeEnv, bypassFlag: true }),
      ).not.toThrow();
    }
  });
});

describe('isDevMode', () => {
  test('is false only in production', () => {
    expect(isDevMode('production')).toBe(false);
    for (const env of ENVS.filter((e) => e !== 'production')) {
      expect(isDevMode(env)).toBe(true);
    }
  });
});
