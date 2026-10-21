// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE-Chromium file in this directory.
//
// Theme + sprite registry — adapted from Chromium's
//   components/neterror/resources/dino_game/offline_sprite_definitions.ts
//   components/neterror/resources/images/default_200_percent/offline/200-offline-sprite.png
//
// ──────────────────────────────────────────────────────────────────────
//  HOW THIS WORKS
// ──────────────────────────────────────────────────────────────────────
// Every theme starts from a sprite sheet:
//   - sheetUrl   : the PNG
//   - scale      : sheet px per logical px (2 for the HDPI sheet)
//   - positions  : SHEET-SPACE (x, y) of each sprite GROUP. These are in
//                  the sheet's native pixels, so `scale` does not apply.
//
// Each entry in `SPRITES` describes a single drawable in LOGICAL
// (1×) coordinates: its group, its sub-offset within the group
// (`frameX`, `frameY`), and its width / height. The sheet UV is:
//
//   sx = positions[group].x + frameX * scale
//   sy = positions[group].y + frameY * scale
//   sw = width  * scale
//   sh = height * scale
//
// A theme can also replace any sprite with standalone cutout PNGs
// (`cutouts`). A cutout's size comes from its image, so a photo of any
// aspect ratio works.
//
// `loadTheme` resolves every sprite to `Frame`s: an image, a source
// rect, a drawn size and collision boxes. The collision boxes come from
// the opaque pixels of each frame, so no sprite needs hand-made boxes.
// Add `?hitboxes` to the URL to draw them.
//
// The canvas stays at 600 × 150 logical px for every theme.
//
// ──────────────────────────────────────────────────────────────────────
//  ADDING A CUTOUT
// ──────────────────────────────────────────────────────────────────────
// 1. Cut the subject out of the photo. Keep a transparent background
//    and crop tight. Drop the PNG in ./assets/cous/.
// 2. Import it below and add it to the `cutouts` of the cous theme.
// 3. Set `scale` until the size looks right. Use `scaleY` to squash.
//
// The Cous photo cutouts are exported at 4 image px per logical px
// (`scale: 4`). The canvas backing store follows the displayed size and
// the device pixel ratio, so that detail reaches the screen.
//
// Some PNGs are not imported: the 1× sheets, the first cous sheet and
// the full-stretch duck (cous/cous-duck.png). They stay in the repo for
// reference.

import chromium200Url from './assets/chromium-200-offline-sprite.png';
import cat1Url from './assets/cous/cat-1.png';
import cat2Url from './assets/cous/cat-2.png';
import cousBlinkUrl from './assets/cous/cous-blink.png';
import cousCrashUrl from './assets/cous/cous-crash.png';
import cousJumpUrl from './assets/cous/cous-jump.png';
import cousRun1Url from './assets/cous/cous-run-1.png';
import cousRun2Url from './assets/cous/cous-run-2.png';
import cousSupermanUrl from './assets/cous/cous-superman.png';
import cousTreeUrl from './assets/cous/cous-tree.png';
import cousWashingMachineUrl from './assets/cous/cous-washing-machine.png';
import palmLarge1Url from './assets/cous/palm-large-1.png';
import palmLarge2Url from './assets/cous/palm-large-2.png';
import palmLarge3Url from './assets/cous/palm-large-3.png';
import palmLarge4Url from './assets/cous/palm-large-4.png';
import palmLarge5Url from './assets/cous/palm-large-5.png';
import palmLarge6Url from './assets/cous/palm-large-6.png';
import palmSmall1Url from './assets/cous/palm-small-1.png';
import palmSmall2Url from './assets/cous/palm-small-2.png';
import palmSmall3Url from './assets/cous/palm-small-3.png';
import palmSmall4Url from './assets/cous/palm-small-4.png';
import palmSmall5Url from './assets/cous/palm-small-5.png';
import palmSmall6Url from './assets/cous/palm-small-6.png';

/**
 * Game canvas dimensions (CSS / logical px). The horizon sprite must be
 * exactly `WIDTH` wide so it tiles seamlessly.
 */
