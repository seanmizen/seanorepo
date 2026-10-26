// autosam morph.
//
// Where: index.html loads this module. It sets window.autosamMorph, and
// theme.js calls it with the function that applies the new theme.
// When: once for each theme or mode change. The page must be static during
// the morph. A scroll or a resize ends it.
// Why: one font cannot interpolate into another in CSS. The glyph methods
// draw each visible character on a WebGL layer, and change each glyph from
// its old shape, place, size and color to the new ones.
//
// The modules:
// - morph.js: the methods, the clock, and the steps below.
// - morph-page.js: reads the page, and holds the boxes and the tokens.
// - morph-field.js: rasterizes the glyphs into distance fields.
// - morph-flow.js: aligns each glyph pair and moves its ink.
// - morph-gl.js: the WebGL layer.
// - morph-debug.js: the debug panel. ?debug=true in the URL loads it.
//
// The steps of a glyph method:
// 1. Read each character: its box, font, color, opacity and clip.
// 2. Apply the new theme with transitions off, and read the same again.
// 3. Put back the old theme. Make the fields and the flows, and fill the
//    WebGL buffers.
// 4. Hide the real text and show the layer. Apply the new theme with
//    transitions off. Paused animations hold each token (colors, radii,
//    shadows) and each box size at its old value.
// 5. Over --morph, one clock moves the glyphs, the tokens and the boxes from
//    old to new. Then remove the layer and the animations, and show the text.
//
// Pixel for pixel: the first frame must be the old page and the last frame
// the new page, or the text jumps when the layer comes or goes. So:
// - Each glyph is rasterized in its own color, at the subpixel phase of its
//   place on the page, as the browser rasterizes it.
// - The cell of a glyph sits on whole device pixels at each end of the
//   morph, so each texel lands on one screen pixel.
// - The field is a float, and the edge uses the known scale of the field. At
//   the ends the coverage of each pixel is the coverage of the raster.
// - The baseline comes from layout, not from font metrics.

import { buildAtlas, cellEm, place } from './morph-field.js';
import { buildFlows, demons, edges } from './morph-flow.js';
import {
  draw,
  FLOATS,
  layer,
  maxTextureSize,
  release,
  setup,
  upload,
} from './morph-gl.js';
import {
  boxes,
  morphBoxes,
  morphTokens,
  snapshot,
  tokenNames,
  tokenValues,
} from './morph-page.js';

const root = document.documentElement;

// The settings. The debug panel changes them. Distances are in em.
const params = {
  // The method: a key of METHODS.
  method: 'edges',
  // edges: the extra cost of a match between edges that face opposite ways.
  normalWeight: 0.1,
  // edges, demons: the smoothing of the flow (a Gaussian sigma).
  sigma: 0.03,
  // demons: the number of steps, and the largest move in one step.
  iterations: 20,
  step: 0.02,
  // demons: contours further than this from both edges move less.
  band: 0.2,
  // edges, demons: the flow grid, in points for each em.
  flowRes: 32,
  // edges, demons: glyphs smaller than this (CSS px) at both ends get no
  // flow. The alignment is enough for them, and a flow costs time.
  minSize: 18,
  // Hold the morph at time t (0 to 1).
  hold: false,
  t: 0.5,
};

