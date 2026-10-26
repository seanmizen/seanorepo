// autosam glyph morph.
//
// Where: index.html loads this module. It sets window.autosamMorph, and
// theme.js calls it with the function that applies the new theme.
// When: once for each theme or mode change. The page must be static during
// the morph. A scroll or a resize ends it.
// Why: one font cannot interpolate into another in CSS. This file draws each
// visible character on a WebGL layer, and changes each glyph from its old
// shape, place, size and color to the new ones. Each glyph is a signed
// distance field (SDF): an image where each pixel holds its distance to the
// glyph edge.
//
// A blend of two fields at each pixel moves no ink. Where the two glyphs do
// not overlap, ink fades in one place and grows in another. So the ink
// moves first, then the blend:
// - Align: the ink box of the old glyph moves and scales onto the ink box
//   of the new glyph.
// - Flow: a field of vectors for each glyph pair. It tells each point of the
//   new glyph where its ink is in the old glyph. Over the morph the old
//   glyph moves along the vectors and the new glyph comes back along them.
//   At each time the two shapes almost agree, so the blend keeps the ink.
//
// The steps:
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

// The distance that a field holds on each side of the edge, in em.
const R_EM = 0.3;
// The settings of the flow. The debug panel (?debug=morph) changes them.
// Distances are in em.
const params = {
  // Align the ink boxes of each pair before the flow.
  align: true,
  // 'demons': each point moves along the field gradient (the edge normal)
  // by the difference of the two fields. Every contour moves, also the
  // contours in the void, so a counter moves as a counter.
  // 'edges': each edge point goes to the nearest edge point of the other
  // glyph that faces the same way. A smooth field fills the space between.
  // 'none': no flow. The blend only.
  matcher: 'demons',
  // edges: the extra cost of a match between edges that face opposite ways.
  normalWeight: 0.1,
  // The smoothing of the flow (a Gaussian sigma).
  sigma: 0.03,
  // demons: the number of steps, and the largest move in one step.
  iterations: 20,
  step: 0.02,
  // demons: contours further than this from both edges move less.
  band: 0.2,
  // The flow grid, in points for each em.
  flowRes: 32,
  // Glyphs smaller than this (CSS px) at both ends get no flow. The
  // alignment is enough for them, and a flow costs time.
  minSize: 18,
  // Hold the morph at time t (0 to 1).
  hold: false,
  t: 0.5,
};
// The browser places glyphs on quarter pixels. This file rasterizes on the
// same grid.
const SUBPIXEL = 4;
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
]);
const INF = 1e20;
const root = document.documentElement;

// ---------- Read the page ----------