export const CANVAS = {
  WIDTH: 600,
  HEIGHT: 150,
  /** Y of the ground line. */
  GROUND_Y: 127,
  /** Y where the player and ground obstacles put their bottom edge. */
  FLOOR_Y: 140,
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

/** A cutout variant with its own scale. */
export type CutoutVariant = { url: string; scale: number };

/** Standalone PNGs that replace one sprite of the sheet. */
export type Cutout = {
  /**
   * One PNG per variant. Each obstacle copy, and each change of player
   * pose, picks one at random. A variant can set its own scale.
   */
  urls: (string | CutoutVariant)[];
  /** Image px per logical px. A larger value draws the cutout smaller. */
  scale: number;
  /** Vertical image px per logical px. Default: `scale`. */
  scaleY?: number;
};

export type SpriteTheme = {
  /** Human-readable name for the dropdown. */
  label: string;
  /** URL of the PNG (RSBuild hashes this in production). */
  sheetUrl: string;
  /** Sheet px per logical px. */
  scale: number;
  /** Sheet-space (x, y) of every sprite group. */
  positions: SpritePositions;
  /** Sprites drawn from cutout PNGs instead of the sheet. */
  cutouts?: Partial<Record<SpriteName, Cutout>>;
};

const chromiumSheet = {
  sheetUrl: chromium200Url,
  scale: 2,
  // Verbatim from offline_sprite_definitions.ts → spriteDefinitionByType.original.hdpi
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
};

/** A Cous photo cutout, exported at 4 image px per logical px. */
const cous = (url: string): Cutout => ({ urls: [url], scale: 4 });

/**
 * The available sprite themes. The dropdown in `cous.tsx` exposes one
 * &lt;option&gt; per key.
 */
export const SPRITE_THEMES = {
  cous: {
    label: 'Cous',
    ...chromiumSheet,
    cutouts: {
      trexIdle: cous(cousRun1Url),
      trexBlink: cous(cousBlinkUrl),
      trexRun1: cous(cousRun1Url),
      trexRun2: cous(cousRun2Url),
      trexJump: { urls: [cousJumpUrl, cousSupermanUrl], scale: 4 },
      trexCrash: cous(cousCrashUrl),
      // The crouch from the first cous sheet, at its sheet scale.
      trexDuck1: { urls: [cat1Url], scale: 2 },
      trexDuck2: { urls: [cat2Url], scale: 2 },
      // The washing machine porthole: a spin cycle to restart.
      restart: cous(cousWashingMachineUrl),
      cactusSmall: {
        urls: [
          palmSmall1Url,
          palmSmall2Url,
          palmSmall3Url,
          palmSmall4Url,
          palmSmall5Url,
          palmSmall6Url,
        ],
        scale: 2,
      },
      cactusLarge: {
        urls: [
          palmLarge1Url,
          palmLarge2Url,
          palmLarge3Url,
          palmLarge4Url,
          palmLarge5Url,
          palmLarge6Url,
          // Cous up a cordyline, cut out with scripts/skykey.py.
          { url: cousTreeUrl, scale: 4 },
        ],
        scale: 2,
      },
    },
  },
  classic: {
    label: 'Classic',
    ...chromiumSheet,
  },
} as const satisfies Record<string, SpriteTheme>;

export type SpriteThemeId = keyof typeof SPRITE_THEMES;

export const DEFAULT_THEME_ID: SpriteThemeId = 'cous';

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
  trexJump: {
    group: 'tRex',
    frameX: 0,
    width: 44,
    height: 47,
    description:
      'T-Rex in the air. The sheet uses the trexIdle art. A theme can give it its own cutout.',
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

/** A rectangle in logical px, relative to the top-left of its frame. */
export type Box = { x: number; y: number; width: number; height: number };

/** One sprite, resolved and ready to draw. */
export type Frame = {
  image: HTMLImageElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Drawn width in logical px. */
  width: number;
  /** Drawn height in logical px. */
  height: number;
  /** Collision boxes, from the opaque pixels of the frame. */
  boxes: Box[];
  /** True for photo cutouts. Sheet pixel art draws without smoothing. */
  smooth: boolean;
};

export type LoadedTheme = {
  theme: SpriteTheme;
  sheet: HTMLImageElement;
  /** Every sprite, with one frame per variant. */
  frames: Record<SpriteName, Frame[]>;
};

/** Rows of logical px in each collision box. */
const BOX_BAND = 4;
/** Alpha above this value is solid for collisions. */
const BOX_ALPHA = 128;

/**
 * Makes collision boxes from the opaque pixels of a frame. The frame is
 * cut into horizontal bands of `BOX_BAND` rows. Each band gets one box
 * from its leftmost to its rightmost opaque pixel.
 */
function computeBoxes(
  image: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  width: number,
  height: number,
): Box[] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [{ x: 0, y: 0, width, height }];
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const boxes: Box[] = [];
  for (let top = 0; top < height; top += BOX_BAND) {
    const bottom = Math.min(top + BOX_BAND, height);
    let left = width;
    let right = -1;
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > BOX_ALPHA) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (right >= left) {
      boxes.push({
        x: left,
        y: top,
        width: right - left + 1,
        height: bottom - top,
      });
    }
  }
  return boxes;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error(`cous: failed to load sprite image at ${url}`));
    img.src = url;
  });
}

