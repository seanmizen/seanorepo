// Where: apps/action/server/index.ts
// When: `bun server/index.ts` (yarn workspace action start, and the docker
// image). PORT is 4080 by default.
// Why: one Bun process serves the static game (public/) and the always-on
// deathmatch lobby on the WebSocket /api/ws.
//
// The server cvars (game/src/server_cvars.json) come from the defaults, then
// the config file (SERVER_CONFIG, default server/server.cfg), then the
// SV_<NAME> environment variables (console.ts). Each player gets them on
// join and on each change. Only rcon changes them at run time, and rcon is
// off while admin_password is empty.
//
// The lobby: a match is match_seconds long. Then the score board shows for
// end_seconds, the scores reset, and the next match starts. The clock runs
// with or without players.
//
// Trust model: casual. The client sends its own position and its hits. The
// server checks the phase, that both players are alive, and for each shot
// the weapon: it must be in the shooter's loadout, the fire rate of its
// gun, the pellet count and the reach. The server takes the damage from
// its own table (guns.ts), with the fall-off at its own distance between
// the two players. For a grenade it also checks the throws left in this
// life, that each blast has a throw, the damage range, and that each
// target is near the blast.
//
// Chat (chat.ts): the server relays each chat message. It removes the
// control characters, cuts the message to chat_max_length bytes, and
// limits each player to chat_rate_messages in chat_rate_seconds. A team
// message goes to the team of the sender. Deathmatch has no teams: each
// player is a team of one, so a team message goes to the sender only. The
// server also writes its own lines to the chat: a join, a leave, the start
// and the end of a match.
//
// The session (session.ts): the server has an instance id (new at each
// start), a build version (public/build-version.txt) and a protocol version
// (game/src/protocol_version.txt). GET /api/version and the welcome give
// them. Before a planned stop (SIGTERM, SIGINT) each client gets a bye.
// Add 1 to the protocol version for each change to a message that a client
// of the old version cannot read: that client must reload before it joins.
//
// The ticket gates (game/src/gates.zig): the server sends a tap and a
// passage of each lane to the other players, so the paddles are the same
// on each client. The fares stay on the client.
//
// The secret room of VAPES N MORE (game/src/secret_room.zig): the first
// player who opens its door tells the server. The server sends it to the
// other players, and to each player who joins later, until the next match.
// A blessing of MORE (the golden pigeon) goes to the other players too, so
// they see the halo and the shine. The effects stay on the client.
//
// The pigeons (pigeons.ts): the server owns the state of each pigeon and of
// each body. The client that startles or kills a pigeon decides, and the
// server checks and sends the event. The server decides the joyrides and
// the returns. Each client flies each flight from its seed.
//
// The roadmen of Warwick Road (roadmen.ts): the client of a player past
// the roadman line decides. The server checks the chase, sends it to the
// other players, applies the damage of each stab, and credits "roadman"
// for the death.
//
// The moped thieves of Warwick Road (moped.ts): the client of a player on
// the street decides the approach of its moped. The server owns the
// stolen gun and the health of the riders, and sends each event with its
// place to the players. A robbed player has an empty primary slot until
// it picks up the gun or spawns.
//
// Weapons: the class ids are the order of game/src/weapon.zig Class. A pick
// is [class, model]: the model must be a gun of the class, and the model
// sets the stats (guns.json). A new pick applies at the next spawn, or at
// once while the player is at the spawn point and has not fired.
//
// Messages (JSON text). Client to server:
//   {t:"hello", name, p:[c,m], s:[c,m]}           the join, after the welcome.
//                                                 p the primary, s the secondary
//   {t:"st", x, y, z, yaw, pitch, lean, w, m, lift}
//                                                 20 times a second. lean is
//                                                 -1 (left) to 1 (right). w and
//                                                 m: the held class and model.
//                                                 lift: the cab that the player
//                                                 stands in, or -1. tx: only
//                                                 for a rider of the deep
//                                                 train, the feet x from the
//                                                 train centre.
//   {t:"fire", w, o:[x,y,z], e:[x,y,z], hits:[{id, b, h}]}
//                                                 a shot of class w: b body and
//                                                 h head pellets on player id.
//                                                 The knife sends no o and e.
//   {t:"loadout", p:[c,m], s:[c,m]}               a new pick
//   {t:"use", i, l}                               call lift i to level l
//   {t:"shock"}                                   the player touched the live rail
//   {t:"die", by}                                 an environment death: the
//                                                 client kills its own player.
//                                                 by is the cause, one of
//                                                 ENV_DEATHS ("Popcorn lung",
//                                                 "Guilt"). The server ignores
//                                                 any other cause.
//   {t:"nade", o:[x,y,z], v:[x,y,z]}              a grenade throw: start, velocity
//   {t:"blast", p:[x,y,z], hits:[{id, dmg}]}      the thrower's grenade went off.
//                                                 The thrower's client calculates
//                                                 the damage (cover included), and
//                                                 the thrower can be in the list.
//   {t:"pong", n}                                 the answer to ping n (ping.ts)
//   {t:"rcon", pw, cmd}                           run a server command (remote
//                                                 admin). pw is admin_password.
//   {t:"chat", ch:"all"|"team", text}             a chat message
//   {t:"gate", k:"open"|"pass", i}                the player tapped the reader of
//                                                 lane i, or walked through it
//   {t:"more", k:"open"}                          the player opened the door of
//                                                 the secret room (GET MORE)
//   {t:"more", k:"bless"}                         the player took MORE (the
//                                                 golden pigeon)
//   {t:"pg", k, i, g, sd, o:[x,y,z], v:[x,y,z]}   a pigeon event (pigeons.ts):
//                                                 k "up" (a takeoff or a startle
//                                                 in flight, sd its seed), "die",
//                                                 "push", "grab", "drop". i the
//                                                 pigeon, g its generation. o and
//                                                 v: the place and the velocity.
//   {t:"rm", k:"go", at:[[x,y,z],[x,y,z]]}        the player went past the roadman
//                                                 line: two roadmen start at `at`
//                                                 (roadmen.ts)
//   {t:"rm", k:"off"}                             the player went back over the
//                                                 line: the roadmen walk away
//   {t:"rm", k:"stab"}                            a stab of a roadman landed on
//                                                 the player
//   {t:"mp", k:"go", q}                           the player stepped onto Warwick
//                                                 Road: its moped starts at q
//                                                 [x, y, z, yaw, speed, roll]
//                                                 (moped.ts)
//   {t:"mp", k:"snatch", q}                       the thief takes the primary of
//                                                 the player, the moped at q
//   {t:"mp", k:"away", q}                         the moped gives up at q
//   {t:"mp", k:"pick", id}                        F on the gun on the ground of
//                                                 the visit of player id
//   A fire or a blast can carry mh: the hits on the moped riders. Fire:
//   mh:[{id, r, b, h, d, q}], blast: mh:[{id, r, dmg, q}]. id: the player
//   of the visit, r: 0 the driver, 1 the thief, d: the distance, q: the
//   state of the rider (10 numbers, moped.ts).
// Server to client:
//   {t:"welcome", id, instance, build, protocol, started}
//                                 the first message, before the hello. The
//                                 client sends the hello only when its
//                                 protocol is the same (session.ts).
//   {t:"bye", reason}             the server closes the connection next
//   {t:"snap", phase:"play"|"end", left, players:[{id,name,x,y,z,yaw,pitch,lean,lift,tx?,hp,k,d,alive,w,m}],
//    tt, lifts:[[y, door, level, phase]]}
//                                 a client draws a player with lift >= 0 on
//                                 the floor of its own cab of that lift, and
//                                 a player with tx in its own deep train.
//                                 tt: the deep train clock.
//   {t:"lift", i, l}             a lift call; each client applies it
//   {t:"spawn", x, y, z, yaw, p, s}  p and s: the weapons of the new life
//   {t:"loadout", p, s}           the answer to a pick: the weapons of this life
//   {t:"shot", id, w, o, e}       another player fired
//   {t:"nade", id, o, v}          another player threw a grenade. Each client
//                                 flies the same path for the visuals.
//   {t:"hit", from, dmg, hp}      you took damage
//   {t:"kill", killer, victim, head, kname, vname, by}
//                                 by: only for a die message. Then killer is
//                                 the victim, and kname and by are the cause.
//   {t:"match"}                   a new match started
//   {t:"ping", n}                 answer with pong n at once
//   {t:"pings", ms:[[id, ms, stale]]}  each 2 s: the ping of each player in
//                                 whole ms (-1: no value yet). stale 1: no
//                                 answer for 10 s. See ping.ts.
//   {t:"cvars", cv:[[name, value]]}  server cvars, as text: all of them on
//                                 join, then each change. Never a protected one.
//   {t:"print", text}             a line for the console (the answer to rcon)
//   {t:"chat", ch:"all"|"team", id, name, text}  a chat message of player id,
//                                 cleaned. The sender gets it back too.
//   {t:"chat", ch:"server", text} a server line: a join, a leave, a match
//                                 start or end, or "Too many messages" to
//                                 the sender
//   {t:"gate", k, i, id}          player id tapped lane i or walked through it
//   {t:"more", k:"open", id}      player id opened the secret room: open
//                                 its door, with the choir
//   {t:"more", k:"now"}           on join: the secret room is open. Open
//                                 its door at once, with no choir
//   {t:"more", k:"bless", id}     player id took MORE: the halo and the
//                                 shine for 45 s, or to its death
//   {t:"pg", k, i, g, sd, o, v, id}  a pigeon event of player id. "grab" goes
//                                 to all: id is the holder. Also from the
//                                 server: {k:"joy", i, sd, pr:[rod, u]} and
//                                 {k:"back", i, g, sd, pr}. A "drop" with no
//                                 o: the holder left.
//   {t:"flock", b:[[st, g, rod, u]], sd, c:[[i, g, x, y, z, holder]]}
//                                 the state of the pigeons, each 10 s. sd
//                                 and c (the bodies) only on join.
//   {t:"rm", k:"go", at, id}      the roadmen of player id start at `at`
//   {t:"rm", k:"off", id}         the roadmen of player id walk away
//   {t:"mp", k:"go", id, q}       the moped of player id starts at q
//   {t:"mp", k:"snatch", id, q, p}  to all: the thief took gun p
//                                 ([class, model]) of player id at q
//   {t:"mp", k:"away", id, q}     the moped of player id gives up at q
//   {t:"mp", k:"die", id, r, q, who}  to all: rider r of the visit of
//                                 player id died at q, a hit of player who
//   {t:"mp", k:"pick", id, who}   to all: player who got the gun of the
//                                 visit of player id
//   {t:"mp", k:"end", id}         to all: the visit of player id is over
//   A stab of a roadman gives {t:"hit", from:0, dmg, hp}. A death by a stab
//   is a kill with kname "roadman" and no `by`.

