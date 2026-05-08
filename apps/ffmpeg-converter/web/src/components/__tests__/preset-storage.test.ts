/**
 * SEAN-94 — saved preset library backed by localStorage.
 *
 * Three invariants this test guards:
 *   1. Per-operation isolation. A preset saved on the gif page MUST NOT
 *      leak into the convert page's preset list. The shape of
 *      `storageKeyFor` ensures this — but the suite asserts the round-trip
 *      explicitly so a future refactor can't quietly introduce a global
 *      key.
 *   2. Round-trip integrity. `savePreset` → `loadPresets` returns the
 *      saved record byte-for-byte; reload-survives-restart is modelled by
 *      throwing away the in-memory `localStorage` shim and instantiating a
 *      fresh one (the AC test from the ticket body).
 *   3. Defensive parsing. A malformed JSON blob in storage, an unknown
 *      shape, or a hostile non-array value must produce `[]` (never
 *      throw) so the chip rendering pipeline keeps working when storage
 *      gets wedged.
 *
 * No JSDOM — we install a minimal in-memory `localStorage` shim on the
 * Node global so the SSR-safety guard in preset-storage (`typeof window`)
 * sees a window object. This matches the rest of the suite's no-React
 * approach (see ResultBlock.test.ts for the same pattern).
 *
 * Test runner: `node --test` via ts-node.
 */

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

// ─────────────────────────────────────────────────────── SHIM ────────────────

/**
 * Minimal in-memory `Storage` polyfill. Only implements the surface
 * preset-storage actually touches (`getItem`, `setItem`, `removeItem`).
 * The `quotaExceeded` flag lets a single test simulate Safari-private-mode
 * behaviour without monkey-patching the global mid-flight.
 */
class FakeStorage {
  private map = new Map<string, string>();
  quotaExceeded = false;
  throwOnRead = false;

  getItem(key: string): string | null {
    if (this.throwOnRead) {
      throw new Error('storage disabled');
    }
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.quotaExceeded) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  /** Test-only helper to seed an arbitrary string at a key. */
  rawSet(key: string, value: string): void {
    this.map.set(key, value);
  }

  /** Test-only helper to peek at the underlying map. */
  rawGet(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
}

/**
 * Install a fresh `window.localStorage` on the Node global. Returns the
 * shim so tests can flip the quota / throw flags or peek at raw values.
 */
function installFakeStorage(): FakeStorage {
  const fake = new FakeStorage();
  // The fake `window` is intentionally minimal — preset-storage only
  // touches `window.localStorage`. Casting to unknown lets us assign onto
  // the Node global without dragging in `@types/dom`.
  (
    globalThis as unknown as {
      window: { localStorage: FakeStorage };
    }
  ).window = { localStorage: fake };
  return fake;
}

/** Tear down the shim so unrelated tests don't see a leaked `window`. */
function uninstallFakeStorage(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

// The shim must be installed BEFORE preset-storage is required, because
// the module's `safeRead` / `safeWrite` close over `typeof window` at call
// time (not at import) — but we import lazily inside `beforeEach` to
// guarantee a clean slate per test.
let mod: typeof import('../preset-storage');

beforeEach(() => {
  installFakeStorage();
  // Force a fresh module require so any internal caching (there is none
  // today, but defence in depth) doesn't bleed between tests.
  delete require.cache[require.resolve('../preset-storage')];
  mod = require('../preset-storage') as typeof import('../preset-storage');
});

afterEach(() => {
  uninstallFakeStorage();
});

// ─────────────────────────────────────────────────────── KEY SHAPE ───────────

describe('SEAN-94 preset-storage — key shape', () => {
  it('uses a per-operation key prefix', () => {
    assert.equal(mod.storageKeyFor('gif'), 'converter.presets.gif');
    assert.equal(mod.storageKeyFor('convert'), 'converter.presets.convert');
    assert.equal(
      mod.storageKeyFor('extract-audio'),
      'converter.presets.extract-audio',
    );
  });

  it('exports the prefix constant for tests / clean-up tooling', () => {
    assert.equal(mod.STORAGE_KEY_PREFIX, 'converter.presets.');
  });
});

// ─────────────────────────────────────────────────────── ROUND-TRIP ──────────

describe('SEAN-94 preset-storage — save / load round-trip', () => {
  it('saves a preset and reads it back unchanged', () => {
    const preset = {
      id: 'p1',
      name: 'Discord webm',
      args: { crf: '28', resolution: '720p' },
      createdAt: 1_700_000_000_000,
    };
    assert.equal(mod.savePreset('convert', preset), true);

    const loaded = mod.loadPresets('convert');
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], preset);
  });

  it('returns [] when the key has never been written', () => {
    assert.deepEqual(mod.loadPresets('gif'), []);
  });

  it('preserves save order across multiple saves', () => {
    mod.savePreset('gif', {
      id: 'a',
      name: 'first',
      args: { fps: '10' },
      createdAt: 1,
    });
    mod.savePreset('gif', {
      id: 'b',
      name: 'second',
      args: { fps: '24' },
      createdAt: 2,
    });
    mod.savePreset('gif', {
      id: 'c',
      name: 'third',
      args: { fps: '30' },
      createdAt: 3,
    });
    const loaded = mod.loadPresets('gif');
    assert.deepEqual(
      loaded.map((p) => p.id),
      ['a', 'b', 'c'],
    );
  });

  it('survives a "browser restart" (fresh module + same storage backing)', () => {
    // Save under one require of the module.
    mod.savePreset('convert', {
      id: 'survives',
      name: 'Discord webm',
      args: { crf: '28' },
      createdAt: 1,
    });
    // Simulate the next page load: re-require the module without
    // resetting the underlying storage. The preset must reappear because
    // localStorage is the source of truth, not module-local state.
    delete require.cache[require.resolve('../preset-storage')];
    const reloaded =
      require('../preset-storage') as typeof import('../preset-storage');
    const presets = reloaded.loadPresets('convert');
    assert.equal(presets.length, 1);
    assert.equal(presets[0]?.id, 'survives');
    assert.equal(presets[0]?.args.crf, '28');
  });
});