function sheetFrame(
  sheet: HTMLImageElement,
  theme: SpriteTheme,
  name: SpriteName,
): Frame {
  const s = SPRITES[name] as Sprite;
  const groupPos = theme.positions[s.group];
  const sx = groupPos.x + (s.frameX ?? 0) * theme.scale;
  const sy = groupPos.y + (s.frameY ?? 0) * theme.scale;
  const sw = s.width * theme.scale;
  const sh = s.height * theme.scale;
  return {
    image: sheet,
    sx,
    sy,
    sw,
    sh,
    width: s.width,
    height: s.height,
    boxes: computeBoxes(sheet, sx, sy, sw, sh, s.width, s.height),
    smooth: false,
  };
}

function cutoutFrame(
  image: HTMLImageElement,
  scale: number,
  scaleY: number,
): Frame {
  const width = Math.round(image.naturalWidth / scale);
  const height = Math.round(image.naturalHeight / scaleY);
  const sw = image.naturalWidth;
  const sh = image.naturalHeight;
  return {
    image,
    sx: 0,
    sy: 0,
    sw,
    sh,
    width,
    height,
    boxes: computeBoxes(image, 0, 0, sw, sh, width, height),
    smooth: true,
  };
}

/**
 * Loads a theme's sheet and cutouts, and resolves every sprite to its
 * frames. Rejects if an image fails to load.
 */
export async function loadTheme(theme: SpriteTheme): Promise<LoadedTheme> {
  const cutouts: Partial<Record<SpriteName, Cutout>> = theme.cutouts ?? {};
  const urls = new Set<string>([theme.sheetUrl]);
  const variantUrl = (v: string | CutoutVariant) =>
    typeof v === 'string' ? v : v.url;
  for (const cutout of Object.values(cutouts)) {
    for (const v of cutout?.urls ?? []) urls.add(variantUrl(v));
  }
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...urls].map(async (url) => images.set(url, await loadImage(url))),
  );
  const sheet = images.get(theme.sheetUrl) as HTMLImageElement;

  const frames = {} as Record<SpriteName, Frame[]>;
  for (const name of Object.keys(SPRITES) as SpriteName[]) {
    const cutout = cutouts[name];
    frames[name] = cutout
      ? cutout.urls.map((v) => {
          const scale = typeof v === 'string' ? cutout.scale : v.scale;
          const scaleY =
            typeof v === 'string' ? (cutout.scaleY ?? scale) : scale;
          return cutoutFrame(
            images.get(variantUrl(v)) as HTMLImageElement,
            scale,
            scaleY,
          );
        })
      : [sheetFrame(sheet, theme, name)];
  }
  return { theme, sheet, frames };
}
