// Where: apps/action/server/index.ts
// When: `bun server/index.ts` (yarn workspace action start, and the docker
// image). PORT is 4080 by default. MATCH_SECONDS (300) and END_SECONDS (10)
// set the match lengths.
// Why: one Bun process serves the static game (public/) and the always-on
// deathmatch lobby on the WebSocket /api/ws.
//
// The lobby: a match is MATCH_SECONDS long. Then the score board shows for
// END_SECONDS, the scores reset, and the next match starts. The clock runs
// with or without players.
//
// Trust model: casual. The client sends its own position and its hits; the
// server checks the fire rate, the phase, and that both players are alive.
//
// Messages (JSON text). Client to server:
//   {t:"hello", name}
//   {t:"st", x, y, z, yaw, pitch}                 20 times a second
//   {t:"fire", o:[x,y,z], e:[x,y,z], hit:id|-1, head:bool}
//   {t:"use", i, l}                               call lift i to level l
// Server to client:
//   {t:"welcome", id}
//   {t:"snap", phase:"play"|"end", left, players:[{id,name,x,y,z,yaw,pitch,hp,k,d,alive}],
//    lifts:[[y, door, level, phase]]}
//   {t:"lift", i, l}             a lift call; each client applies it
//   {t:"spawn", x, y, z, yaw}
//   {t:"shot", id, o, e}          another player fired
//   {t:"hit", from, dmg, hp}      you took damage
//   {t:"kill", killer, victim, head, kname, vname}
//   {t:"match"}                   a new match started

import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';

const PORT = Number(process.env.PORT ?? 4080);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? join(import.meta.dir, '../public');
// The match lengths. Tests set short values.
const MATCH_SECONDS = Number(process.env.MATCH_SECONDS ?? 300);
const END_SECONDS = Number(process.env.END_SECONDS ?? 10);
const RESPAWN_MS = 3000;
const BODY_DAMAGE = 26;
const HEAD_DAMAGE = 100;
const MIN_FIRE_MS = 85;
const MAX_PLAYERS = 16;

// The lobby map is Earl's Court. The same spawn points (x, y, z) as
// apps/action/game/src/maps/earls_court.zig.
const SPAWNS: [number, number, number][] = [
  [-12, 0, 0],
  [12, 0, 0],
  [-12, 0, -35],
  [12, 0, -35],
  [0, 0, -10],
  [-5, 6, 32],
  [5, 6, 32],
  [0, 6, 43],
  [-17, 6, 56],
  [17, 6, 56],
  [-20, -16, -58],
  [20, -16, -58],
];

// The lifts: the same state machine as map.zig (callLift, stepLifts). The
// phase numbers are the order of map.zig Phase.
const LIFT_LEVELS = [0.02, 6.02];
const TRAIN_CYCLE = 70;
const LIFT_COUNT = 2;
const LIFT_SPEED = 1.6;
const DOOR_TIME = 0.8;
const DOOR_HOLD = 6;
enum Phase {
  Idle = 0,
  Opening = 1,
  Open = 2,
  Closing = 3,
  Moving = 4,
}
interface Lift {
  y: number;
  level: number;
  door: number;
  phase: Phase;
  hold: number;
  pending: number | null;
}
const lifts: Lift[] = Array.from({ length: LIFT_COUNT }, () => ({
  y: LIFT_LEVELS[0],
  level: 0,
  door: 0,
  phase: Phase.Idle,
  hold: 0,
  pending: null,
}));

function callLift(l: Lift, level: number): void {
  switch (l.phase) {
    case Phase.Idle:
      if (l.level === level && Math.abs(l.y - LIFT_LEVELS[level]) < 0.01) {
        l.phase = Phase.Opening;
      } else {
        l.level = level;
        l.phase = Phase.Moving;
      }
      break;
    case Phase.Open:
    case Phase.Opening:
      if (level === l.level) {
        l.hold = DOOR_HOLD;
      } else {
        l.pending = level;
        l.phase = Phase.Closing;
      }
      break;
    case Phase.Closing:
      if (level === l.level) l.phase = Phase.Opening;
      else l.pending = level;
      break;
    case Phase.Moving:
      l.pending = level;
      break;
  }
}

