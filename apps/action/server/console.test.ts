// Where: apps/action/server/console.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: the server half of the console: the grammar cases that the Zig
// client also runs, the cvar limits and text forms, the server cvar file,
// the config file and the environment variables.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyEnv,
  type CvarDef,
  Cvars,
  formatValue,
  loadDefs,
  parseValue,
  readDefs,
  ServerConsole,
  splitCommands,
  tokenize,
} from './console';

const GAME_SRC = join(import.meta.dir, '../game/src');

const def = (more: Partial<CvarDef>): CvarDef => ({
  name: 'x',
  type: 'float',
  default: 1,
  flags: [],
  description: 'd',
  reader: 'r',
  ...more,
});

describe('grammar', () => {
  test('the shared cases (game/src/console/parse_cases.json)', () => {
    const file = JSON.parse(
      readFileSync(join(GAME_SRC, 'console/parse_cases.json'), 'utf8'),
    ) as { cases: { src: string; commands: string[][] }[] };
    expect(file.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of file.cases) {
      const got = splitCommands(c.src).map((cmd) => tokenize(cmd.text));
      expect({ src: c.src, got }).toEqual({ src: c.src, got: c.commands });
    }
  });

  test('line numbers', () => {
    expect(splitCommands('a\n// c\nb; c').map((c) => c.line)).toEqual([
      1, 3, 3,
    ]);
  });
});

describe('values', () => {
  test('limits clamp, bad text fails', () => {
    const fov = def({ default: 74, min: 60, max: 100 });
    expect(parseValue(fov, '200')).toEqual({ value: 100, clamped: true });
    expect(parseValue(fov, '59.5')).toEqual({ value: 60, clamped: true });
    expect(parseValue(fov, 'wide')).toBeNull();
    expect(parseValue(fov, 'Infinity')).toBeNull();
    expect(parseValue(fov, '')).toBeNull();
    const n = def({ type: 'int', default: 5, min: 1, max: 10 });
    expect(parseValue(n, '-4')).toEqual({ value: 1, clamped: true });
    expect(parseValue(n, '2.5')).toBeNull();
    const b = def({ type: 'bool', default: false });
    expect(parseValue(b, 'On')?.value).toBe(true);
    expect(parseValue(b, '0')?.value).toBe(false);
    expect(parseValue(b, '2')).toBeNull();
    const s = def({ type: 'string', default: '' });
    expect(parseValue(s, 'a"b')).toBeNull();
    const long = parseValue(s, 'é'.repeat(150));
    expect(long?.clamped).toBe(true);
    expect(new TextEncoder().encode(String(long?.value)).length).toBe(200);
  });

  test('the text form is the same as the client (cvar.zig format)', () => {
    expect(formatValue(0.1 + 0.2)).toBe('0.3');
    expect(formatValue(74)).toBe('74');
    expect(formatValue(-1)).toBe('-1');
    expect(formatValue(-0.00001)).toBe('0');
    expect(formatValue(true)).toBe('1');
  });

  test('bad definitions throw', () => {
    const one = (raw: object) => () => loadDefs({ cvars: [raw] });
    const ok = {
      name: 'x',
      type: 'int',
      default: 1,
      description: 'd',
      reader: 'r',
    };
    expect(one(ok)).not.toThrow();
    expect(one({ ...ok, default: 1.5 })).toThrow();
    expect(one({ ...ok, max: 0 })).toThrow();
    expect(one({ ...ok, flags: ['loud'] })).toThrow();
    expect(one({ ...ok, name: 'Bad' })).toThrow();
    expect(one({ ...ok, reader: '' })).toThrow();
  });
});

describe('the server cvar file', () => {
  const defs = readDefs(join(GAME_SRC, 'server_cvars.json'));

  test('every cvar is a server cvar, the defaults are safe', () => {
    const cv = new Cvars(defs);
    for (const d of defs) expect(d.flags).toContain('server');
    // Unset: bodies never despawn. Remote admin is off.
    expect(cv.number('despawn_cadaver_timer')).toBeLessThan(0);
    expect(cv.string('admin_password')).toBe('');
    expect(cv.number('match_seconds')).toBe(300);
  });

  test('a protected cvar never goes to a client', () => {
    const cv = new Cvars(defs);
    cv.set('admin_password', 'hunter2');
    expect(cv.publicPairs().map((p) => p[0])).not.toContain('admin_password');
    expect(cv.text('admin_password')).toBe('(hidden)');
    expect(cv.publicPairs()).toContainEqual(['despawn_cadaver_timer', '-1']);
  });

  test('the config script, then the environment', () => {
    const cv = new Cvars(defs);
    const con = new ServerConsole(cv);
    const out: string[] = [];
    con.exec(
      [
        '// a comment',
        'set match_seconds 600',
        'end_seconds 999 // clamps to 120',
        'set despawn_cadaver_timer 30',
        'bogus 1',
      ].join('\n'),
      (l) => out.push(l),
      'server.cfg',
    );
    expect(cv.number('match_seconds')).toBe(600);
    expect(cv.number('end_seconds')).toBe(120);
    expect(out).toEqual([
      'server.cfg:3: end_seconds = 120 ("999" is out of the limits)',
      'server.cfg:5: unknown command or cvar "bogus". Type: help',
    ]);
    const changes: string[] = [];
    cv.onChange((d, text) => changes.push(`${d.name}=${text}`));
    applyEnv(
      cv,
      {
        SV_MATCH_SECONDS: '120',
        SV_DESPAWN_CADAVER_TIMER: '',
        SV_END_SECONDS: 'soon',
      },
      (l) => out.push(l),
    );
    expect(cv.number('match_seconds')).toBe(120);
    // An empty variable is unset: the config value stays.
    expect(cv.number('despawn_cadaver_timer')).toBe(30);
    expect(out.at(-1)).toContain('SV_END_SECONDS');
    expect(changes).toEqual(['match_seconds=120']);
  });
});