import { createHash, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { ServerWebSocket } from 'bun';
import {
  chatChannel,
  chatRateOk,
  chatRecipients,
  chatWaitSeconds,
  cleanChat,
  matchEndText,
} from './chat';
import {
  applyEnv,
  Cvars,
  readDefs,
  runConfigFile,
  ServerConsole,
} from './console';
import { type Gun, gunInPick, gunOf, type SlotName, shotDamage } from './guns';
import { Mopeds } from './moped';
import { Flock } from './pigeons';
import {
  newPing,
  onPong,
  PING_INTERVAL_MS,
  type PingState,
  pingRound,
} from './ping';
import { ROADMAN, Roadmen } from './roadmen';
import {
  BUILD_HEADER,
  bye,
  newIdent,
  readBuild,
  readProtocol,
  stopOnSignal,
  versionResponse,
  welcome,
} from './session';

const PORT = Number(process.env.PORT ?? 4080);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? join(import.meta.dir, '../public');
const SERVER_CONFIG =
  process.env.SERVER_CONFIG ?? join(import.meta.dir, 'server.cfg');

// The server cvars: defaults, then the config file, then SV_<NAME>.
const cvars = new Cvars(
  readDefs(join(import.meta.dir, '../game/src/server_cvars.json')),
);
// Who this server is: a new instance id at each start (session.ts).
const ident = newIdent(
  readBuild(PUBLIC_DIR),
  readProtocol(join(import.meta.dir, '../game/src/protocol_version.txt')),
  new Date(),
);
const serverConsole = new ServerConsole(cvars, [
  {
    name: 'status',
    args: '',
    description: 'List the players: id, name, kills and deaths.',
    run: (_a, out) => {
      out(`${players.size} players, phase ${phase}`);
      for (const p of players.values())
        out(`${p.id} ${p.name} ${p.k}/${p.d}${p.joined ? '' : ' (joining)'}`);
    },
  },
]);
const log = (line: string) => console.log(`action: ${line}`);

const RESPAWN_MS = 3000;
/// The causes that a client can give in {t:"die", by}: the kill feed shows
/// the cause as the killer. "Popcorn lung": a vape of the vape shop
/// (game/src/vapes.zig). "Guilt": fare dodging.
const ENV_DEATHS: ReadonlySet<string> = new Set(['Popcorn lung', 'Guilt']);
const MAX_PLAYERS = 16;

// The class ids of the knife and the grenade (game/src/weapon.zig Class).
const KNIFE = 8;
const GRENADE = 9;
// The fire rate check. The messages bunch up on the way, so one gap can be
// short. Over FIRE_WINDOW intervals, the rate must stay below the class
// rate / FIRE_SLACK. Two rounds never come closer than half the gap.
const FIRE_WINDOW = 4;
const FIRE_SLACK = 0.8;
// The lag of the positions: a hit may be this much further than the reach.
const REACH_SLACK = 3;
// The default pick: AssaultRifle_2 and Pistol_1 (model ids 1 and 23), as
// game/src/weapon.zig Choice.default.
const DEFAULT_PICK: Pick = { p: [0, 1], s: [6, 23] };
// A new pick applies at once within this distance of the spawn point.
const SWAP_RADIUS = 4;
// Grenades: the same numbers as apps/action/game/src/grenade.zig.
const NADES_PER_LIFE = 3;
const MIN_NADE_MS = 700;
const NADE_RADIUS = 8;
// A blast more than this far from the server position of a target cannot
// hit it (the radius, plus the lag of the positions).
const NADE_REACH = NADE_RADIUS + 3;
// Remote admin: a connection closes after RCON_TRIES bad passwords, and
// rcon stops for everyone for a minute after RCON_FAILS_A_MINUTE.
const RCON_TRIES = 5;
const RCON_FAILS_A_MINUTE = 20;

// The lobby map is Earl's Court. The same spawn points (x, y, z) as
// apps/action/game/src/maps/earls_court.zig.
const SPAWNS: [number, number, number][] = [
  [-40, 0, -14.8],
  [40, 0, 6.4],
  [30, -15, -26],
  [30, -15, -19],
  [-10, 0, -15.5],
  [-10, 0, 2],
  [-20, 4.8, -19.7],
  [55, 4.8, 0],
  [-55, 4.8, 0],
  [85, 4.8, -20],
  [-36, -5.6, -4],
  [-5, -15, -22.5],
];

// The lifts: the same state machine as map.zig (callLift, stepLifts). The
// phase numbers are the order of map.zig Phase.
// Each lift: its two floor heights (2 cm proud of the landing) and its
// speed. Two District lifts, then the deep Piccadilly lift.
const LIFTS: { levels: [number, number]; speed: number }[] = [
  { levels: [0.02, 4.82], speed: 1.6 },
  { levels: [0.02, 4.82], speed: 1.6 },
  { levels: [-14.98, 4.82], speed: 3.2 },
];
const TRAIN_CYCLE = 80;
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
  levels: [number, number];
  speed: number;
  y: number;
  level: number;
  door: number;
  phase: Phase;
  hold: number;
  pending: number | null;
}
const lifts: Lift[] = LIFTS.map((def) => ({
  levels: def.levels,
  speed: def.speed,
  y: def.levels[0],
  level: 0,
  door: 0,
  phase: Phase.Idle,
  hold: 0,
  pending: null,
}));

