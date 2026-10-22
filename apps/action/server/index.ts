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
// Server to client:
//   {t:"welcome", id}
//   {t:"snap", phase:"play"|"end", left, players:[{id,name,x,y,z,yaw,pitch,hp,k,d,alive}]}
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

// The same spawn points as apps/action/game/src/map.zig.
const SPAWNS: [number, number][] = [
  [-24, -24],
  [24, 24],
  [-24, 24],
  [24, -24],
  [0, -25],
  [0, 25],
  [-25, 0],
  [25, 0],
];

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
      nearest = Math.min(nearest, Math.hypot(o.x - s[0], o.z - s[1]));
    }
    // A little randomness, so two spawns in a row do not always match.
    const score = nearest + Math.random() * 6;
    if (score > bestDist) {
      bestDist = score;
      best = s;
    }
  }
  p.x = best[0];
  p.y = 0;
  p.z = best[1];
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
    ? msg.o.map((v) => num(v, -100, 100) ?? 0)
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
  };
}

function step(): void {
  const now = Date.now();
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
        p.y = num(msg.y, -10, 30) ?? p.y;
        p.z = num(msg.z, -40, 40) ?? p.z;
        p.yaw = num(msg.yaw, -1e4, 1e4) ?? p.yaw;
        p.pitch = num(msg.pitch, -2, 2) ?? p.pitch;
      } else if (msg.t === 'fire') {
        onFire(p, msg);
      }
    },
    close(ws) {
      players.delete(ws.data.id);
    },
  },
});

console.log(`action: http://localhost:${server.port} (lobby on /api/ws)`);
