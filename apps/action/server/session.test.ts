// Where: apps/action/server/session.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: the parts of session.ts: the build file and its fallback, the
// protocol file, the instance id, the /api/version answer, the welcome
// and the bye. lobby.test.ts runs them in the real server.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILD_FILE,
  BUILD_HEADER,
  BYE_CODE,
  bye,
  DEV_BUILD,
  newIdent,
  readBuild,
  readProtocol,
  versionResponse,
  welcome,
} from './session';

const dir = mkdtempSync(join(tmpdir(), 'action-session-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the build version', () => {
  test('no build file: the dev fallback', () => {
    expect(readBuild(join(dir, 'none'))).toBe(DEV_BUILD);
  });

  test('the file of build.sh: one line', () => {
    writeFileSync(join(dir, BUILD_FILE), '0a3765aeb1e8-dirty\n');
    expect(readBuild(dir)).toBe('0a3765aeb1e8-dirty');
  });

  test('a bad value stops the start', () => {
    writeFileSync(join(dir, BUILD_FILE), 'two words\n');
    expect(() => readBuild(dir)).toThrow('is not valid');
    writeFileSync(join(dir, BUILD_FILE), '\n');
    expect(() => readBuild(dir)).toThrow('is not valid');
  });
});

describe('the protocol version', () => {
  test('the file of the game: a whole number of 1 or more', () => {
    const n = readProtocol(
      join(import.meta.dir, '../game/src/protocol_version.txt'),
    );
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  test('a bad file stops the start', () => {
    const file = join(dir, 'protocol.txt');
    for (const text of ['0', '-1', '1.5', 'one', '', '2 3']) {
      writeFileSync(file, `${text}\n`);
      expect(() => readProtocol(file)).toThrow('is not valid');
    }
    writeFileSync(file, ' 7 \n');
    expect(readProtocol(file)).toBe(7);
  });
});

describe('the identity', () => {
  test('a new instance id at each start, the same build', () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const a = newIdent('abc', 1, now);
    const b = newIdent('abc', 1, now);
    expect(a.instance).toMatch(/^[0-9a-f]{16}$/);
    expect(a.instance).not.toBe(b.instance);
    expect(a).toEqual({ ...b, instance: a.instance });
    expect(a.started).toBe('2026-10-23T10:00:00.000Z');
  });

  test('GET /api/version: the fields, no cache, the build header', async () => {
    const id = newIdent('abc', 2, new Date());
    const res = versionResponse(id);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get(BUILD_HEADER)).toBe('abc');
    expect(await res.json()).toEqual(id);
  });

  test('the welcome: the same fields, and the player id', () => {
    const id = newIdent('abc', 2, new Date());
    expect(JSON.parse(welcome(id, { id: 7 }))).toEqual({
      t: 'welcome',
      id: 7,
      ...id,
    });
  });

  test('the bye comes before the close', () => {
    const calls: string[] = [];
    bye(
      {
        send: (text) => calls.push(`send ${text}`),
        close: (code, reason) => calls.push(`close ${code} ${reason}`),
      },
      'Going.',
    );
    expect(calls).toEqual([
      'send {"t":"bye","reason":"Going."}',
      `close ${BYE_CODE} Going.`,
    ]);
  });
});