function callLift(l: Lift, level: number): void {
  switch (l.phase) {
    case Phase.Idle:
      if (l.level === level && Math.abs(l.y - l.levels[level]) < 0.01) {
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
      const d = l.levels[l.level] - l.y;
      const step = l.speed * dt;
      if (Math.abs(d) <= step) {
        l.y = l.levels[l.level];
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
  /** -1 full lean left, 0 upright, 1 full lean right. */
  lean: number;
  /** The lift whose cab the player stands in, or -1. The other clients
   * draw the player on their own cab. */
  lift: number;
  /** A rider of the deep train: the feet x from the train centre, or
   * null. The other clients draw the player in their own train. */
  tx: number | null;
  hp: number;
  k: number;
  d: number;
  alive: boolean;
  respawnAt: number;
  /** The times of the recent shots of each class (as many as its burst). */
  shots: Map<number, number[]>;
  /** The weapons of this life, and the pick for the next spawn. */
  pick: Pick;
  next: Pick;
  /** The held weapon: [class, model]. Others see it. */
  held: [number, number];
  /** The spawn point of this life, and a shot or throw since then. */
  spawnAt: [number, number, number];
  firedSinceSpawn: boolean;
  joined: boolean;
  /** Grenades left in this life. */
  nades: number;
  /** Bad rcon passwords on this connection. */
  rconFails: number;
  /** Throws that have not gone off. A blast needs one. */
  nadesInAir: number;
  lastNade: number;
  /** The round-trip time to the client (ping.ts). */
  ping: PingState;
  /** The team. 0: no team, a team of one (deathmatch). See chat.ts. */
  team: number;
  /** The send times of the recent chat messages (chat.ts chatRateOk). */
  chatTimes: number[];
}

interface Conn {
  id: number;
}

/** A primary and a secondary weapon, each [class, model]. */
interface Pick {
  p: [number, number];
  s: [number, number];
}

/** One [class, model] pair from a message, or null. The model must be a
 * gun of the class, in the slot. */
function pickPart(v: unknown, slot: SlotName): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [c, m] = v.map(Number);
  if (!Number.isInteger(c) || !Number.isInteger(m)) return null;
  if (gunOf(c, m)?.slot !== slot) return null;
  return [c, m];
}

function pickFrom(msg: Record<string, unknown>): Pick | null {
  const p = pickPart(msg.p, 'primary');
  const s = pickPart(msg.s, 'secondary');
  return p && s ? { p, s } : null;
}

const players = new Map<number, Player>();
let nextId = 1;
/// The pigeons of Earl's Court: one flock for the life of the server.
const flock = new Flock(Date.now());
const roadmen = new Roadmen();
/// The moped thieves: the stolen guns and the riders.
const mopeds = new Mopeds();
/// The lanes of the ticket gates: gates.zig max_lanes.
const GATE_LANES = 16;
/// The door of the secret room is open (secret_room.zig). A new match
/// shuts it.
let moreOpen = false;
let phase: 'play' | 'end' = 'play';

runConfigFile(serverConsole, SERVER_CONFIG, log);
applyEnv(cvars, process.env, log);
// Each change goes to the players. A protected cvar never does.
cvars.onChange((def, text) => {
  if (!def.flags.includes('protected'))
    broadcast({ t: 'cvars', cv: [[def.name, text]] });
});

let phaseEndsAt = Date.now() + cvars.number('match_seconds') * 1000;

function send(p: Player, msg: object): void {
  p.ws.send(JSON.stringify(msg));
}

function broadcast(msg: object, except?: number): void {
  const text = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.joined && p.id !== except) p.ws.send(text);
  }
}