const COLOR_RE = /rgba?\(([^)]+)\)/g;
// "rgb(r, g, b)", "rgba(r, g, b, a)" or "color(srgb r g b / a)" to 0..1.
const parseColor = (s) => {
  const p = s
    .slice(s.indexOf('(') + 1, s.indexOf(')'))
    .replace('srgb', '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  const k = s.startsWith('color(') ? 1 : 255;
  return [p[0] / k, p[1] / k, p[2] / k, p.length > 3 ? p[3] : 1];
};
const cssColor = (c) =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;

function readStyle(el, cache) {
  if (cache.has(el)) return cache.get(el);
  const cs = getComputedStyle(el);
  let st = null;
  if (cs.visibility === 'visible' && rendered(el)) {
    let opacity = 1;
    const clip = [0, 0, innerWidth, innerHeight];
    for (let e = el; e && e !== root; e = e.parentElement) {
      const s = e === el ? cs : getComputedStyle(e);
      opacity *= Number(s.opacity);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const r = e.getBoundingClientRect();
        clip[0] = Math.max(clip[0], r.left);
        clip[1] = Math.max(clip[1], r.top);
        clip[2] = Math.min(clip[2], r.right);
        clip[3] = Math.min(clip[3], r.bottom);
      }
    }
    const size = Number.parseFloat(cs.fontSize);
    const color = parseColor(cs.color);
    const bgClip = cs.backgroundClip || cs.webkitBackgroundClip;
    // The layer must paint what the page paints, or the page jumps when the
    // layer goes. A background paints only inside the box of its element.
    // So text that shows its background (background-clip: text) clips to
    // that box, as text in an overflow box clips to the overflow box.
    if (bgClip === 'text') {
      const r = el.getBoundingClientRect();
      clip[0] = Math.max(clip[0], r.left);
      clip[1] = Math.max(clip[1], r.top);
      clip[2] = Math.min(clip[2], r.right);
      clip[3] = Math.min(clip[3], r.bottom);
    }
    // Gradient text: color is transparent and the background shows through
    // the glyphs. Use the first and last gradient colors.
    let gradient = null;
    if (color[3] === 0 && bgClip === 'text') {
      const stops = cs.backgroundImage.match(COLOR_RE);
      if (stops && stops.length > 1) {
        const r = el.getBoundingClientRect();
        gradient = {
          from: parseColor(stops[0]),
          to: parseColor(stops[stops.length - 1]),
          left: r.left,
          width: r.width || 1,
        };
      }
    }
    if (opacity > 0) {
      st = {
        font: `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`,
        size,
        color,
        gradient,
        opacity,
        clip,
        transform: cs.textTransform,
      };
    }
  }
  cache.set(el, st);
  return st;
}

const transformChar = (ch, t) =>
  t === 'uppercase'
    ? ch.toUpperCase()
    : t === 'lowercase'
      ? ch.toLowerCase()
      : ch;

// The distance from the top of a glyph box to the baseline, as layout puts
// it. Layout rounds the font ascent, so canvas metrics can be half a pixel
// off. A probe reads it from layout: an empty inline-block sits on the
// baseline.
const baselines = new Map();
function baselineOffset(font) {
  let off = baselines.get(font);
  if (off !== undefined) return off;
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font:${font}`;
  probe.textContent = 'x';
  const mark = document.createElement('span');
  mark.style.cssText =
    'display:inline-block;width:0;height:0;vertical-align:baseline';
  probe.append(mark);
  document.body.append(probe);
  const range = document.createRange();
  range.selectNodeContents(probe.firstChild);
  off = mark.getBoundingClientRect().bottom - range.getClientRects()[0].top;
  probe.remove();
  baselines.set(font, off);
  return off;
}

// Each character that has ink, keyed by its text node and offset.
function snapshot() {
  const cache = new Map();
  const glyphs = new Map();
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(n) {
        const p = n.parentElement;
        if (
          !p ||
          SKIP.has(p.tagName) ||
          p.closest('[data-morph-skip]') ||
          !/\S/.test(n.data)
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const st = readStyle(n.parentElement, cache);
    if (!st) continue;
    const text = n.data;
    const list = [];
    for (let i = 0; i < text.length; ) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      if (/\S/.test(ch)) {
        range.setStart(n, i);
        range.setEnd(n, i + ch.length);
        const r = range.getClientRects()[0];
        if (r && r.width > 0) {
          let color = st.color;
          if (st.gradient) {
            const g = st.gradient;
            const f = Math.min(
              1,
              Math.max(0, (r.left + r.width / 2 - g.left) / g.width),
            );
            color = g.from.map((c, k) => c + (g.to[k] - c) * f);
          }
          list[i] = {
            ch: transformChar(ch, st.transform),
            font: st.font,
            size: st.size,
            x: r.left,
            baseline: r.top + baselineOffset(st.font),
            top: r.top,
            bottom: r.bottom,
            fill: cssColor(color),
            color: [color[0], color[1], color[2], color[3] * st.opacity],
            clip: st.clip,
          };
        }
      }
      i += ch.length;
    }
    glyphs.set(n, list);
  }
  return glyphs;
}

// The page paints the element. A closed <details> hides its content with
// content-visibility, but layout still gives that text a place. Without this
// test the layer draws the text of a closed accordion.
const rendered = (el) =>
  !el.checkVisibility || el.checkVisibility({ visibilityProperty: true });

// The border box of each element that has text in it and a width and a
// height: not inline, not display: contents, not inside an SVG. The page
// sets box-sizing: border-box, so the box is also the width and height to
// set. A box with no text in it cannot change size with the font. It takes
// its size from its parent, so it needs no animation.
function boxes() {
  const out = new Map();
  for (const el of document.body.querySelectorAll('*')) {
    if (el === canvas || SKIP.has(el.tagName)) continue;
    if (el.closest('[data-morph-skip]')) continue;
    if (el instanceof SVGElement && el.tagName !== 'svg') continue;
    const d = getComputedStyle(el).display;
    if (d === 'inline' || d === 'contents' || d === 'none') continue;
    if (!rendered(el) || !/\S/.test(el.textContent)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.set(el, [r.width, r.height]);
  }
  return out;
}

// Boxes morph too. A font change changes the size of each box that its
// text sizes (a button, a paragraph with a max-width in ch), and
// font-family cannot transition. So every box gets its size from an
// animation, from its old size to its new size. Every box, also a box with
// the same size at each end: else the text in it reflows in the new font
// halfway, and the box grows. The animations stop min and max sizes and
// flex grow and shrink, so the box has exactly the size that they give.
// The frame loop sets their time, so the boxes keep step with the glyphs.
// When an animation ends, its box takes its own size again: the new size.
function morphBoxes(before, after, ms) {
  const anims = [];
  const easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
  for (const [el, [w0, h0]] of before) {
    const b = after.get(el);
    if (!b) continue;
    const anim = el.animate(
      {
        width: [`${w0}px`, `${b[0]}px`],
        height: [`${h0}px`, `${b[1]}px`],
        minWidth: ['0px', '0px'],
        maxWidth: ['none', 'none'],
        minHeight: ['0px', '0px'],
        maxHeight: ['none', 'none'],
        flexGrow: [0, 0],
        flexShrink: [0, 0],
        flexBasis: ['auto', 'auto'],
      },
      { duration: ms, easing, fill: 'backwards' },
    );
    anim.pause();
    anim.currentTime = 0;
    anims.push(anim);
  }
  return anims;
}

// ---------- Distance fields ----------

// Felzenszwalb and Huttenlocher: the squared distance transform in 1D.
function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}

function edt(grid, w, h, f, v, z) {
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

// Write the field of one glyph into the atlas: the signed distance to the
// edge in em, more than 0 inside. A pixel that the raster covers in part
// gets the distance 0.5 - coverage, so the shader gets the coverage back.
// The raster and the atlas have the same layout: the cell is at (ox, oy) in
// both, and both are atlasW wide.
function writeField(alpha, w, h, emPx, atlas, atlasW, ox, oy, buf) {
  const n = w * h;
  if (buf.outer.length < n) {
    buf.outer = new Float64Array(n);
    buf.inner = new Float64Array(n);
  }
  const m = Math.max(w, h);
  if (buf.f.length < m + 1) {
    buf.f = new Float64Array(m + 1);
    buf.v = new Uint16Array(m + 1);
    buf.z = new Float64Array(m + 2);
  }
  const { outer, inner, f, v, z } = buf;
  for (let i = 0; i < n; i++) {
    const at = (oy + Math.floor(i / w)) * atlasW + ox + (i % w);
    const a = alpha[at * 4 + 3] / 255;
    if (a === 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a === 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt(outer, w, h, f, v, z);
  edt(inner, w, h, f, v, z);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      atlas[(oy + y) * atlasW + ox + x] =
        (Math.sqrt(inner[i]) - Math.sqrt(outer[i])) / emPx;
    }
  }
}

// Where a glyph lands on the device pixel grid: a whole pixel and a quarter
// pixel phase across, a whole pixel down.
function place(g, dpr) {
  const qx = Math.round(g.x * dpr * SUBPIXEL) / SUBPIXEL;
  const ix = Math.floor(qx);
  g.ix = ix;
  g.iy = Math.round(g.baseline * dpr);
  g.phase = qx - ix;
  g.key = `${g.font}|${g.ch}|${g.phase}|${g.fill}`;
}

// Rasterize each glyph that the morph needs, and pack the fields into one
// atlas. A cell is in device pixels, from the whole-pixel origin of the
// glyph. Return null when the atlas is too big.
function buildAtlas(entries, dpr, maxSize) {
  // The canvas must be in the document. A canvas resolves its font against
  // its own style, so only then does it get -webkit-font-smoothing from the
  // page. A detached canvas smooths the glyphs, and they come out bolder
  // than the page text.
  const scratch = document.createElement('canvas');
  scratch.style.cssText =
    'position:fixed;left:-99999px;top:0;visibility:hidden';
  document.body.append(scratch);
  try {
    return rasterize(scratch, entries, dpr, maxSize);
  } finally {
    scratch.remove();
  }
}

// No willReadFrequently: that canvas draws on the CPU. The page draws on the
// GPU, and the two smooth the edges of large glyphs (paths) differently. So
// all glyphs go into one GPU canvas with the atlas layout, and one read
// brings them back.
// Shelf packing: the tallest cells first, in rows. Each cell gets its place
// (ax, ay). Return the height, or 0 when the cells do not fit.
function pack(cells, W, maxSize) {
  const sorted = [...cells].sort((a, b) => b.h - a.h);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const c of sorted) {
    if (c.w > W) return 0;
    if (x + c.w > W) {
      x = 0;
      y += row;
      row = 0;
    }
    c.ax = x;
    c.ay = y;
    x += c.w;
    row = Math.max(row, c.h);
  }
  const H = Math.max(1, y + row);
  return H > maxSize ? 0 : H;
}

function rasterize(scratch, entries, dpr, maxSize) {
  const ctx = scratch.getContext('2d');
  const cells = [];
  for (const e of entries) {
    ctx.font = e.font;
    const m = ctx.measureText(e.ch);
    const pad = Math.ceil(R_EM * e.size * dpr) + 1;
    const left = Math.floor(-m.actualBoundingBoxLeft * dpr) - pad;
    const right = Math.ceil(m.actualBoundingBoxRight * dpr + e.phase) + pad;
    const top = Math.floor(-m.actualBoundingBoxAscent * dpr) - pad;
    const bottom = Math.ceil(m.actualBoundingBoxDescent * dpr) + pad;
    // The ink box in em, from the pen origin on the baseline.
    const ink = [
      -m.actualBoundingBoxLeft / e.size,
      -m.actualBoundingBoxAscent / e.size,
      m.actualBoundingBoxRight / e.size,
      m.actualBoundingBoxDescent / e.size,
    ];
    const em = e.size * dpr;
    Object.assign(e, { left, top, w: right - left, h: bottom - top, ink, em });
    cells.push(e);
  }

  const W = Math.min(2048, maxSize);
  const H = pack(cells, W, maxSize);
  if (!H) return null;

  const atlas = new Float32Array(W * H);
  const buf = {
    outer: new Float64Array(0),
    inner: new Float64Array(0),
    f: new Float64Array(0),
    v: new Uint16Array(0),
    z: new Float64Array(0),
  };
  scratch.width = W;
  scratch.height = H;
  for (const c of cells) {
    // The font size stays in CSS pixels, so optical sizing picks the same
    // shapes as the page. The scale and the origin are in device pixels.
    ctx.setTransform(dpr, 0, 0, dpr, c.ax - c.left + c.phase, c.ay - c.top);
    ctx.font = c.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = c.fill;
    ctx.fillText(c.ch, 0, 0);
  }
  const alpha = ctx.getImageData(0, 0, W, H).data;
  for (const c of cells) {
    writeField(alpha, c.w, c.h, c.size * dpr, atlas, W, c.ax, c.ay, buf);
    c.uv = [c.ax / W, c.ay / H, (c.ax + c.w) / W, (c.ay + c.h) / H];
  }
  return { atlas, W, H };
}

// The cell of one glyph in em, from its exact pen origin on the baseline.
// At its end of the morph, the cell corner is on a whole device pixel.
function cellEm(g, c, dpr) {
  const em = g.size * dpr;
  const x0 = (g.ix + c.left - g.x * dpr) / em;
  const y0 = (g.iy + c.top - g.baseline * dpr) / em;
  return [x0, y0, x0 + c.w / em, y0 + c.h / em];
}

// ---------- Flow ----------

// The cell of an atlas entry in em, from its pen origin. Column i of the
// cell has its center at (left - phase + i + 0.5) / em.
const entryCell = (c) => [
  (c.left - c.phase) / c.em,
  c.top / c.em,
  (c.left - c.phase + c.w) / c.em,
  (c.top + c.h) / c.em,
];

// The field of an entry at (x, y) in em, bilinear. Outside the cell it is
// the value at the cell edge less the distance to the cell, as in the shader.
function fieldAt(atlas, c, x, y) {
  const fx = x * c.em - c.left + c.phase - 0.5;
  const fy = y * c.em - c.top - 0.5;
  const cx = Math.min(c.w - 1, Math.max(0, fx));
  const cy = Math.min(c.h - 1, Math.max(0, fy));
  const x0 = Math.min(c.w - 2, Math.floor(cx));
  const y0 = Math.min(c.h - 2, Math.floor(cy));
  const u = cx - x0;
  const v = cy - y0;
  const { atlas: a, W } = atlas;
  const i = (c.ay + y0) * W + c.ax + x0;
  const top = a[i] + (a[i + 1] - a[i]) * u;
  const bottom = a[i + W] + (a[i + W + 1] - a[i + W]) * u;
  const ox = fx - cx;
  const oy = fy - cy;
  return top + (bottom - top) * v - Math.sqrt(ox * ox + oy * oy) / c.em;
}

const sameShape = (a, b) => a.font === b.font && a.ch === b.ch;

// The map from the em frame of glyph a to the em frame of glyph b:
// p * [sx, sy] + [tx, ty]. It puts the center of the ink box of a on the
// center of the ink box of b. It also scales one box to the other. A box that
// is almost flat (a dash, a dot) keeps its scale on that axis.
function alignment(a, b) {
  if (!params.align || sameShape(a, b)) return [1, 1, 0, 0];
  const scale = (a0, a1, b0, b1) =>
    a1 - a0 > 0.02 && b1 - b0 > 0.02
      ? Math.min(2, Math.max(0.5, (b1 - b0) / (a1 - a0)))
      : 1;
  const sx = scale(a.ink[0], a.ink[2], b.ink[0], b.ink[2]);
  const sy = scale(a.ink[1], a.ink[3], b.ink[1], b.ink[3]);
  return [
    sx,
    sy,
    (b.ink[0] + b.ink[2] - sx * (a.ink[0] + a.ink[2])) / 2,
    (b.ink[1] + b.ink[3] - sy * (a.ink[1] + a.ink[3])) / 2,
  ];
}

// A Gaussian blur of a grid, in place, with the edge values repeated.
// sigma is in grid points.
function blur(f, w, h, sigma, tmp) {
  if (sigma < 0.3) return;
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r];
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        s += k[i + r] * f[y * w + Math.min(w - 1, Math.max(0, x + i))];
      }
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      }
      f[y * w + x] = s;
    }
  }
}

// The gradient of a grid field, in em, by central differences.
function gradient(f, g, gx, gy) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const l = Math.max(0, x - 1);
      const r = Math.min(g.w - 1, x + 1);
      const u = Math.max(0, y - 1);
      const d = Math.min(g.h - 1, y + 1);
      const k = y * g.w + x;
      gx[k] = (f[y * g.w + r] - f[y * g.w + l]) / ((r - l || 1) * g.sp);
      gy[k] = (f[d * g.w + x] - f[u * g.w + x]) / ((d - u || 1) * g.sp);
    }
  }
}

// The grid of a pair flow, in the em frame of glyph b. It covers the cell
// of b and the aligned cell of a. Its points are no closer than one device
// pixel of b.
function flowGrid(A, B, M) {
  const a = entryCell(A);
  const b = entryCell(B);
  const x0 = Math.min(b[0], a[0] * M[0] + M[2]);
  const y0 = Math.min(b[1], a[1] * M[1] + M[3]);
  const x1 = Math.max(b[2], a[2] * M[0] + M[2]);
  const y1 = Math.max(b[3], a[3] * M[1] + M[3]);
  const sp = Math.max(1 / params.flowRes, 1 / B.em);
  return {
    x0,
    y0,
    sp,
    w: Math.min(256, Math.ceil((x1 - x0) / sp) + 1),
    h: Math.min(256, Math.ceil((y1 - y0) / sp) + 1),
  };
}

// The field of b on the grid.
function gridB(atlas, B, g) {
  const fb = new Float32Array(g.w * g.h);
  for (let y = 0, k = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++, k++) {
      fb[k] = fieldAt(atlas, B, g.x0 + x * g.sp, g.y0 + y * g.sp);
    }
  }
  return fb;
}

// The field of a on the grid, at each point moved by the flow s (when
// given). The alignment maps the point into the frame of a. The distances
// are in em of b.
function gridA(atlas, A, M, g, s, fa) {
  const m = Math.sqrt(M[0] * M[1]);
  for (let y = 0, k = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++, k++) {
      const px = g.x0 + x * g.sp + (s ? s[0][k] : 0);
      const py = g.y0 + y * g.sp + (s ? s[1][k] : 0);
      fa[k] = fieldAt(atlas, A, (px - M[2]) / M[0], (py - M[3]) / M[1]) * m;
    }
  }
  return fa;
}

// The flow is a backward map s on the grid, in the em frame of b. The ink
// of b at point p is the ink of a at p + s(p).
//
// Demons (Thirion): find s so that a(p + s) = b(p). Each step moves the
// sample point along the mean gradient of the two fields by their
// difference. The gradient of a distance field is the edge normal. So an
// edge moves to the edge of the other glyph that faces the same way. Then
// a blur keeps the flow smooth.
function demons(atlas, A, B, M, g) {
  const n = g.w * g.h;
  const s = [new Float32Array(n), new Float32Array(n)];
  const fb = gridB(atlas, B, g);
  const fa = new Float32Array(n);
  const bx = new Float32Array(n);
  const by = new Float32Array(n);
  const ax = new Float32Array(n);
  const ay = new Float32Array(n);
  const tmp = new Float32Array(n);
  gradient(fb, g, bx, by);
  // The step limit: d / (1 + alpha * d^2) is at most params.step.
  const alpha = 1 / (4 * params.step * params.step);
  for (let it = 0; it < params.iterations; it++) {
    gridA(atlas, A, M, g, s, fa);
    gradient(fa, g, ax, ay);
    for (let k = 0; k < n; k++) {
      const d = fb[k] - fa[k];
      const nx = (ax[k] + bx[k]) / 2;
      const ny = (ay[k] + by[k]) / 2;
      const den = nx * nx + ny * ny + alpha * d * d;
      if (den < 1e-12) continue;
      const near = Math.min(Math.abs(fa[k]), Math.abs(fb[k])) / params.band;
      const w = Math.exp(-near * near) / den;
      s[0][k] += w * d * nx;
      s[1][k] += w * d * ny;
    }
    blur(s[0], g.w, g.h, params.sigma / g.sp, tmp);
    blur(s[1], g.w, g.h, params.sigma / g.sp, tmp);
  }
  return s;
}

// The points of a grid field near its zero contour, moved onto the
// contour. Each point has the normal that points into the glyph. The
// array holds x, y, nx, ny for each point.
function edgePoints(f, g, gx, gy) {
  const out = [];
  for (let y = 0, k = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++, k++) {
      if (Math.abs(f[k]) >= g.sp) continue;
      const len = Math.hypot(gx[k], gy[k]);
      if (len < 1e-6) continue;
      const nx = gx[k] / len;
      const ny = gy[k] / len;
      out.push(
        g.x0 + x * g.sp - f[k] * nx,
        g.y0 + y * g.sp - f[k] * ny,
        nx,
        ny,
      );
    }
  }
  return out;
}

// Edge match: each edge point of b goes to the edge point of a with the
// least cost. Each edge point of a goes to an edge point of b too. The cost is
// the distance, plus normalWeight for each unit of (1 - cos) between the
// two normals. So the right edge of a thin stem goes to the right edge of a
// thick stem. The matches set s at their point on b. A blur smooths them,
// and the grid points far from any edge take the mean of their neighbours.
function edges(atlas, A, B, M, g) {
  const n = g.w * g.h;
  const fa = gridA(atlas, A, M, g, null, new Float32Array(n));
  const fb = gridB(atlas, B, g);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  gradient(fa, g, gx, gy);
  const pa = edgePoints(fa, g, gx, gy);
  gradient(fb, g, gx, gy);
  const pb = edgePoints(fb, g, gx, gy);
  const s = [new Float32Array(n), new Float32Array(n)];
  if (!pa.length || !pb.length) return s;
  const wt = new Float32Array(n);
  const best = (p, i, q) => {
    let at = 0;
    let least = Number.POSITIVE_INFINITY;
    for (let k = 0; k < q.length; k += 4) {
      const cost =
        Math.hypot(q[k] - p[i], q[k + 1] - p[i + 1]) +
        params.normalWeight * (1 - q[k + 2] * p[i + 2] - q[k + 3] * p[i + 3]);
      if (cost < least) {
        least = cost;
        at = k;
      }
    }
    return at;
  };
  const put = (x, y, vx, vy) => {
    const i = Math.min(g.w - 1, Math.max(0, Math.round((x - g.x0) / g.sp)));
    const j = Math.min(g.h - 1, Math.max(0, Math.round((y - g.y0) / g.sp)));
    const k = j * g.w + i;
    s[0][k] += vx;
    s[1][k] += vy;
    wt[k] += 1;
  };
  for (let i = 0; i < pb.length; i += 4) {
    const k = best(pb, i, pa);
    put(pb[i], pb[i + 1], pa[k] - pb[i], pa[k + 1] - pb[i + 1]);
  }
  for (let i = 0; i < pa.length; i += 4) {
    const k = best(pa, i, pb);
    put(pb[k], pb[k + 1], pa[i] - pb[k], pa[i + 1] - pb[k + 1]);
  }
  const tmp = new Float32Array(n);
  const sigma = params.sigma / g.sp;
  blur(s[0], g.w, g.h, sigma, tmp);
  blur(s[1], g.w, g.h, sigma, tmp);
  blur(wt, g.w, g.h, sigma, tmp);
  const known = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (wt[k] > 1e-3) {
      s[0][k] /= wt[k];
      s[1][k] /= wt[k];
      known[k] = 1;
    } else {
      s[0][k] = 0;
      s[1][k] = 0;
    }
  }
  // Fill the grid points far from the edges with the mean of their four
  // neighbours, again and again. The known points stay as they are.
  for (let it = 0, max = 2 * Math.max(g.w, g.h); it < max; it++) {
    for (let y = 0, k = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++, k++) {
        if (known[k]) continue;
        const l = y * g.w + Math.max(0, x - 1);
        const r = y * g.w + Math.min(g.w - 1, x + 1);
        const u = Math.max(0, y - 1) * g.w + x;
        const d = Math.min(g.h - 1, y + 1) * g.w + x;
        s[0][k] = (s[0][l] + s[0][r] + s[0][u] + s[0][d]) / 4;
        s[1][k] = (s[1][l] + s[1][r] + s[1][u] + s[1][d]) / 4;
      }
    }
  }
  return s;
}

const MATCHERS = { demons, edges };

// The alignment and the flow of each pair, and one RG texture that holds
// the flows. A pair of the same shape (or the matcher 'none') gets no flow:
// its rect is empty, and the shader reads a zero flow.
function buildFlows(flows, atlas, maxSize) {
  const cells = [];
  const match = MATCHERS[params.matcher];
  for (const f of flows) {
    f.M = alignment(f.A, f.B);
    f.rect = [0, 0, 0, 0];
    f.uv = [0, 0, 0, 0];
    if (!match || sameShape(f.A, f.B)) continue;
    if (Math.max(f.A.size, f.B.size) < params.minSize) continue;
    f.g = flowGrid(f.A, f.B, f.M);
    f.s = match(atlas, f.A, f.B, f.M, f.g);
    f.w = f.g.w;
    f.h = f.g.h;
    cells.push(f);
  }
  const W = Math.min(2048, maxSize);
  const H = cells.length ? pack(cells, W, maxSize) : 1;
  const data = new Float32Array(W * Math.max(1, H) * 2);
  if (!H) return { data, W, H: 1 };
  for (const f of cells) {
    const { g } = f;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const at = ((f.ay + y) * W + f.ax + x) * 2;
        data[at] = f.s[0][y * g.w + x];
        data[at + 1] = f.s[1][y * g.w + x];
      }
    }
    // Grid point i is the center of texel i.
    f.rect = [
      g.x0 - g.sp / 2,
      g.y0 - g.sp / 2,
      g.x0 + (g.w - 0.5) * g.sp,
      g.y0 + (g.h - 0.5) * g.sp,
    ];
    f.uv = [f.ax / W, f.ay / H, (f.ax + g.w) / W, (f.ay + g.h) / H];
  }
  return { data, W, H };
}

// ---------- WebGL ----------

const VERT = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_orig;
layout(location=2) in vec4 a_size;
layout(location=3) in vec4 a_cellA;
layout(location=4) in vec4 a_uvA;
layout(location=5) in vec4 a_cellB;
layout(location=6) in vec4 a_uvB;
layout(location=7) in vec4 a_colA;
layout(location=8) in vec4 a_colB;
layout(location=9) in vec4 a_clipA;
layout(location=10) in vec4 a_clipB;
layout(location=11) in vec4 a_align;
layout(location=12) in vec4 a_flow;
layout(location=13) in vec4 a_flowUV;
uniform vec2 u_view;
uniform float u_t;
out vec2 v_q;
out vec2 v_px;
flat out vec4 v_cellA, v_uvA, v_cellB, v_uvB, v_col, v_clip, v_align, v_flow, v_flowUV;
flat out float v_size;
void main() {
  // The quad holds glyph a at each end of its alignment, and glyph b at
  // each end of the inverse alignment.
  vec2 s = a_align.xy;
  vec2 t = a_align.zw;
  vec4 a1 = vec4(a_cellA.xy * s + t, a_cellA.zw * s + t);
  vec4 b0 = vec4((a_cellB.xy - t) / s, (a_cellB.zw - t) / s);
  vec2 lo = min(min(a_cellA.xy, a1.xy), min(a_cellB.xy, b0.xy));
  vec2 hi = max(max(a_cellA.zw, a1.zw), max(a_cellB.zw, b0.zw));
  vec2 q = mix(lo, hi, a_corner);
  vec2 px = mix(a_orig.xy, a_orig.zw, u_t) + q * mix(a_size.x, a_size.y, u_t);
  v_q = q;
  v_px = px;
  v_cellA = a_cellA; v_uvA = a_uvA; v_cellB = a_cellB; v_uvB = a_uvB;
  v_align = a_align; v_flow = a_flow; v_flowUV = a_flowUV;
  v_col = mix(a_colA, a_colB, u_t);
  v_clip = mix(a_clipA, a_clipB, u_t);
  v_size = mix(a_size.x, a_size.y, u_t);
  vec2 c = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform sampler2D u_flow;
uniform float u_t;
uniform float u_dpr;
in vec2 v_q;
in vec2 v_px;
flat in vec4 v_cellA, v_uvA, v_cellB, v_uvB, v_col, v_clip, v_align, v_flow, v_flowUV;
flat in float v_size;
out vec4 o;
// The signed distance in em. Outside the cell it is the value at the cell
// edge less the distance to the cell.
float sdf(vec4 cell, vec4 uv, vec2 q) {
  vec2 c = clamp(q, cell.xy, cell.zw);
  vec2 f = (c - cell.xy) / (cell.zw - cell.xy);
  return textureLod(u_atlas, mix(uv.xy, uv.zw, f), 0.0).r - length(q - c);
}
// The backward map of the pair at p, in em of b. No flow when the rect is
// empty. The read stays half a texel inside the rect, so it never reads the
// flow of the next pair in the texture.
vec2 flow(vec2 p) {
  if (v_flow.z <= v_flow.x) return vec2(0.0);
  vec2 f = clamp((p - v_flow.xy) / (v_flow.zw - v_flow.xy), 0.0, 1.0);
  vec2 h = 0.5 / vec2(textureSize(u_flow, 0));
  vec2 uv = clamp(mix(v_flowUV.xy, v_flowUV.zw, f), v_flowUV.xy + h, v_flowUV.zw - h);
  return textureLod(u_flow, uv, 0.0).rg;
}
void main() {
  if (v_px.x < v_clip.x || v_px.y < v_clip.y || v_px.x > v_clip.z || v_px.y > v_clip.w) discard;
  // The frame at time t is the frame of a, moved part of the way along the
  // alignment. p is the point in the frame of a, and y the same point in
  // the frame of b.
  vec2 s = v_align.xy;
  vec2 tr = v_align.zw;
  vec2 k = mix(vec2(1.0), s, u_t);
  vec2 p = (v_q - u_t * tr) / k;
  vec2 y = p * s + tr;
  // The ink of a moves along the flow, and the ink of b comes back along it.
  vec2 d = flow(y);
  float da = sdf(v_cellA, v_uvA, (y + u_t * d - tr) / s);
  float db = sdf(v_cellB, v_uvB, y - (1.0 - u_t) * d);
  // The distances in em of the frame at time t.
  float m = sqrt(s.x * s.y);
  float km = mix(1.0, m, u_t);
  float e = mix(da * km, db * km / m, u_t);
  // The distance in device pixels gives the coverage of the pixel.
  float a = clamp(e * v_size * u_dpr + 0.5, 0.0, 1.0) * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`;

let gl = null;
let canvas = null;
let program = null;
let uView = null;
let uT = null;
let uDpr = null;

function setup() {
  if (gl) return true;
  canvas = document.createElement('canvas');
  canvas.className = 'morph-layer';
  canvas.setAttribute('aria-hidden', 'true');
  gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    antialias: false,
  });
  if (!gl) return false;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  uView = gl.getUniformLocation(program, 'u_view');
  uT = gl.getUniformLocation(program, 'u_t');
  uDpr = gl.getUniformLocation(program, 'u_dpr');
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'u_atlas'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'u_flow'), 1);
  return true;
}