// ─────────────────────────────────────────────────────── ISOLATION ───────────

describe('SEAN-94 preset-storage — per-operation isolation', () => {
  it('a webm preset on convert does not leak into the gif page list', () => {
    mod.savePreset('convert', {
      id: 'webm',
      name: 'Discord webm',
      args: { crf: '28' },
      createdAt: 1,
    });
    assert.equal(mod.loadPresets('gif').length, 0);
    assert.equal(mod.loadPresets('convert').length, 1);
  });

  it('deletes are scoped to the operation', () => {
    mod.savePreset('convert', {
      id: 'shared',
      name: 'a',
      args: {},
      createdAt: 1,
    });
    mod.savePreset('gif', {
      id: 'shared',
      name: 'b',
      args: {},
      createdAt: 2,
    });
    // Same id under different operations — deleting from gif must not
    // touch convert.
    mod.deletePreset('gif', 'shared');
    assert.equal(mod.loadPresets('gif').length, 0);
    assert.equal(mod.loadPresets('convert').length, 1);
  });
});

// ─────────────────────────────────────────────────────── DELETE ──────────────

describe('SEAN-94 preset-storage — deletePreset', () => {
  it('removes the matching preset and leaves the rest in order', () => {
    for (const id of ['a', 'b', 'c']) {
      mod.savePreset('gif', { id, name: id, args: {}, createdAt: 0 });
    }
    assert.equal(mod.deletePreset('gif', 'b'), true);
    assert.deepEqual(
      mod.loadPresets('gif').map((p) => p.id),
      ['a', 'c'],
    );
  });

  it('returns false when the id is not present', () => {
    mod.savePreset('gif', { id: 'a', name: 'a', args: {}, createdAt: 0 });
    assert.equal(mod.deletePreset('gif', 'missing'), false);
    assert.equal(mod.loadPresets('gif').length, 1);
  });
});

// ─────────────────────────────────────────────────────── ID COLLISION ────────

describe('SEAN-94 preset-storage — id collision = overwrite-in-place', () => {
  it('saving with an existing id replaces that entry, not duplicates', () => {
    mod.savePreset('gif', {
      id: 'p1',
      name: 'first label',
      args: { fps: '10' },
      createdAt: 1,
    });
    mod.savePreset('gif', {
      id: 'p1',
      name: 'updated label',
      args: { fps: '24', width: '320' },
      createdAt: 2,
    });
    const presets = mod.loadPresets('gif');
    assert.equal(presets.length, 1);
    assert.equal(presets[0]?.name, 'updated label');
    assert.equal(presets[0]?.args.fps, '24');
    assert.equal(presets[0]?.args.width, '320');
  });
});

