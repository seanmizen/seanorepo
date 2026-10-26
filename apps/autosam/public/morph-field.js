// autosam morph: distance fields.
//
// Where: morph.js and morph-flow.js import this module.
// When: once for each morph, after the page is read.
// Why: the layer draws each glyph from a signed distance field (SDF). It is
// an image where each pixel holds its distance to the glyph edge in em,
// more than 0 inside. This module rasterizes each glyph as the page draws it,
// and packs the fields into one atlas.

// The distance that a field holds on each side of the edge, in em.
const R_EM = 0.3;
// The browser places glyphs on quarter pixels. This file rasterizes on the
// same grid.
const SUBPIXEL = 4;
const INF = 1e20;

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
export function place(g, dpr) {
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
export function buildAtlas(entries, dpr, maxSize) {
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
export function pack(cells, W, maxSize) {
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
export function cellEm(g, c, dpr) {
  const em = g.size * dpr;
  const x0 = (g.ix + c.left - g.x * dpr) / em;
  const y0 = (g.iy + c.top - g.baseline * dpr) / em;
  return [x0, y0, x0 + c.w / em, y0 + c.h / em];
}

// The cell of an atlas entry in em, from its pen origin. Column i of the
// cell has its center at (left - phase + i + 0.5) / em.
export const entryCell = (c) => [
  (c.left - c.phase) / c.em,
  c.top / c.em,
  (c.left - c.phase + c.w) / c.em,
  (c.top + c.h) / c.em,
];

// The field of an entry at (x, y) in em, bilinear. Outside the cell it is
// the value at the cell edge less the distance to the cell, as in the shader.
export function fieldAt(atlas, c, x, y) {
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
