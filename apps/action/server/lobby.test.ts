// Where: apps/action/server/lobby.test.ts
// When: `yarn workspace action test` (bun test server).
// Why: runs the real server (index.ts) on a free port and talks to it over
// the WebSocket: the server cvars on join, the config file, rcon off with
// no admin_password, a client cannot change a server cvar, an rcon set
// goes to every player, and the chat relay with the server lines.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

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
      return Number(m[1]);
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
    await a.next((m) => m.t === 'welcome');
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