// cubic-bezier(0.4, 0, 0.2, 1), the same curve as EASING in morph-page.js.
function ease(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bz = (a, b, t) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 24; i++) {
    if (bz(0.4, 0.2, t) < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bz(0, 1, t);
}

const duration = () => {
  const v = getComputedStyle(root).getPropertyValue('--morph').trim();
  const n = Number.parseFloat(v) || 0;
  return v.endsWith('ms') ? n : n * 1000;
};

const flush = () => getComputedStyle(root).getPropertyValue('--bg');

const setData = (data) => {
  for (const k of Object.keys(root.dataset))
    if (!(k in data)) delete root.dataset[k];
  Object.assign(root.dataset, data);
};

// Pair the two snapshots, and keep the glyphs that show in either one.
function pairs(before, after) {
  const vh = innerHeight;
  const vw = innerWidth;
  const seen = (g) => g.bottom > 0 && g.top < vh && g.x < vw;
  const out = [];
  for (const [node, listA] of before) {
    const listB = after.get(node);
    if (!listB) continue;
    listA.forEach((a, i) => {
      const b = listB[i];
      if (b && (seen(a) || seen(b))) out.push([a, b]);
    });
  }
  return out;
}

// ---------- The clock ----------

let active = null;

// End the morph at once. Each part of it takes its end value.
function finish() {
  if (!active) return;
  const { raf, end, done } = active;
  active = null;
  cancelAnimationFrame(raf);
  removeEventListener('scroll', finish);
  removeEventListener('resize', finish);
  end();
  done();
}

// One clock for every part of a morph. at(x) shows time x, from 0 to 1.
// end() puts every part at its end value. The first frame after the theme
// change is slow (style, layout and paint of the whole page). The clock
// starts on the frame after it, so nothing jumps ahead. The debug panel can
// hold the clock at a time. When the hold ends, the clock goes on from that
// time. Resolves when the morph ends.
function run(ms, at, end) {
  let start = null;
  let frames = 0;
  const frame = (now) => {
    if (start === null) {
      if (frames++ < 1) {
        active.raf = requestAnimationFrame(frame);
        return;
      }
      start = now;
    }
    let x = Math.min(1, (now - start) / ms);
    if (params.hold) {
      x = params.t;
      start = now - x * ms;
    }
    at(x);
    if (x < 1 || params.hold) active.raf = requestAnimationFrame(frame);
    else finish();
  };
  const ended = new Promise((resolve) => {
    active = { raf: requestAnimationFrame(frame), end, done: resolve };
  });
  addEventListener('scroll', finish, { passive: true });
  addEventListener('resize', finish);
  return ended;
}

// ---------- The methods ----------

// A glyph method. way.align aligns the ink boxes of each pair, way.flow is
// the matcher (or null), and way.blur is the blur halfway, in em.
async function glyphs(apply, ms, way) {
  if (!setup()) {
    apply();
    return;
  }
  if (document.fonts.status === 'loading') await document.fonts.ready;
  const t0 = performance.now();

  // Transitions off from here to the end. A press during a morph then starts
  // from the end of the last morph, not from a token between values.
  const names = tokenNames();
  root.classList.add('morph-measure');
  flush();
  const old = { ...root.dataset };
  const before = snapshot();
  const boxesBefore = boxes();
  const tokensBefore = tokenValues(names);
  apply();
  let after = snapshot();
  let boxesAfter = boxes();
  let tokensAfter = tokenValues(names);
  if (document.fonts.status === 'loading') {
    // The new theme asked for a font that is not loaded yet. Wait, and read
    // again.
    setData(old);
    flush();
    await document.fonts.ready;
    apply();
    after = snapshot();
    boxesAfter = boxes();
    tokensAfter = tokenValues(names);
  }
  setData(old);
  flush();

  const list = pairs(before, after);
  const dpr = devicePixelRatio || 1;
  const t1 = performance.now();
  const entries = new Map();
  for (const pair of list) {
    for (const g of pair) {
      place(g, dpr);
      if (!entries.has(g.key)) {
        const { ch, font, size, phase, fill } = g;
        entries.set(g.key, { ch, font, size, phase, fill });
      }
    }
  }
  const atlas = buildAtlas(entries.values(), dpr, maxTextureSize());
  if (!atlas || list.length === 0) {
    root.classList.remove('morph-measure');
    apply();
    return;
  }
  const t2 = performance.now();

  // One flow for each pair of atlas entries.
  const flows = new Map();
  for (const [a, b] of list) {
    const key = `${a.key}>${b.key}`;
    if (!flows.has(key)) {
      flows.set(key, { A: entries.get(a.key), B: entries.get(b.key) });
    }
  }
  const flow = buildFlows(flows.values(), atlas, maxTextureSize(), way, params);

  const data = new Float32Array(list.length * FLOATS);
  list.forEach(([a, b], i) => {
    const ca = entries.get(a.key);
    const cb = entries.get(b.key);
    const f = flows.get(`${a.key}>${b.key}`);
    const differ = a.font !== b.font || a.ch !== b.ch ? 1 : 0;
    data.set(
      [
        a.x,
        a.baseline,
        b.x,
        b.baseline,
        a.size,
        b.size,
        differ,
        0,
        ...cellEm(a, ca, dpr),
        ...ca.uv,
        ...cellEm(b, cb, dpr),
        ...cb.uv,
        ...a.color,
        ...b.color,
        ...a.clip,
        ...b.clip,
        ...f.M,
        ...f.rect,
        ...f.uv,
      ],
      i * FLOATS,
    );
  });

  const canvas = layer();
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  const scene = {
    ...upload(atlas, flow, data, list.length),
    vw: innerWidth,
    vh: innerHeight,
    dpr,
    blur: way.blur,
  };
  draw(scene, 0);
  const t3 = performance.now();
  stats({
    glyphs: list.length,
    shapes: entries.size,
    flows: [...flows.values()].filter((f) => f.g).length,
    readMs: Math.round(t1 - t0),
    atlasMs: Math.round(t2 - t1),
    flowMs: Math.round(t3 - t2),
  });
  document.body.append(canvas);
  root.classList.add('morphing');
  apply();
  const anims = [
    morphTokens(names, tokensBefore, tokensAfter, ms),
    ...morphBoxes(boxesBefore, boxesAfter, ms),
  ];

  return run(
    ms,
    (x) => {
      draw(scene, ease(x));
      for (const anim of anims) anim.currentTime = x * ms;
    },
    () => {
      // Each animation goes, so each box and token takes its own value: the
      // value of the new theme. Then the transitions come back on, with no
      // value left to move.
      for (const anim of anims) anim.cancel();
      flush();
      root.classList.remove('morph-measure', 'morphing');
      canvas.remove();
      release(scene);
    },
  );
}

// The first morph. The browser takes a picture of the old page and
// cross-fades it into the live new page (a view transition). The tokens
// move under it with their CSS transitions. Fonts do not morph. The view
// transition and the transitions are paused animations on the same clock as
// the glyph methods, so the hold works here too.
async function crossfade(apply, ms) {
  if (!document.startViewTransition) {
    apply();
    return;
  }
  const vt = document.startViewTransition(apply);
  try {
    await vt.ready;
  } catch {
    // The browser skipped the transition. The new theme is on.
    return;
  }
  stats({});
  const anims = document
    .getAnimations()
    .filter((a) => a.effect?.target === root);
  for (const anim of anims) anim.pause();
  return run(
    ms,
    (x) => {
      for (const anim of anims) anim.currentTime = x * ms;
    },
    () => {
      for (const anim of anims) anim.finish();
    },
  );
}

// The ways to morph the page, newest first. The debug panel shows the
// names.
const METHODS = {
  // A glyph morph that moves the ink. Each glyph pair aligns its ink
  // boxes, then the old shape moves along a flow toward the new shape.
  // Edges and demons give the same shapes, and edges is faster.
  edges: (apply, ms) =>
    glyphs(apply, ms, { align: true, flow: edges, blur: 0 }),
  demons: (apply, ms) =>
    glyphs(apply, ms, { align: true, flow: demons, blur: 0 }),
  // The first glyph morph. Each pixel blends the two fields, and a blur
  // halfway smooths the creases. Thin strokes lose ink at mid-morph, and
  // ink grows where the two glyphs do not overlap.
  blend: (apply, ms) =>
    glyphs(apply, ms, { align: false, flow: null, blur: 0.06 }),
  crossfade,
};

// ---------- Entry ----------

// The theme data of the last morph, for a replay.
let last = null;

// The debug panel shows the stats of each morph.
function stats(s) {
  morph.stats = { method: params.method, ...s };
  dispatchEvent(new CustomEvent('autosam-morph-stats'));
}

// Resolves when the morph ends, or at once when there is no morph.
async function morph(apply) {
  finish();
  const from = { ...root.dataset };
  const change = () => {
    apply();
    last = { from, to: { ...root.dataset } };
  };
  const ms = duration();
  const method = METHODS[params.method];
  if (ms <= 0 || !method) {
    change();
    return;
  }
  return method(change, ms);
}

// Morph from the last old theme to the last new theme again. The debug
// panel calls this when a setting changes. The old theme goes back with
// transitions off, so only the morph moves the page.
function replay() {
  if (!last) return;
  const { from, to } = last;
  finish();
  root.classList.add('morph-measure');
  setData(from);
  flush();
  root.classList.remove('morph-measure');
  morph(() => setData(to));
}

morph.params = params;
morph.methods = Object.keys(METHODS);
morph.replay = replay;
window.autosamMorph = morph;

if (new URLSearchParams(location.search).get('debug') === 'true') {
  import('./morph-debug.js');
}