function stepLift(l: Lift, dt: number): void {
  switch (l.phase) {
    case Phase.Moving: {
      const d = LIFT_LEVELS[l.level] - l.y;
      const step = LIFT_SPEED * dt;
      if (Math.abs(d) <= step) {
        l.y = LIFT_LEVELS[l.level];
        l.phase = Phase.Opening;
      } else l.y += Math.sign(d) * step;
      break;
    }
    case Phase.Opening:
      l.door = Math.min(1, l.door + dt / DOOR_TIME);
      if (l.door >= 1) {
        l.phase = Phase.Open;
        l.hold = DOOR_HOLD;
      }
      break;
    case Phase.Open:
      l.hold -= dt;
      if (l.hold <= 0) l.phase = Phase.Closing;
      break;
    case Phase.Closing:
      l.door = Math.max(0, l.door - dt / DOOR_TIME);
      if (l.door <= 0) {
        l.phase = Phase.Idle;
        if (l.pending !== null) {
          const p = l.pending;
          l.pending = null;
          if (p !== l.level) {
            l.level = p;
            l.phase = Phase.Moving;
          }
        }
      }
      break;
    case Phase.Idle:
      break;
  }
}

interface Player {
  id: number;
  ws: ServerWebSocket<Conn>;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  k: number;
  d: number;
  alive: boolean;
  respawnAt: number;
  lastFire: number;
  joined: boolean;
}

interface Conn {
  id: number;
}

const players = new Map<number, Player>();
let nextId = 1;
let phase: 'play' | 'end' = 'play';
let phaseEndsAt = Date.now() + MATCH_SECONDS * 1000;

function send(p: Player, msg: object): void {
  p.ws.send(JSON.stringify(msg));
}

function broadcast(msg: object, except?: number): void {
  const text = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.joined && p.id !== except) p.ws.send(text);
  }
}

function cleanName(raw: unknown): string {
  const s = String(raw ?? '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .slice(0, 15);
  return s || 'Player';
}

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
};

/** The spawn point furthest from the living players. */
function spawn(p: Player): void {
  let best = SPAWNS[0];
  let bestDist = -1;
  for (const s of SPAWNS) {
    let nearest = 1e9;
    for (const o of players.values()) {
      if (o.id === p.id || !o.alive || !o.joined) continue;
      nearest = Math.min(
        nearest,
        Math.hypot(o.x - s[0], o.y - s[1], o.z - s[2]),
      );
    }
    // A little randomness, so two spawns in a row do not always match.
    const score = nearest + Math.random() * 6;
    if (score > bestDist) {
      bestDist = score;
      best = s;
    }
  }
  p.x = best[0];
  p.y = best[1];
  p.z = best[2];
  // Face the centre of the arena. Yaw 0 looks to -Z.
  p.yaw = Math.atan2(p.x, p.z);
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
  send(p, { t: 'spawn', x: p.x, y: p.y, z: p.z, yaw: p.yaw });
}

function onFire(p: Player, msg: Record<string, unknown>): void {
  const now = Date.now();
  if (!p.alive || phase !== 'play' || now - p.lastFire < MIN_FIRE_MS) return;
  p.lastFire = now;
  const o = Array.isArray(msg.o)
    ? msg.o.map((v) => num(v, -150, 150) ?? 0)
    : null;
  const e = Array.isArray(msg.e)
    ? msg.e.map((v) => num(v, -300, 300) ?? 0)
    : null;
  if (o?.length === 3 && e?.length === 3)
    broadcast({ t: 'shot', id: p.id, o, e }, p.id);

  const target = players.get(Number(msg.hit));
  if (!target || target.id === p.id || !target.alive || !target.joined) return;
  const dmg = msg.head === true ? HEAD_DAMAGE : BODY_DAMAGE;
  target.hp -= dmg;
  send(target, { t: 'hit', from: p.id, dmg, hp: Math.max(0, target.hp) });
  if (target.hp <= 0) {
    target.alive = false;
    target.hp = 0;
    target.d++;
    target.respawnAt = now + RESPAWN_MS;
    p.k++;
    broadcast({
      t: 'kill',
      killer: p.id,
      victim: target.id,
      head: msg.head === true,
      kname: p.name,
      vname: target.name,
    });
  }
}

