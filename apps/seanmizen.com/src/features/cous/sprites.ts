// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-Chromium file in this directory.
//
// Theme + sprite registry — adapted from Chromium's
//   components/neterror/resources/dino_game/offline_sprite_definitions.ts
//   components/neterror/resources/images/default_100_percent/offline/100-offline-sprite.png
//   components/neterror/resources/images/default_200_percent/offline/200-offline-sprite.png
//
// ──────────────────────────────────────────────────────────────────────
//  HOW THIS WORKS
// ──────────────────────────────────────────────────────────────────────
// One sprite sheet per `SpriteTheme`. Each theme has:
//   - sheetUrl   : the PNG (1× or 2× density)
//   - scale      : 1 for LDPI, 2 for HDPI — the renderer multiplies
//                  frame offsets and source-pixel sizes by this.
//   - positions  : SHEET-SPACE (x, y) coordinates of each sprite GROUP
//                  (e.g. tRex, cactusLarge, textSprite). These are
//                  already in the sheet's native pixel space, so they
//                  are NOT scaled by `scale`.
//
// Each entry in `SPRITES` describes a single drawable in LOGICAL
// (1×) coordinates: which group it belongs to, its sub-offset within
// the group (`frameX`, `frameY`), and its width / height. The renderer
// composes the final sheet UV as:
//
//   sx = positions[group].x + frameX * scale
//   sy = positions[group].y + frameY * scale
//   sw = width  * scale
//   sh = height * scale
//
// Destination size on the canvas is always (width, height) — the canvas
// stays at 600 × 150 logical px regardless of which theme is chosen.
//
// ──────────────────────────────────────────────────────────────────────
//  ADDING YOUR OWN SHEET
// ──────────────────────────────────────────────────────────────────────
// Drop your PNG in ./assets/, import it below, and add an entry to
// `SPRITE_THEMES`. You'll need the (x, y) of each sprite group on your
// sheet — see the LDPI / HDPI tables below for examples. Width/heights
// are shared across themes (in `SPRITES`), so unless you change sprite
// dimensions you only need to fill in `positions`.

import chromium100Url from './assets/chromium-100-offline-sprite.png';
import chromium200Url from './assets/chromium-200-offline-sprite.png';
import cous100Url from './assets/cous-100-offline-sprite.png';
import cous200Url from './assets/cous-200-1.png';

/**
 * Game canvas dimensions (CSS / logical px). Keep in sync with the
 * `lines` config in `Horizon`. The horizon sprite must be exactly
 * `WIDTH` wide so it tiles seamlessly.
 */
export const CANVAS = {
  WIDTH: 600,
  HEIGHT: 150,
  /** Y of the ground line. Sprites with their feet at this Y land flush. */
  GROUND_Y: 127,
} as const;

/**
 * (x, y) of one sprite GROUP on the sheet. Already in sheet-native
 * pixel space (i.e. for the 2× sheet, these are 2× pixel coordinates).
 */
export type SpritePosition = { x: number; y: number };

export type SpritePositions = {
  cactusLarge: SpritePosition;
  cactusSmall: SpritePosition;
  cloud: SpritePosition;
  horizon: SpritePosition;
  pterodactyl: SpritePosition;
  restart: SpritePosition;
  textSprite: SpritePosition;
  tRex: SpritePosition;
};

export type SpriteTheme = {
  /** Human-readable name for the dropdown. */
  label: string;
  /** URL of the PNG (RSBuild hashes this in production). */
  sheetUrl: string;
  /** 1 for LDPI, 2 for HDPI. */
  scale: 1 | 2;
  /** Sheet-space (x, y) of every sprite group. */
  positions: SpritePositions;
};

/**
 * The available sprite themes. The dropdown in `cous.tsx` exposes one
 * &lt;option&gt; per key. Add a new entry here to make a new theme available.
 */