/** A server line in the chat of every player. */
function serverLine(text: string): void {
  broadcast({ t: 'chat', ch: 'server', text });
}

/** A chat message: clean it, check the rate of the sender, and relay it.
 * The sender gets it back too, as the others see it. */
function onChat(p: Player, msg: Record<string, unknown>): void {
  const ch = chatChannel(msg.ch);
  const text = cleanChat(msg.text, cvars.number('chat_max_length'));
  if (!ch || !text) return;
  const now = Date.now();
  const windowMs = cvars.number('chat_rate_seconds') * 1000;
  if (
    !chatRateOk(p.chatTimes, now, cvars.number('chat_rate_messages'), windowMs)
  ) {
    const wait = chatWaitSeconds(p.chatTimes, now, windowMs);
    send(p, {
      t: 'chat',
      ch: 'server',
      text: `Too many messages. Wait ${wait} s.`,
    });
    return;
  }
  log(`chat ${ch} ${p.name} (${p.id}): ${text}`);
  const out = JSON.stringify({ t: 'chat', ch, id: p.id, name: p.name, text });
  for (const q of chatRecipients(p, players.values(), ch)) q.ws.send(out);
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

/** The `lift` field of an st message: the index of a lift, or -1. */
const liftIndex = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < lifts.length
    ? v
    : -1;

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
  p.lean = 0;
  p.lift = -1;
  p.tx = null;
  p.hp = 100;
  p.alive = true;
  p.nades = NADES_PER_LIFE;
  p.pick = p.next;
  p.held = [...p.pick.p];
  p.shots.clear();
  p.spawnAt = [p.x, p.y, p.z];
  p.firedSinceSpawn = false;
  roadmen.end(p.id);
  for (const o of mopeds.end(p.id)) broadcast(o.msg);
  send(p, {
    t: 'spawn',
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    p: p.pick.p,
    s: p.pick.s,
  });
}