// ─────────────────────────────────────────────────────── DEFENSIVE PARSE ─────

describe('SEAN-94 preset-storage — defensive parsing', () => {
  it('returns [] when the stored JSON is malformed', () => {
    installFakeStorage(); // re-install to grab the reference
    const win = (
      globalThis as unknown as {
        window: { localStorage: FakeStorage };
      }
    ).window;
    win.localStorage.rawSet('converter.presets.gif', 'not-json{{{');
    assert.deepEqual(mod.loadPresets('gif'), []);
  });

  it('returns [] when the JSON parses but is not an array', () => {
    const win = (
      globalThis as unknown as {
        window: { localStorage: FakeStorage };
      }
    ).window;
    win.localStorage.rawSet(
      'converter.presets.gif',
      JSON.stringify({ id: 'oops' }),
    );
    assert.deepEqual(mod.loadPresets('gif'), []);
  });

  it('drops individual records whose shape is invalid, keeping the rest', () => {
    const win = (
      globalThis as unknown as {
        window: { localStorage: FakeStorage };
      }
    ).window;
    win.localStorage.rawSet(
      'converter.presets.gif',
      JSON.stringify([
        { id: 'good', name: 'ok', args: { fps: '24' }, createdAt: 0 },
        { id: 'bad-no-name', args: {}, createdAt: 0 },
        { id: 'bad-args-not-object', name: 'x', args: 'oops', createdAt: 0 },
        null,
        'string-not-object',
      ]),
    );
    const loaded = mod.loadPresets('gif');
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.id, 'good');
  });

  it('returns [] when localStorage.getItem throws (storage disabled)', () => {
    const win = (
      globalThis as unknown as {
        window: { localStorage: FakeStorage };
      }
    ).window;
    win.localStorage.throwOnRead = true;
    assert.deepEqual(mod.loadPresets('gif'), []);
  });
});

// ─────────────────────────────────────────────────────── QUOTA FALLBACK ──────

describe('SEAN-94 preset-storage — quota fallback', () => {
  it('returns false from savePreset when storage throws QuotaExceededError', () => {
    const win = (
      globalThis as unknown as {
        window: { localStorage: FakeStorage };
      }
    ).window;
    win.localStorage.quotaExceeded = true;
    const ok = mod.savePreset('gif', {
      id: 'p1',
      name: 'too big',
      args: {},
      createdAt: 0,
    });
    assert.equal(ok, false);
  });

  it('does NOT throw — callers can ignore the return value safely', () => {
    const win = (
      globalThis as unknown as {
        window: { localStorage: FakeStorage };
      }
    ).window;
    win.localStorage.quotaExceeded = true;
    assert.doesNotThrow(() => {
      mod.savePreset('gif', { id: 'p', name: 'x', args: {}, createdAt: 0 });
    });
  });
});

// ─────────────────────────────────────────────────────── EXPORT / IMPORT ─────

describe('SEAN-94 preset-storage — export JSON', () => {
  it('produces a versioned envelope with only non-empty operations', () => {
    mod.savePreset('gif', {
      id: 'g1',
      name: 'Twitter gif',
      args: { fps: '24', width: '320' },
      createdAt: 1,
    });
    mod.savePreset('convert', {
      id: 'c1',
      name: 'Discord webm',
      args: { crf: '28' },
      createdAt: 2,
    });
    // Operations with no presets must NOT appear in the envelope.
    const payload = mod.buildExportPayload(999);
    assert.equal(payload.version, mod.SCHEMA_VERSION);
    assert.equal(payload.exportedAt, 999);
    assert.ok(payload.presetsByOperation.gif);
    assert.ok(payload.presetsByOperation.convert);
    assert.equal(payload.presetsByOperation.trim, undefined);
    assert.equal(payload.presetsByOperation.gif?.length, 1);
  });

  it('exportPresetsAsJson is pretty-printed valid JSON', () => {
    mod.savePreset('gif', {
      id: 'g1',
      name: 'a',
      args: { fps: '10' },
      createdAt: 1,
    });
    const json = mod.exportPresetsAsJson(0);
    // Parses cleanly back into an export payload.
    const reparsed = JSON.parse(json);
    assert.ok(mod.isExportPayload(reparsed));
    // Pretty-print produces newlines so a user can read the file.
    assert.match(json, /\n/);
  });
});