export const SPRITE_THEMES = {
  'chromium-1x': {
    label: 'Chromium 1x (LDPI)',
    sheetUrl: chromium100Url,
    scale: 1,
    // Verbatim from offline_sprite_definitions.ts → spriteDefinitionByType.original.ldpi
    positions: {
      cactusLarge: { x: 332, y: 2 },
      cactusSmall: { x: 228, y: 2 },
      cloud: { x: 86, y: 2 },
      horizon: { x: 2, y: 54 },
      pterodactyl: { x: 134, y: 2 },
      restart: { x: 2, y: 68 },
      textSprite: { x: 655, y: 2 },
      tRex: { x: 848, y: 2 },
    },
  },
  'chromium-2x': {
    label: 'Chromium 2x (HDPI)',
    sheetUrl: chromium200Url,
    scale: 2,
    // Verbatim from offline_sprite_definitions.ts → spriteDefinitionByType.original.hdpi
    // Note: NOT just 2× of LDPI — the 2× sheet was hand-packed tighter.
    positions: {
      cactusLarge: { x: 652, y: 2 },
      cactusSmall: { x: 446, y: 2 },
      cloud: { x: 166, y: 2 },
      horizon: { x: 2, y: 104 },
      pterodactyl: { x: 260, y: 2 },
      restart: { x: 2, y: 130 },
      textSprite: { x: 1294, y: 2 },
      tRex: { x: 1678, y: 2 },
    },
  },
  'cous-1x': {
    label: 'Cous 1x (LDPI)',
    sheetUrl: cous100Url,
    scale: 1,
    // Verbatim from offline_sprite_definitions.ts → spriteDefinitionByType.original.ldpi
    positions: {
      cactusLarge: { x: 332, y: 2 },
      cactusSmall: { x: 228, y: 2 },
      cloud: { x: 86, y: 2 },
      horizon: { x: 2, y: 54 },
      pterodactyl: { x: 134, y: 2 },
      restart: { x: 2, y: 68 },
      textSprite: { x: 655, y: 2 },
      tRex: { x: 848, y: 2 },
    },
  },
  'cous-2x': {
    label: 'Cous 2x (HDPI)',
    sheetUrl: cous200Url,
    scale: 2,
    // Verbatim from offline_sprite_definitions.ts → spriteDefinitionByType.original.hdpi
    // Note: NOT just 2× of LDPI — the 2× sheet was hand-packed tighter.
    positions: {
      cactusLarge: { x: 652, y: 2 },
      cactusSmall: { x: 446, y: 2 },
      cloud: { x: 166, y: 2 },
      horizon: { x: 2, y: 104 },
      pterodactyl: { x: 260, y: 2 },
      restart: { x: 2, y: 130 },
      textSprite: { x: 1294, y: 2 },
      tRex: { x: 1678, y: 2 },
    },
  },
} as const satisfies Record<string, SpriteTheme>;

export type SpriteThemeId = keyof typeof SPRITE_THEMES;

export const DEFAULT_THEME_ID: SpriteThemeId = 'chromium-2x';

/**
 * One drawable sprite. `frameX` / `frameY` are LOGICAL-pixel sub-offsets
 * within the parent group; `width` / `height` are the LOGICAL size of
 * the slice. The renderer multiplies these by `theme.scale` to read the
 * correct slice from the sheet.
 */
export type Sprite = {
  group: keyof SpritePositions;
  /** Logical-pixel X offset within the group (default 0). */
  frameX?: number;
  /** Logical-pixel Y offset within the group (default 0). */
  frameY?: number;
  width: number;
  height: number;
  description: string;
};

/**
 * Master sprite registry. All offsets and dimensions are logical (1×)
 * pixels — the renderer scales by the active theme's `scale` factor.
 *
 * Frame offsets (for trex / pterodactyl) come from animFrames in
 * trex.ts and obstacle.ts — they index into the horizontal strip that
 * starts at the group's position on the sheet.
 */