const VEC4S = 13; // For each glyph.
const FLOATS = VEC4S * 4;

// A float texture that the GPU can filter. 16 bits: 8 bits put steps in
// the edge.
function texture(unit, format, type, w, h, data) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, type, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function upload(atlas, flow, data, count) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (let i = 0; i < VEC4S; i++) {
    gl.enableVertexAttribArray(i + 1);
    gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
    gl.vertexAttribDivisor(i + 1, 1);
  }
  const textures = [
    texture(0, gl.R16F, gl.RED, atlas.W, atlas.H, atlas.atlas),
    texture(1, gl.RG16F, gl.RG, flow.W, flow.H, flow.data),
  ];
  return { vao, buffers: [corners, inst], textures, count };
}

function draw(scene, t) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(program);
  gl.uniform2f(uView, scene.vw, scene.vh);
  gl.uniform1f(uT, t);
  gl.uniform1f(uDpr, scene.dpr);
  gl.bindVertexArray(scene.vao);
  scene.textures.forEach((tex, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  });
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.count);
}

function release(scene) {
  gl.deleteVertexArray(scene.vao);
  for (const b of scene.buffers) gl.deleteBuffer(b);
  for (const tex of scene.textures) gl.deleteTexture(tex);
}

// ---------- The morph ----------