/** A new pick: for the next spawn, and at once while the player is at the
 * spawn point and has not fired. The answer is the pick of this life. */
function onLoadout(p: Player, msg: Record<string, unknown>): void {
  const pick = pickFrom(msg);
  if (!pick) return;
  p.next = pick;
  const [sx, sy, sz] = p.spawnAt;
  const near = Math.hypot(p.x - sx, p.y - sy, p.z - sz) < SWAP_RADIUS;
  if (p.alive && near && !p.firedSinceSpawn && !mopeds.robbed(p.id)) {
    p.pick = pick;
    p.shots.clear();
  }
  send(p, { t: 'loadout', p: p.pick.p, s: p.pick.s });
}

/** True when a shot of class `w` now keeps to the fire rate of its gun:
 * at most `burst` rounds an interval, over FIRE_WINDOW intervals. */
function fireRateOk(p: Player, w: number, cls: Gun, now: number): boolean {
  const times = p.shots.get(w) ?? [];
  const last = times[times.length - 1];
  if (last !== undefined && now - last < cls.gap * 500) return false;
  const span = cls.interval * 1000 * FIRE_WINDOW * FIRE_SLACK;
  const recent = times.filter((t) => now - t < span);
  if (recent.length >= cls.burst * FIRE_WINDOW) return false;
  recent.push(now);
  p.shots.set(w, recent);
  return true;
}

/// A death with no killer: the live rail, a cause of a die message, or the
/// roadmen. kname is the killer in the kill feed. by is set for a die
/// message only.
function envDeath(p: Player, kname: string, by?: string): void {
  roadmen.end(p.id);
  p.alive = false;
  p.hp = 0;
  p.d++;
  p.respawnAt = Date.now() + RESPAWN_MS;
  broadcast({
    t: 'kill',
    killer: p.id,
    victim: p.id,
    head: false,
    kname,
    vname: p.name,
    ...(by ? { by } : {}),
  });
}

