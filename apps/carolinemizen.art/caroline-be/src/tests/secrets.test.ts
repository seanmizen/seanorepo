import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { DEV_SECRETS, requireSecret } from '../services/secrets';

describe('requireSecret', () => {
  for (const name of ['JWT_SECRET', 'COOKIE_SECRET'] as const) {
    test(`${name}: production refuses an unset value and the dev default`, () => {
      for (const value of [undefined, '', DEV_SECRETS[name]]) {
        expect(() =>
          requireSecret(name, { NODE_ENV: 'production', [name]: value }),
        ).toThrow(`${name} must be set to a non-default value`);
      }
    });

    test(`${name}: production accepts a real value`, () => {
      expect(
        requireSecret(name, { NODE_ENV: 'production', [name]: 'a-real-key' }),
      ).toBe('a-real-key');
    });

    test(`${name}: outside production, unset gives the dev default`, () => {
      for (const nodeEnv of [undefined, 'development', 'test']) {
        expect(requireSecret(name, { NODE_ENV: nodeEnv })).toBe(
          DEV_SECRETS[name],
        );
      }
    });
  }

  test('caroline-be stops at startup in production with the dev secrets', () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '0',
    };
    delete env.JWT_SECRET;
    delete env.COOKIE_SECRET;
    const run = Bun.spawnSync(
      ['bun', path.join(import.meta.dir, '..', 'index.ts')],
      { env, timeout: 15_000 },
    );
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString()).toContain(
      'JWT_SECRET must be set to a non-default value',
    );
  });
});
