import { describe, expect, test } from 'bun:test';
import { corsOriginWarning } from '../services/cors-origin';

describe('corsOriginWarning', () => {
  test('warns for a local host in production', () => {
    expect(corsOriginWarning('production', 'http://localhost:4020')).toContain(
      'http://localhost:4020',
    );
    expect(corsOriginWarning('production', 'http://127.0.0.1')).not.toBeNull();
    expect(corsOriginWarning('production', 'http://[::1]:4020')).not.toBeNull();
  });

  test('warns for a value that is not a URL in production', () => {
    expect(corsOriginWarning('production', 'carolinemizen.art')).toContain(
      'not a URL',
    );
  });

  test('accepts the site origin in production', () => {
    expect(
      corsOriginWarning('production', 'https://carolinemizen.art'),
    ).toBeNull();
  });

  test('accepts localhost outside production', () => {
    expect(
      corsOriginWarning('development', 'http://localhost:4020'),
    ).toBeNull();
    expect(corsOriginWarning(undefined, 'http://localhost:4020')).toBeNull();
  });
});