// cubic-bezier(0.4, 0, 0.2, 1), the same curve as the token transitions.
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

let active = null;

// End the morph. Each animation goes, so each box and token takes its own
// value: the value of the new theme. Then the transitions come back on, with
// no value left to move.
function finish() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  for (const a of active.anims) a.cancel();
  removeEventListener('scroll', finish);
  removeEventListener('resize', finish);
  flush();
  root.classList.remove('morph-measure', 'morphing');
  canvas.remove();
  release(active.scene);
  const done = active.done;
  active = null;
  done();
}

// The tokens that themes.css morphs are the ones in its transition-property.
// During a morph a paused animation on :root moves them, on the clock of the
// glyphs and the boxes. CSS transitions would start at the style change, and
// the first frame of a new theme is slow: they would move ahead while the
// glyphs wait.
function tokenNames() {
  return getComputedStyle(root)
    .transitionProperty.split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('--'));
}
function tokenValues(names) {
  const cs = getComputedStyle(root);
  return names.map((n) => cs.getPropertyValue(n).trim());
}
function morphTokens(names, from, to, ms) {
  const frames = {};
  names.forEach((n, i) => {
    if (from[i] !== to[i]) frames[n] = [from[i], to[i]];
  });
  const anim = root.animate(frames, {
    duration: ms,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'backwards',
  });
  anim.pause();
  anim.currentTime = 0;
  return anim;
}

