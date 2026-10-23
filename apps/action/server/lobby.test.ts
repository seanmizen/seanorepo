// Where: apps/action/server/lobby.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: runs the real server (index.ts) on a free port and talks to it over
// the WebSocket: the server cvars on join, the config file, rcon off with
// no admin_password, a client cannot change a server cvar, an rcon set
// goes to every player, the chat relay with the server lines, and the
// session: GET /api/version, the welcome before the hello, the bye on
// SIGTERM, and a restart with a new build on the same port.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { BUILD_FILE, BUILD_HEADER, readProtocol, STOP_REASON } from './session';

type Msg = Record<string, unknown> & { t: string };

const procs: Subprocess[] = [];
const dir = mkdtempSync(join(tmpdir(), 'action-lobby-'));

afterAll(() => {
  for (const p of procs) p.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** Start the server with a config file and the SV_ environment. Returns
 * its port. */
async function start(
  config: string,
  env: Record<string, string>,
): Promise<number> {
  return (await startProc(config, env)).port;
}

/** start, and the process too. */
async function startProc(
  config: string,
  env: Record<string, string>,
): Promise<{ port: number; proc: Subprocess }> {
  const cfg = join(dir, `server-${procs.length}.cfg`);
  writeFileSync(cfg, config);
  const proc = Bun.spawn(['bun', join(import.meta.dir, 'index.ts')], {
    env: {
      ...process.env,
      PORT: '0',
      SERVER_CONFIG: cfg,
      SV_ADMIN_PASSWORD: '',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  procs.push(proc);
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the server stopped: ${text}`);
    text += decoder.decode(value);
    const m = text.match(/localhost:(\d+)/);
    if (m) {
      // Keep the pipe empty.
      (async () => {
        while (!(await reader.read()).done) {}
      })();
      return { port: Number(m[1]), proc };
    }
  }
}

class Client {
  readonly msgs: Msg[] = [];
  closed = false;
  private readonly ws: WebSocket;
  private readonly opened: Promise<void>;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/api/ws`);
    this.opened = new Promise((ok) => {
      this.ws.onopen = () => ok();
    });
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(String(e.data)));
    this.ws.onclose = () => {
      this.closed = true;
    };
  }

  async send(msg: object): Promise<void> {
    await this.opened;
    this.ws.send(JSON.stringify(msg));
  }

  /** Wait for the first message after `from` that `pred` accepts. */
  async next(pred: (m: Msg) => boolean, from = 0): Promise<Msg> {
    for (let i = 0; i < 200; i++) {
      const m = this.msgs.slice(from).find(pred);
      if (m) return m;
      await Bun.sleep(10);
    }
    throw new Error('no such message');
  }

  async print(from: number): Promise<string> {
    return String((await this.next((m) => m.t === 'print', from)).text);
  }

  close(): void {
    this.ws.close();
  }
}

const hello = { t: 'hello', name: 'Tester', p: [0, 0], s: [6, 23] };
const cvarsOf = (m: Msg) => Object.fromEntries(m.cv as [string, string][]);

describe('lobby with no admin_password', () => {
  test('cvars on join, rcon is off', async () => {
    const port = await start('set despawn_cadaver_timer 45\n', {});
    const c = new Client(port);
    await c.send(hello);
    const cv = cvarsOf(await c.next((m) => m.t === 'cvars'));
    expect(cv.despawn_cadaver_timer).toBe('45');
    expect(cv.match_seconds).toBe('300');
    expect('admin_password' in cv).toBe(false);
    const n = c.msgs.length;
    await c.send({ t: 'rcon', pw: '', cmd: 'set match_seconds 20' });
    expect(await c.print(n)).toContain('rcon is off');
    c.close();
  });
});

describe('lobby with an admin_password', () => {
  test('a client cannot change a server cvar, rcon can', async () => {
    const port = await start('', {
      SV_ADMIN_PASSWORD: 'correct horse',
      SV_MATCH_SECONDS: '600',
    });
    const admin = new Client(port);
    const other = new Client(port);
    await admin.send(hello);
    await other.send(hello);
    const cv = cvarsOf(await other.next((m) => m.t === 'cvars'));
    expect(cv.match_seconds).toBe('600');

    // A client message cannot set a cvar.
    await other.send({ t: 'cvars', cv: [['despawn_cadaver_timer', '1']] });
    await other.send({ t: 'set', name: 'despawn_cadaver_timer', value: '1' });
    let n = admin.msgs.length;
    await admin.send({
      t: 'rcon',
      pw: 'correct horse',
      cmd: 'despawn_cadaver_timer',
    });
    expect(await admin.print(n)).toStartWith('despawn_cadaver_timer = -1');

    n = admin.msgs.length;
    await admin.send({
      t: 'rcon',
      pw: 'wrong',
      cmd: 'set despawn_cadaver_timer 5',
    });
    expect(await admin.print(n)).toBe('rcon: bad password');

    // An rcon set: the answer, and every player gets the new value.
    n = admin.msgs.length;
    const m = other.msgs.length;
    await admin.send({
      t: 'rcon',
      pw: 'correct horse',
      cmd: 'set despawn_cadaver_timer 30',
    });
    expect(await admin.print(n)).toBe('despawn_cadaver_timer = 30');
    const change = await other.next((x) => x.t === 'cvars', m);
    expect(change.cv).toEqual([['despawn_cadaver_timer', '30']]);

    // The password never goes to a player.
    n = admin.msgs.length;
    await admin.send({
      t: 'rcon',
      pw: 'correct horse',
      cmd: 'set admin_password other; cvarlist admin',
    });
    expect(await admin.print(n)).toBe('admin_password = (hidden)');
    await Bun.sleep(100);
    const leaked = other.msgs.some((x) => JSON.stringify(x).includes('other'));
    expect(leaked).toBe(false);
    admin.close();
    other.close();
  });

  test('too many bad passwords close the connection', async () => {
    const port = await start('', { SV_ADMIN_PASSWORD: 'pw' });
    const c = new Client(port);
    await c.send(hello);
    for (let i = 0; i < 5; i++)
      await c.send({ t: 'rcon', pw: 'x', cmd: 'status' });
    for (let i = 0; i < 100 && !c.closed; i++) await Bun.sleep(10);
    expect(c.closed).toBe(true);
  });
});

describe('chat', () => {
  test('the relay: clean, capped, rate limited, team to the sender only', async () => {
    const port = await start('', {
      SV_CHAT_MAX_LENGTH: '12',
      SV_CHAT_RATE_MESSAGES: '2',
      SV_CHAT_RATE_SECONDS: '60',
    });
    const chatOf = (m: Msg) => m.t === 'chat';
    const a = new Client(port);
    const b = new Client(port);
    await a.send({ ...hello, name: 'Alice' });
    // The welcome comes before the hello. The own join line comes after it.
    await a.next((m) => chatOf(m) && m.text === 'Alice joined.');
    let n = a.msgs.length;
    await b.send({ ...hello, name: 'Bob' });
    // A join is a server line for every player.
    const join = await a.next((m) => chatOf(m) && m.ch === 'server', n);
    expect(join.text).toBe('Bob joined.');
    const bid = (await b.next((m) => m.t === 'welcome')).id;

    // A message to all: cleaned and cut to chat_max_length bytes. The
    // sender gets it back.
    n = a.msgs.length;
    let m = b.msgs.length;
    await b.send({
      t: 'chat',
      ch: 'all',
      text: ' hi\u0007 \u202eall\nof you ',
    });
    const got = await a.next((x) => chatOf(x) && x.ch === 'all', n);
    expect(got).toEqual({
      t: 'chat',
      ch: 'all',
      id: bid,
      name: 'Bob',
      text: 'hi all of yo',
    });
    expect(await b.next((x) => chatOf(x) && x.ch === 'all', m)).toEqual(got);

    // A team message with no teams: the sender only.
    n = a.msgs.length;
    m = b.msgs.length;
    await b.send({ t: 'chat', ch: 'team', text: 'push B' });
    const team = await b.next((x) => chatOf(x) && x.ch === 'team', m);
    expect(team.text).toBe('push B');

    // The third message in the window is dropped, and the sender learns why.
    m = b.msgs.length;
    await b.send({ t: 'chat', ch: 'all', text: 'spam' });
    const slow = await b.next((x) => chatOf(x) && x.ch === 'server', m);
    expect(String(slow.text)).toStartWith('Too many messages. Wait ');

    // A client cannot send a server line. An empty message goes nowhere.
    await a.send({ t: 'chat', ch: 'server', text: 'I am the server' });
    await a.send({ t: 'chat', ch: 'all', text: ' \u200b ' });
    await Bun.sleep(150);
    const after = a.msgs.slice(n).filter(chatOf);
    expect(after).toEqual([]);

    // A leave is a server line.
    n = a.msgs.length;
    b.close();
    const left = await a.next((x) => chatOf(x) && x.ch === 'server', n);
    expect(left.text).toBe('Bob left.');
    a.close();
  });
});

describe('lifts', () => {
  test('the snapshot names the cab that a player stands in', async () => {
    const port = await start('', {});
    const a = new Client(port);
    const b = new Client(port);
    const aid = (await a.next((m) => m.t === 'welcome')).id;
    await a.send({ ...hello, name: 'Alice' });
    await a.next((m) => m.t === 'spawn');
    await b.send({ ...hello, name: 'Bob' });
    // The feet on the cab floor of the deep lift (lift 2) at the bottom.
    const st = { t: 'st', x: 63.6, y: -14.98, z: -22.8, yaw: 0, pitch: 0 };
    const liftIn = async (lift: unknown, want: number) => {
      const n = b.msgs.length;
      await a.send({ ...st, lift });
      await b.next(
        (m) =>
          m.t === 'snap' &&
          (m.players as Msg[]).some((p) => p.id === aid && p.lift === want),
        n,
      );
    };
    // Each bad value is -1: no field (an old client), no such lift, not a
    // whole number, not a number.
    for (const bad of [undefined, 3, 1.5, -2, 'x', '1', null]) {
      await liftIn(2, 2);
      await liftIn(bad, -1);
    }
    a.close();
    b.close();
  });
});

describe('gates and pigeons', () => {
  test('a gate goes to the other players; the flock comes on join', async () => {
    const port = await start('', {});
    const a = new Client(port);
    const b = new Client(port);
    const aid = (await a.next((m) => m.t === 'welcome')).id;
    await a.send({ ...hello, name: 'Alice' });
    await a.next((m) => m.t === 'spawn');
    await b.send({ ...hello, name: 'Bob' });
    // The join: the flock with its seed and its bodies.
    const flock = await b.next((m) => m.t === 'flock' && 'sd' in m);
    expect((flock.b as unknown[]).length).toBe(12);
    expect(flock.c).toEqual([]);
    await b.next((m) => m.t === 'spawn');

    // Bad lanes and kinds go nowhere. A good tap and a passage go to the
    // other players, not back to the sender.
    const n = b.msgs.length;
    const m = a.msgs.length;
    await a.send({ t: 'gate', k: 'open', i: 99 });
    await a.send({ t: 'gate', k: 'open', i: 1.5 });
    await a.send({ t: 'gate', k: 'shut', i: 2 });
    await a.send({ t: 'gate', k: 'open', i: 3 });
    await a.send({ t: 'gate', k: 'pass', i: 3 });
    const gate = (x: Msg) => x.t === 'gate';
    expect(await b.next(gate, n)).toEqual({
      t: 'gate',
      k: 'open',
      i: 3,
      id: aid,
    });
    await b.next((x) => gate(x) && x.k === 'pass', n);
    expect(b.msgs.slice(n).filter(gate).length).toBe(2);

    // A pigeon kill makes a body for the other players.
    await a.send({
      t: 'pg',
      k: 'die',
      i: 4,
      g: 0,
      o: [3, 11.6, -4],
      v: [0, 1, 0],
    });
    const kill = await b.next((x) => x.t === 'pg', n);
    expect(kill).toMatchObject({ k: 'die', i: 4, g: 0, id: aid });
    await Bun.sleep(50);
    expect(a.msgs.slice(m).some((x) => gate(x) || x.t === 'pg')).toBe(false);
    a.close();
    b.close();
  });
});

describe('the secret room', () => {
  test('GET MORE opens the door for the others and for a later join; MORE blesses', async () => {
    const port = await start('', {});
    const a = new Client(port);
    const b = new Client(port);
    const aid = (await a.next((m) => m.t === 'welcome')).id;
    await a.send({ ...hello, name: 'Alice' });
    await a.next((m) => m.t === 'spawn');
    await b.send({ ...hello, name: 'Bob' });
    await b.next((m) => m.t === 'spawn');

    // A bad kind goes nowhere. The first open goes to the other players,
    // not back to the sender. A second open goes nowhere.
    const n = b.msgs.length;
    const m = a.msgs.length;
    const more = (x: Msg) => x.t === 'more';
    await a.send({ t: 'more', k: 'shut' });
    await a.send({ t: 'more', k: 'bless' });
    await a.send({ t: 'more', k: 'open' });
    expect(await b.next(more, n)).toEqual({ t: 'more', k: 'open', id: aid });
    await b.send({ t: 'more', k: 'open' });
    await Bun.sleep(50);
    expect(b.msgs.slice(n).filter(more).length).toBe(1);
    expect(a.msgs.slice(m).some(more)).toBe(false);

    // A blessing goes to the others once the door is open.
    const k = b.msgs.length;
    await a.send({ t: 'more', k: 'bless' });
    expect(await b.next(more, k)).toEqual({ t: 'more', k: 'bless', id: aid });

    // A player who joins now finds the door open.
    const c = new Client(port);
    await c.send({ ...hello, name: 'Cat' });
    expect(await c.next(more)).toEqual({ t: 'more', k: 'now' });
    a.close();
    b.close();
    c.close();
  });
});

describe('the deep train', () => {
  test('the snapshot gives the place of a rider in the train', async () => {
    const port = await start('', {});
    const a = new Client(port);
    const b = new Client(port);
    const aid = (await a.next((m) => m.t === 'welcome')).id;
    await a.send({ ...hello, name: 'Alice' });
    await a.next((m) => m.t === 'spawn');
    await b.send({ ...hello, name: 'Bob' });
    const st = { t: 'st', x: 50, y: -14.98, z: -29, yaw: 0, pitch: 0 };
    const txIs = async (tx: unknown, want: number | undefined) => {
      const n = b.msgs.length;
      await a.send({ ...st, tx });
      await b.next(
        (m) =>
          m.t === 'snap' &&
          typeof m.tt === 'number' &&
          m.tt >= 0 &&
          m.tt < 80 &&
          (m.players as Msg[]).some((p) => p.id === aid && p.tx === want),
        n,
      );
    };
    // A rider, a player not in the train (no field), and a far value.
    await txIs(-3.25, -3.25);
    await txIs(undefined, undefined);
    await txIs(500, 100);
    a.close();
    b.close();
  });
});

describe('session', () => {
  const pub = join(dir, 'public');
  const setBuild = (v: string) =>
    writeFileSync(join(pub, BUILD_FILE), `${v}\n`);
  const protocol = readProtocol(
    join(import.meta.dir, '../game/src/protocol_version.txt'),
  );

  test('GET /api/version, the static header, the welcome first', async () => {
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, 'index.html'), '<!doctype html>');
    setBuild('build-a');
    const port = await start('', { PUBLIC_DIR: pub });

    const res = await fetch(`http://localhost:${port}/api/version`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get(BUILD_HEADER)).toBe('build-a');
    const v = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual([
      'build',
      'instance',
      'protocol',
      'started',
    ]);
    expect(v.build).toBe('build-a');
    expect(v.protocol).toBe(protocol);
    expect(String(v.instance)).toMatch(/^[0-9a-f]{16}$/);
    expect(new Date(String(v.started)).toISOString()).toBe(String(v.started));

    const page = await fetch(`http://localhost:${port}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get(BUILD_HEADER)).toBe('build-a');

    // The welcome is the first message, before the hello, with the same
    // fields and the player id.
    const c = new Client(port);
    const w = await c.next((m) => m.t === 'welcome');
    expect(c.msgs[0]).toBe(w);
    expect(w).toEqual({ t: 'welcome', id: w.id, ...v });
    expect(typeof w.id).toBe('number');
    // No join before the hello: no cvars, no spawn.
    await Bun.sleep(100);
    expect(c.msgs.some((m) => m.t === 'cvars' || m.t === 'spawn')).toBe(false);
    await c.send(hello);
    await c.next((m) => m.t === 'spawn');
    c.close();
  });

  test('SIGTERM: a bye first, then a restart with a new build', async () => {
    mkdirSync(pub, { recursive: true });
    setBuild('build-a');
    const first = await startProc('', { PUBLIC_DIR: pub });
    const a = new Client(first.port);
    const b = new Client(first.port);
    await a.send(hello);
    await b.send({ ...hello, name: 'Bob' });
    const w1 = await a.next((m) => m.t === 'welcome');
    await a.next((m) => m.t === 'spawn');
    await b.next((m) => m.t === 'spawn');

    const n = a.msgs.length;
    first.proc.kill('SIGTERM');
    const bye = await a.next((m) => m.t === 'bye', n);
    expect(bye.reason).toBe(STOP_REASON);
    for (let i = 0; i < 100 && !a.closed; i++) await Bun.sleep(10);
    expect(a.closed).toBe(true);
    expect(await first.proc.exited).toBe(0);
    // The stop sends no "left" lines.
    const left = a.msgs
      .slice(n)
      .some((m) => m.t === 'chat' && String(m.text).endsWith(' left.'));
    expect(left).toBe(false);

    // A new start of a new build, on the same port: a new instance.
    setBuild('build-b');
    const second = await startProc('', {
      PUBLIC_DIR: pub,
      PORT: String(first.port),
    });
    expect(second.port).toBe(first.port);
    const c = new Client(second.port);
    const w2 = await c.next((m) => m.t === 'welcome');
    expect(w2.instance).not.toBe(w1.instance);
    expect(w2.build).toBe('build-b');
    expect(w2.protocol).toBe(w1.protocol);
    expect(Date.parse(String(w2.started))).toBeGreaterThanOrEqual(
      Date.parse(String(w1.started)),
    );
    c.close();
  });
});