function onFire(p: Player, msg: Record<string, unknown>): void {
  const now = Date.now();
  if (!p.alive || phase !== 'play') return;
  // The weapon must be one of this life: the primary, the secondary or the
  // knife.
  const w = Number(msg.w);
  // A robbed player has no primary (moped.ts).
  const primary: [number, number] = mopeds.stolen(p.id) ? [-1, -1] : p.pick.p;
  const cls = gunInPick(w, primary, p.pick.s);
  if (!cls) return;
  if (!fireRateOk(p, w, cls, now)) return;
  p.firedSinceSpawn = true;
  const o = vec3(msg.o, 450);
  const e = vec3(msg.e, 450);
  if (o && e) broadcast({ t: 'shot', id: p.id, w, o, e }, p.id);

  let pellets = cls.pellets;
  const seen = new Set<number>();
  const hits = Array.isArray(msg.hits) ? msg.hits : [];
  for (const h of hits.slice(0, MAX_PLAYERS)) {
    if (typeof h !== 'object' || h === null) continue;
    const { id, b, h: hd } = h as Record<string, unknown>;
    const target = players.get(Number(id));
    const body = Number(b);
    const head = Number(hd);
    if (!target || target.id === p.id || !target.alive || !target.joined)
      continue;
    if (seen.has(target.id)) continue;
    if (!Number.isInteger(body) || !Number.isInteger(head)) continue;
    if (body < 0 || head < 0 || body + head === 0 || body + head > pellets)
      continue;
    const far = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z);
    if (far > cls.range + REACH_SLACK) continue;
    seen.add(target.id);
    pellets -= body + head;
    damage(p, target, shotDamage(cls, body, head, far), head > 0);
  }
  // The moped riders: the remaining pellets.
  if (!Array.isArray(msg.mh)) return;
  for (const h of msg.mh.slice(0, 4)) {
    if (typeof h !== 'object' || h === null) continue;
    const { id, r, b, h: hd, d, q } = h as Record<string, unknown>;
    const body = Number(b);
    const head = Number(hd);
    if (!Number.isInteger(body) || !Number.isInteger(head)) continue;
    if (body < 0 || head < 0 || body + head === 0 || body + head > pellets)
      continue;
    const far = Math.min(cls.range, Math.max(0, Number(d) || 0));
    pellets -= body + head;
    const dmg = shotDamage(cls, body, head, far);
    for (const o of mopeds.hit(p.id, id, r, dmg, q)) broadcast(o.msg);
  }
}

/** A roadman event of player p (roadmen.ts): the relay to the other
 * players, and the damage of a stab. A death by a stab credits
 * "roadman". */
function onRoadman(p: Player, msg: Record<string, unknown>): void {
  if (!p.joined || phase !== 'play') return;
  const r = roadmen.onMessage(p.id, p, msg, Date.now());
  for (const o of r.out) broadcast(o.msg, p.id);
  if (r.damage <= 0) return;
  p.hp -= r.damage;
  send(p, { t: 'hit', from: 0, dmg: r.damage, hp: Math.max(0, p.hp) });
  if (p.hp <= 0) envDeath(p, ROADMAN);
}

/** A moped event of player p (moped.ts): the relay to the players, and a
 * gun for the player who picks it up. */
function onMoped(p: Player, msg: Record<string, unknown>): void {
  if (!p.joined || phase !== 'play') return;
  const r = mopeds.onMessage(p.id, p, p.pick.p, msg);
  for (const o of r.out) broadcast(o.msg, o.to === 'others' ? p.id : undefined);
  if (r.give) {
    const q = players.get(r.give.id);
    if (q) q.pick = { p: r.give.gun, s: q.pick.s };
  }
}

/** Apply damage from an attacker: the hit message, and a kill at 0 hp. A
 * player can damage itself with a grenade. That kill gives no score. */
function damage(p: Player, target: Player, dmg: number, head: boolean): void {
  target.hp -= dmg;
  send(target, { t: 'hit', from: p.id, dmg, hp: Math.max(0, target.hp) });
  if (target.hp <= 0) {
    roadmen.end(target.id);
    target.alive = false;
    target.hp = 0;
    target.d++;
    target.respawnAt = Date.now() + RESPAWN_MS;
    if (target.id !== p.id) p.k++;
    broadcast({
      t: 'kill',
      killer: p.id,
      victim: target.id,
      head,
      kname: p.name,
      vname: target.name,
    });
  }
}

const vec3 = (v: unknown, lim: number): number[] | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((x) => num(x, -lim, lim));
  return out.every((x) => x !== null) ? (out as number[]) : null;
};

function onNade(p: Player, msg: Record<string, unknown>): void {
  const now = Date.now();
  if (!p.alive || phase !== 'play' || p.nades <= 0) return;
  if (now - p.lastNade < MIN_NADE_MS) return;
  const o = vec3(msg.o, 150);
  const v = vec3(msg.v, 40);
  if (!o || !v) return;
  p.lastNade = now;
  p.firedSinceSpawn = true;
  p.nades--;
  p.nadesInAir++;
  broadcast({ t: 'nade', id: p.id, o, v }, p.id);
}

/** A grenade of p went off. The thrower may be dead by now: a grenade in
 * the air still counts. */
function onBlast(p: Player, msg: Record<string, unknown>): void {
  if (phase !== 'play' || p.nadesInAir <= 0) return;
  p.nadesInAir--;
  const at = vec3(msg.p, 300);
  if (!at || !Array.isArray(msg.hits)) return;
  const seen = new Set<number>();
  for (const h of msg.hits.slice(0, MAX_PLAYERS)) {
    if (typeof h !== 'object' || h === null) continue;
    const { id, dmg } = h as Record<string, unknown>;
    const target = players.get(Number(id));
    const amount = Math.round(Number(dmg));
    if (!target || !target.alive || !target.joined || seen.has(target.id))
      continue;
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) continue;
    const far = Math.hypot(
      target.x - at[0],
      target.y - at[1],
      target.z - at[2],
    );
    if (far > NADE_REACH) continue;
    seen.add(target.id);
    damage(p, target, amount, false);
  }
  // The moped riders near the blast.
  if (!Array.isArray(msg.mh)) return;
  for (const h of msg.mh.slice(0, 4)) {
    if (typeof h !== 'object' || h === null) continue;
    const { id, r, dmg, q } = h as Record<string, unknown>;
    const amount = Math.round(Number(dmg));
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) continue;
    if (!Array.isArray(q) || q.length !== 10) continue;
    const far = Math.hypot(
      Number(q[0]) - at[0],
      Number(q[1]) - at[1],
      Number(q[2]) - at[2],
    );
    if (!(far <= NADE_REACH)) continue;
    for (const o of mopeds.hit(p.id, id, r, amount, q)) broadcast(o.msg);
  }
}