function snapshot(): object {
  const list = [];
  for (const p of players.values()) {
    if (!p.joined) continue;
    list.push({
      id: p.id,
      name: p.name,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      yaw: +p.yaw.toFixed(3),
      pitch: +p.pitch.toFixed(3),
      hp: p.hp,
      k: p.k,
      d: p.d,
      alive: p.alive,
    });
  }
  return {
    t: 'snap',
    phase,
    left: Math.max(0, (phaseEndsAt - Date.now()) / 1000),
    players: list,
    // The deep train clock (map.zig Train), the same cycle length.
    tt: +((Date.now() / 1000) % TRAIN_CYCLE).toFixed(2),
    lifts: lifts.map((l) => [
      +l.y.toFixed(3),
      +l.door.toFixed(3),
      l.level,
      l.phase,
    ]),
  };
}

let lastStep = Date.now();

function step(): void {
  const now = Date.now();
  const dt = Math.min(0.2, (now - lastStep) / 1000);
  lastStep = now;
  for (const l of lifts) stepLift(l, dt);
  if (now >= phaseEndsAt) {
    if (phase === 'play') {
      phase = 'end';
      phaseEndsAt = now + END_SECONDS * 1000;
    } else {
      phase = 'play';
      phaseEndsAt = now + MATCH_SECONDS * 1000;
      for (const p of players.values()) {
        p.k = 0;
        p.d = 0;
        if (p.joined) spawn(p);
      }
      broadcast({ t: 'match' });
    }
  }
  for (const p of players.values()) {
    if (p.joined && !p.alive && phase === 'play' && now >= p.respawnAt)
      spawn(p);
  }
  broadcast(snapshot());
}

setInterval(step, 50);

function contentType(path: string): string | undefined {
  if (path.endsWith('.wasm')) return 'application/wasm';
  return undefined;
}

const server = Bun.serve<Conn>({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/api/ws') {
      if (players.size >= MAX_PLAYERS)
        return new Response('lobby full', { status: 503 });
      const ok = srv.upgrade(req, { data: { id: nextId++ } });
      return ok ? undefined : new Response('upgrade failed', { status: 400 });
    }
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, players: players.size, phase });
    }
    // Static files. join() removes "..", so the path stays in PUBLIC_DIR.
    const rel = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    const safe = join('/', rel).slice(1) || 'index.html';
    const file = Bun.file(join(PUBLIC_DIR, safe));
    if (!(await file.exists()))
      return new Response('not found', { status: 404 });
    const type = contentType(safe);
    return new Response(file, {
      headers: {
        'cache-control': 'no-cache',
        ...(type ? { 'content-type': type } : {}),
      },
    });
  },
  websocket: {
    open(ws) {
      const p: Player = {
        id: ws.data.id,
        ws,
        name: 'Player',
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        hp: 100,
        k: 0,
        d: 0,
        alive: false,
        respawnAt: 0,
        lastFire: 0,
        joined: false,
      };
      players.set(p.id, p);
    },
    message(ws, raw) {
      const p = players.get(ws.data.id);
      if (!p) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t === 'hello' && !p.joined) {
        p.name = cleanName(msg.name);
        p.joined = true;
        send(p, { t: 'welcome', id: p.id });
        if (phase === 'play') spawn(p);
        else p.respawnAt = 0;
      } else if (msg.t === 'st' && p.alive) {
        p.x = num(msg.x, -40, 40) ?? p.x;
        p.y = num(msg.y, -30, 30) ?? p.y;
        p.z = num(msg.z, -80, 80) ?? p.z;
        p.yaw = num(msg.yaw, -1e4, 1e4) ?? p.yaw;
        p.pitch = num(msg.pitch, -2, 2) ?? p.pitch;
      } else if (msg.t === 'fire') {
        onFire(p, msg);
      } else if (msg.t === 'use') {
        const i = Number(msg.i);
        const level = Number(msg.l);
        if (!p.alive || !(i in lifts) || !(level in LIFT_LEVELS)) return;
        callLift(lifts[i], level);
        broadcast({ t: 'lift', i, l: level });
      }
    },
    close(ws) {
      players.delete(ws.data.id);
    },
  },
});

console.log(`action: http://localhost:${server.port} (lobby on /api/ws)`);