// Load the Latin faces of every font in the stylesheets, so a theme change
// never waits for a font or measures a fallback font.
function preloadFonts() {
  for (const face of document.fonts) {
    if (
      face.status === 'unloaded' &&
      face.unicodeRange.startsWith('U+0000-00FF')
    ) {
      face.load().catch(() => {});
    }
  }
}
addEventListener('load', () => setTimeout(preloadFonts, 500));

// Resolves when the morph ends, or at once when there is no morph.
async function morph(apply) {
  finish();
  const ms = duration();
  if (ms <= 0 || !setup()) {
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
  last = { from: old, to: { ...root.dataset } };
  setData(old);
  flush();

  const list = pairs(before, after);
  const dpr = devicePixelRatio || 1;
  const tRead = performance.now();
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
  const atlas = buildAtlas(
    entries.values(),
    dpr,
    gl.getParameter(gl.MAX_TEXTURE_SIZE),
  );
  if (!atlas || list.length === 0) {
    root.classList.remove('morph-measure');
    apply();
    return;
  }
  const t1 = performance.now();

  // One flow for each pair of atlas entries.
  const flows = new Map();
  for (const [a, b] of list) {
    const key = `${a.key}>${b.key}`;
    if (!flows.has(key)) {
      flows.set(key, { A: entries.get(a.key), B: entries.get(b.key) });
    }
  }
  const flow = buildFlows(
    flows.values(),
    atlas,
    gl.getParameter(gl.MAX_TEXTURE_SIZE),
  );

  const data = new Float32Array(list.length * FLOATS);
  list.forEach(([a, b], i) => {
    const ca = entries.get(a.key);
    const cb = entries.get(b.key);
    const f = flows.get(`${a.key}>${b.key}`);
    data.set(
      [
        a.x,
        a.baseline,
        b.x,
        b.baseline,
        a.size,
        b.size,
        0,
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

  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  const scene = {
    ...upload(atlas, flow, data, list.length),
    vw: innerWidth,
    vh: innerHeight,
    dpr,
  };
  draw(scene, 0);
  const t2 = performance.now();
  morph.stats = {
    glyphs: list.length,
    shapes: entries.size,
    flows: [...flows.values()].filter((f) => f.g).length,
    readMs: Math.round(tRead - t0),
    atlasMs: Math.round(t1 - tRead),
    flowMs: Math.round(t2 - t1),
  };
  dispatchEvent(new CustomEvent('autosam-morph-stats'));
  document.body.append(canvas);
  root.classList.add('morphing');
  apply();
  const anims = [
    morphTokens(names, tokensBefore, tokensAfter, ms),
    ...morphBoxes(boxesBefore, boxesAfter, ms),
  ];

  // One clock for the glyphs, the boxes and the tokens. The first frame of
  // the new theme is slow (style, layout and paint of the whole page). The
  // clock starts on the frame after it, so nothing jumps ahead.
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
    // The debug panel can hold the morph at a time. The clock then goes on
    // from that time.
    if (params.hold) {
      x = params.t;
      start = now - x * ms;
    }
    draw(scene, ease(x));
    for (const anim of anims) anim.currentTime = x * ms;
    if (x < 1 || params.hold) active.raf = requestAnimationFrame(frame);
    else finish();
  };
  const ended = new Promise((resolve) => {
    active = { scene, raf: requestAnimationFrame(frame), anims, done: resolve };
  });
  addEventListener('scroll', finish, { passive: true });
  addEventListener('resize', finish);
  return ended;
}

// The theme data of the last morph, for a replay.
let last = null;

// Morph from the last old theme to the last new theme again. The debug
// panel calls this when a setting changes.
function replay() {
  if (!last) return;
  const { from, to } = last;
  finish();
  root.classList.add('morph-measure');
  setData(from);
  flush();
  morph(() => setData(to));
}

morph.params = params;
morph.replay = replay;
window.autosamMorph = morph;

if (new URLSearchParams(location.search).get('debug') === 'morph') {
  import('./morph-debug.js');
}