// The bad rcon passwords of the last minute, of all players.
let rconFailTimes: number[] = [];

/** The two strings are equal. The time does not depend on where they
 * differ. */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Remote admin: run a server command (console.ts) for a player who gives
 * admin_password. The answer goes back as print lines. */
function onRcon(p: Player, msg: Record<string, unknown>): void {
  const reply = (text: string) => send(p, { t: 'print', text });
  const password = cvars.string('admin_password');
  if (!password) {
    reply('rcon is off: the server has no admin_password');
    return;
  }
  const now = Date.now();
  rconFailTimes = rconFailTimes.filter((t) => now - t < 60_000);
  if (rconFailTimes.length >= RCON_FAILS_A_MINUTE) {
    reply('rcon: too many bad passwords, try again in a minute');
    return;
  }
  if (typeof msg.pw !== 'string' || !sameSecret(msg.pw, password)) {
    rconFailTimes.push(now);
    p.rconFails++;
    reply('rcon: bad password');
    if (p.rconFails >= RCON_TRIES) bye(p.ws, 'Too many bad rcon passwords.');
    return;
  }
  const cmd = typeof msg.cmd === 'string' ? msg.cmd.slice(0, 240) : '';
  log(`rcon from ${p.name} (${p.id}): ${cmd}`);
  serverConsole.exec(cmd, reply);
}

/** A tap or a passage of a ticket gate lane: the other players open or
 * close the same lane. */
function onGate(p: Player, msg: Record<string, unknown>): void {
  const i = msg.i;
  const k = msg.k;
  if (!p.joined || !p.alive) return;
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= GATE_LANES)
    return;
  if (k !== 'open' && k !== 'pass') return;
  broadcast({ t: 'gate', k, i, id: p.id }, p.id);
}

/** GET MORE: the first player opens the door of the secret room for all
 * the players. MORE: a blessing, only with the door open. */