export const SPRITES = {
  // ── T-Rex (player) ────────────────────────────────────────────────
  // All trex frames live in the `tRex` group's horizontal strip.
  // Source row is 47 tall for every frame (including duck) — duck art
  // is anchored to the BOTTOM of its 47-row, with transparency above,
  // so the renderer doesn't need any vertical offset.
  trexIdle: {
    group: 'tRex',
    frameX: 0,
    width: 44,
    height: 47,
    description:
      'T-Rex standing still, eyes open. Used while waiting and during jumps.',
  },
  trexBlink: {
    group: 'tRex',
    frameX: 44,
    width: 44,
    height: 47,
    description:
      'T-Rex standing still, eyes closed. Alternated with trexIdle for blinking.',
  },
  trexRun1: {
    group: 'tRex',
    frameX: 88,
    width: 44,
    height: 47,
    description: 'T-Rex running, left leg forward.',
  },
  trexRun2: {
    group: 'tRex',
    frameX: 132,
    width: 44,
    height: 47,
    description: 'T-Rex running, right leg forward.',
  },
  trexCrash: {
    group: 'tRex',
    frameX: 220,
    width: 44,
    height: 47,
    description: 'T-Rex with X-eyes after colliding with an obstacle.',
  },
  trexDuck1: {
    group: 'tRex',
    frameX: 264,
    width: 59,
    height: 47,
    description:
      'T-Rex ducked, left leg forward. Source row is 47 tall (same as the standing frames) — ' +
      'put the dino art at the BOTTOM of the row, with transparent space above.',
  },
  trexDuck2: {
    group: 'tRex',
    frameX: 323,
    width: 59,
    height: 47,
    description:
      'T-Rex ducked, right leg forward. Same conventions as trexDuck1.',
  },

  // ── Obstacles ─────────────────────────────────────────────────────
  pterodactyl1: {
    group: 'pterodactyl',
    frameX: 0,
    width: 46,
    height: 40,
    description:
      'Flying pterodactyl, wings UP. Spawns once speed >= 8.5. Alternates with ' +
      'pterodactyl2 every ~167ms (6fps). Y-position is one of [100, 75, 50] — ' +
      'high lets you slide under, low forces a jump.',
  },
  pterodactyl2: {
    group: 'pterodactyl',
    frameX: 46,
    width: 46,
    height: 40,
    description: 'Flying pterodactyl, wings DOWN. Pair with pterodactyl1.',
  },
  cactusSmall: {
    group: 'cactusSmall',
    frameX: 0,
    width: 17,
    height: 35,
    description:
      'A single small cactus. The game may render 1, 2, or 3 of these side-by-side.',
  },
  cactusLarge: {
    group: 'cactusLarge',
    frameX: 0,
    width: 25,
    height: 50,
    description:
      'A single large cactus. The game may render 1, 2, or 3 of these side-by-side.',
  },

  // ── Background ────────────────────────────────────────────────────
  cloud: {
    group: 'cloud',
    width: 46,
    height: 14,
    description: 'A small fluffy cloud. Drifts right-to-left across the sky.',
  },
  horizon: {
    group: 'horizon',
    width: CANVAS.WIDTH, // 600 — the sheet has TWO 600-wide horizon variants side by side
    height: 12,
    description:
      'The ground line. Two 600-wide variants stacked horizontally on the sheet ' +
      '(flat + bumpy); the game tiles them and randomly picks a variant per swap.',
  },

  // ── UI (subset of the textSprite group) ──────────────────────────
  // textSprite is a "compound" group — digits live at frameY=0 and the
  // GAME OVER text lives at frameY=13 within the same group.
  gameOver: {
    group: 'textSprite',
    frameX: 0,
    frameY: 13,
    width: 191,
    height: 11,
    description: 'The "GAME OVER" text rendered as a single image.',
  },
  restart: {
    group: 'restart',
    width: 36,
    height: 32,
    description: 'The "circular arrow" restart icon shown after game over.',
  },
} as const satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;

/**
 * Digit strip — 10 cells (0-9) laid out left-to-right inside the
 * `textSprite` group. Used by the score / high-score meter.
 */
export type SpriteStrip = {
  group: keyof SpritePositions;
  frameX: number;
  frameY: number;
  cellWidth: number;
  cellHeight: number;
  frames: number;
  description: string;
};

export const DIGITS: SpriteStrip = {
  group: 'textSprite',
  frameX: 0,
  frameY: 0,
  cellWidth: 10,
  cellHeight: 13,
  frames: 10,
  description:
    'Digits 0-9 left-to-right inside the textSprite group. Each digit cell is ' +
    'cellWidth × cellHeight; the renderer indexes by cellWidth × digitValue.',
};

/**
 * Loads a theme's sheet into an HTMLImageElement, decoded and ready to
 * draw. Reject if decoding fails.
 */
export async function loadSpriteSheet(
  theme: SpriteTheme,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(`cous: failed to load sprite sheet at ${theme.sheetUrl}`),
      );
    img.src = theme.sheetUrl;
  });
}
