// The sound of the deep train: utils/tube-sounds drives a 1973 Stock train
// (Piccadilly line) from the game state. The game calls jsTubeTrain on each
// tick (game/src/train_sound.zig). This file gives the function to the wasm
// import module "env" (boot.ts).
//
// - The AudioContext starts on the first click, touch or key press. A
//   browser starts audio only after a user gesture.
// - The page makes the station and the train on the first call with a level
//   above 0. A player who never goes to the deep level costs no nodes.
// - After 3 s of silence the context stops. It continues at the next
//   level above 0. The page catches every error. Without Web Audio the
//   game runs with no train sound.

import {
  STOCK_1973,
  type StockSpec,
  TubeStation,
  TubeTrain,
} from 'tube-sounds';

/**
 * One unit of the 1973 Stock: driving motor car, trailer, motor car,
 * 52.8 m. The game train is 60 m long, and a 6-car train (106 m) does
 * not fit the platform. Three cars also halve the audio nodes.
 */
const UNIT_1973: StockSpec = {
  ...STOCK_1973,
  cars: STOCK_1973.cars.slice(0, 3),
};

/** The deep platform of Earl's Court on the track x axis (-X in the game). */
const PLATFORM_START = -60;
const PLATFORM_LENGTH = 60;
/** The station master level at a game volume of 1. */
const MASTER = 0.8;
/** The door warning before the doors move, s (train_sound.zig). */
const DOOR_WARNING = 2;
/** The largest error of the train position before a jump, m. */
const MAX_DRIFT = 4;
/** Silence after which the context stops, s. */
const IDLE_STOP = 3;

let ctx: AudioContext | null = null;
let station: TubeStation | null = null;
let train: TubeTrain | null = null;
let failed = false;
let doorsOpen = false;
let volume = -1;
let fade = -1;
let silentSince = 0;

function fail(err: unknown): void {
  failed = true;
  console.warn('[action] train sound off:', err);
  try {
    ctx?.close();
  } catch {
    // The context is gone already.
  }
  ctx = null;
  station = null;
  train = null;
}

function onGesture(): void {
  if (failed) return;
  try {
    if (!ctx) {
      if (typeof AudioContext === 'undefined') {
        failed = true;
        return;
      }
      ctx = new AudioContext();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch (err) {
    fail(err);
  }
}
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, onGesture, { capture: true, passive: true });
}

function build(c: AudioContext): void {
  station = new TubeStation(c, {
    geometry: {
      platformStart: PLATFORM_START,
      platformLength: PLATFORM_LENGTH,
    },
    ambient: 0.6,
    volume: 0,
  });
  station.output.connect(c.destination);
  train = new TubeTrain(station, { stock: UNIT_1973 });
  volume = 0;
  fade = 1;
}

/**
 * The train state and the listener for this tick, on the track x axis of
 * tube-sounds. game/src/train_sound.zig gives the meaning of each value.
 */
function jsTubeTrain(
  front: number,
  speed: number,
  throttle: number,
  brake: number,
  doors: number,
  lx: number,
  lateral: number,
  rx: number,
  rlat: number,
  level: number,
  trainLevel: number,
): undefined {
  const c = ctx;
  if (failed || !c) return undefined;
  try {
    const now = performance.now() / 1000;
    if (level > 0) silentSince = now;
    if (!station) {
      if (level <= 0) return undefined;
      build(c);
    }
    const s = station;
    const t = train;
    if (!s || !t) return undefined;

    if (level <= 0 && now - silentSince > IDLE_STOP) {
      if (c.state === 'running') void c.suspend().catch(() => {});
    } else if (level > 0 && c.state === 'suspended') {
      void c.resume().catch(() => {});
    }

    const g = s.geometry.listener;
    g.x = lx;
    g.lateral = lateral;
    g.right = { x: rx, lateral: rlat };

    if (Math.abs(level - volume) > 0.001) {
      volume = level;
      s.setVolume(MASTER * level);
    }
    if (Math.abs(trainLevel - fade) > 0.001) {
      fade = trainLevel;
      t.setLevel(trainLevel);
    }

    t.setSpeed(speed);
    t.setThrottle(throttle);
    t.setBrake(brake);
    // The station clock runs `latency` ahead of the audio clock. The
    // library moves the train itself. Correct it only after a jump (a new
    // train, a server clock step, a stopped context).
    const target = front + speed * s.latency;
    if (Math.abs(t.state.frontX - target) > MAX_DRIFT) t.setPosition(target);

    const open = doors > 0.5;
    if (open !== doorsOpen) {
      doorsOpen = open;
      if (open) t.doorsOpen();
      else t.doorsClose({ warning: DOOR_WARNING });
    }

    s.tick();
  } catch (err) {
    fail(err);
  }
  return undefined;
}

/** The functions for the wasm import module "env" (loader option `env`). */
export const tubeImports = { jsTubeTrain };