function onMore(p: Player, msg: Record<string, unknown>): void {
  if (!p.joined || !p.alive) return;
  if (msg.k === 'open' && !moreOpen) {
    moreOpen = true;
    broadcast({ t: 'more', k: 'open', id: p.id }, p.id);
  } else if (msg.k === 'bless' && moreOpen) {
    broadcast({ t: 'more', k: 'bless', id: p.id }, p.id);
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
      lean: +p.lean.toFixed(2),
      lift: p.lift,
      ...(p.tx === null ? {} : { tx: +p.tx.toFixed(3) }),
      hp: p.hp,
      k: p.k,
      d: p.d,
      alive: p.alive,
      w: p.held[0],
      m: p.held[1],
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

/** Seconds as m:ss. */
const timeText = (secs: number): string =>
  `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

let lastStep = Date.now();

function step(): void {
  const now = Date.now();
  const dt = Math.min(0.2, (now - lastStep) / 1000);
  lastStep = now;
  for (const l of lifts) stepLift(l, dt);
  for (const m of flock.step(now)) broadcast(m);
  if (now >= phaseEndsAt) {
    if (phase === 'play') {
      phase = 'end';
      phaseEndsAt = now + cvars.number('end_seconds') * 1000;
      const scores = [...players.values()].filter((p) => p.joined);
      serverLine(matchEndText(scores));
    } else {
      phase = 'play';
      phaseEndsAt = now + cvars.number('match_seconds') * 1000;
      for (const p of players.values()) {
        p.k = 0;
        p.d = 0;
        if (p.joined) spawn(p);
      }
      moreOpen = false;
      broadcast({ t: 'match' });
      serverLine(
        `A new match started: ${timeText(cvars.number('match_seconds'))}.`,
      );
    }
  }
  for (const p of players.values()) {
    if (p.joined && !p.alive && phase === 'play' && now >= p.respawnAt)
      spawn(p);
  }
  broadcast(snapshot());
}

setInterval(step, 50);
setInterval(
  () => broadcast(pingRound(players.values(), Date.now(), send)),
  PING_INTERVAL_MS,
);

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
    if (url.pathname === '/api/version') return versionResponse(ident);
    if (url.pathname === '/api/health') {
      return Response.json(
        { ok: true, players: players.size, phase },
        { headers: { [BUILD_HEADER]: ident.build } },
      );
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
        [BUILD_HEADER]: ident.build,
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
        lean: 0,
        lift: -1,
        tx: null,
        hp: 100,
        k: 0,
        d: 0,
        alive: false,
        respawnAt: 0,
        shots: new Map(),
        pick: DEFAULT_PICK,
        next: DEFAULT_PICK,
        held: [...DEFAULT_PICK.p],
        spawnAt: [0, 0, 0],
        firedSinceSpawn: false,
        joined: false,
        nades: 0,
        nadesInAir: 0,
        lastNade: 0,
        ping: newPing(Date.now()),
        rconFails: 0,
        team: 0,
        chatTimes: [],
      };
      players.set(p.id, p);
      // The first message: who the server is. The client compares it with
      // its own version before it sends the hello.
      ws.send(welcome(ident, { id: p.id }));
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
        p.next = pickFrom(msg) ?? DEFAULT_PICK;
        p.joined = true;
        send(p, { t: 'cvars', cv: cvars.publicPairs() });
        send(p, flock.state(true));
        if (moreOpen) send(p, { t: 'more', k: 'now' });
        serverLine(`${p.name} joined.`);
        if (phase === 'play') spawn(p);
        else p.respawnAt = 0;
      } else if (msg.t === 'st' && p.alive) {
        p.x = num(msg.x, -420, 420) ?? p.x;
        p.y = num(msg.y, -30, 30) ?? p.y;
        // Warwick Road goes 240 m north and south of the station.
        p.z = num(msg.z, -260, 260) ?? p.z;
        p.yaw = num(msg.yaw, -1e4, 1e4) ?? p.yaw;
        p.pitch = num(msg.pitch, -2, 2) ?? p.pitch;
        p.lean = num(msg.lean, -1, 1) ?? 0;
        p.lift = liftIndex(msg.lift);
        p.tx = msg.tx === undefined ? null : num(msg.tx, -100, 100);
        // The held weapon: a class of this life (or the knife or a
        // grenade), and any small model number.
        const w = Number(msg.w);
        const m = Number(msg.m);
        const ofLife =
          (w === p.pick.p[0] && !mopeds.stolen(p.id)) ||
          w === p.pick.s[0] ||
          w === KNIFE ||
          w === GRENADE;
        if (ofLife && Number.isInteger(m) && m >= 0 && m <= 255)
          p.held = [w, m];
      } else if (msg.t === 'fire') {
        onFire(p, msg);
      } else if (msg.t === 'shock' && p.alive && phase === 'play') {
        // The live rail far out along the lines (the client checks where).
        envDeath(p, 'LIVE RAIL');
      } else if (
        msg.t === 'die' &&
        p.alive &&
        phase === 'play' &&
        typeof msg.by === 'string' &&
        ENV_DEATHS.has(msg.by)
      ) {
        // An environment death that the client detects (a vape).
        envDeath(p, msg.by, msg.by);
      } else if (msg.t === 'loadout') {
        onLoadout(p, msg);
      } else if (msg.t === 'nade') {
        onNade(p, msg);
      } else if (msg.t === 'blast') {
        onBlast(p, msg);
      } else if (msg.t === 'pong') {
        onPong(p.ping, msg.n, Date.now());
      } else if (msg.t === 'rcon') {
        onRcon(p, msg);
      } else if (msg.t === 'chat' && p.joined) {
        onChat(p, msg);
      } else if (msg.t === 'use') {
        const i = Number(msg.i);
        const level = Number(msg.l);
        if (!p.alive || !(i in lifts) || !(level === 0 || level === 1)) return;
        callLift(lifts[i], level);
        broadcast({ t: 'lift', i, l: level });
      } else if (msg.t === 'gate') {
        onGate(p, msg);
      } else if (msg.t === 'more') {
        onMore(p, msg);
      } else if (msg.t === 'rm') {
        onRoadman(p, msg);
      } else if (msg.t === 'mp') {
        onMoped(p, msg);
      } else if (msg.t === 'pg' && p.joined) {
        for (const o of flock.onMessage(p.id, msg, Date.now())) {
          if (o.to === 'sender') send(p, o.msg);
          else broadcast(o.msg, o.to === 'others' ? p.id : undefined);
        }
      }
    },
    close(ws) {
      const p = players.get(ws.data.id);
      players.delete(ws.data.id);
      for (const m of flock.leave(ws.data.id)) broadcast(m);
      if (roadmen.chasing(ws.data.id))
        broadcast({ t: 'rm', k: 'off', id: ws.data.id });
      roadmen.end(ws.data.id);
      for (const o of mopeds.end(ws.data.id)) broadcast(o.msg);
      if (p?.joined && !shutdown.stopping()) serverLine(`${p.name} left.`);
    },
  },
});

// A planned stop: a bye to each player first (session.ts).
const shutdown = stopOnSignal(
  () => [...players.values()].map((p) => p.ws),
  () => server.stop(),
  log,
);

log(
  `build ${ident.build}, protocol ${ident.protocol}, instance ${ident.instance}`,
);
console.log(`action: http://localhost:${server.port} (lobby on /api/ws)`);