describe('SEAN-94 preset-storage — importPresets', () => {
  it('merges a clean export payload into empty storage', () => {
    const payload = {
      version: mod.SCHEMA_VERSION,
      exportedAt: 0,
      presetsByOperation: {
        gif: [
          { id: 'g1', name: 'Twitter gif', args: { fps: '24' }, createdAt: 1 },
        ],
        convert: [
          { id: 'c1', name: 'Discord webm', args: { crf: '28' }, createdAt: 2 },
        ],
      },
    };
    const result = mod.importPresets(JSON.stringify(payload));
    assert.equal(result.ok, true);
    assert.equal(result.addedByOperation?.gif, 1);
    assert.equal(result.addedByOperation?.convert, 1);
    assert.equal(mod.loadPresets('gif').length, 1);
    assert.equal(mod.loadPresets('convert').length, 1);
  });

  it('overwrites existing presets with the same id (re-import is idempotent)', () => {
    mod.savePreset('gif', {
      id: 'g1',
      name: 'old name',
      args: { fps: '10' },
      createdAt: 1,
    });
    const payload = {
      version: mod.SCHEMA_VERSION,
      exportedAt: 0,
      presetsByOperation: {
        gif: [
          {
            id: 'g1',
            name: 'new name',
            args: { fps: '24' },
            createdAt: 2,
          },
        ],
      },
    };
    const result = mod.importPresets(JSON.stringify(payload));
    assert.equal(result.ok, true);
    assert.equal(
      result.addedByOperation?.gif,
      0,
      'overwrite must count as 0 added',
    );
    const presets = mod.loadPresets('gif');
    assert.equal(presets.length, 1);
    assert.equal(presets[0]?.name, 'new name');
    assert.equal(presets[0]?.args.fps, '24');
  });

  it('does NOT wipe other operations on partial import', () => {
    mod.savePreset('convert', {
      id: 'keep',
      name: 'keep me',
      args: { crf: '20' },
      createdAt: 1,
    });
    const payload = {
      version: mod.SCHEMA_VERSION,
      exportedAt: 0,
      presetsByOperation: {
        gif: [{ id: 'g1', name: 'a', args: { fps: '10' }, createdAt: 1 }],
      },
    };
    mod.importPresets(JSON.stringify(payload));
    assert.equal(mod.loadPresets('convert').length, 1);
    assert.equal(mod.loadPresets('convert')[0]?.id, 'keep');
  });

  it('rejects malformed JSON with reason: invalid-json', () => {
    const result = mod.importPresets('not-json{{{');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-json');
  });

  it('rejects payloads with the wrong shape with reason: invalid-shape', () => {
    const result = mod.importPresets(JSON.stringify({ hello: 'world' }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-shape');
  });

  it('rejects future schema versions with reason: unsupported-version', () => {
    const result = mod.importPresets(
      JSON.stringify({
        version: mod.SCHEMA_VERSION + 1,
        exportedAt: 0,
        presetsByOperation: {},
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported-version');
  });
});

// ─────────────────────────────────────────────────────── newPresetId ─────────

describe('SEAN-94 preset-storage — newPresetId', () => {
  it('produces a non-empty string', () => {
    const id = mod.newPresetId();
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0);
  });

  it('produces unique ids across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      ids.add(mod.newPresetId());
    }
    assert.equal(ids.size, 100);
  });
});

// ─────────────────────────────────────────────────────── clearAllPresets ─────

describe('SEAN-94 preset-storage — clearAllPresets', () => {
  it('removes every operation key', () => {
    mod.savePreset('gif', { id: 'g', name: 'g', args: {}, createdAt: 0 });
    mod.savePreset('convert', { id: 'c', name: 'c', args: {}, createdAt: 0 });
    mod.clearAllPresets();
    assert.deepEqual(mod.loadPresets('gif'), []);
    assert.deepEqual(mod.loadPresets('convert'), []);
  });
});
