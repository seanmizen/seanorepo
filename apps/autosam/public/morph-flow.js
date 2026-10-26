// autosam morph: flow.
//
// Where: morph.js imports this module.
// When: once for each morph, after the distance fields.
// Why: a blend of two fields at each pixel moves no ink. Where the two
// glyphs do not overlap, ink fades in one place and grows in another. So
// the ink moves first, then the blend:
// - Align: the ink box of the old glyph moves and scales onto the ink box
//   of the new glyph.
// - Flow: a field of vectors for each glyph pair. It tells each point of the
//   new glyph where its ink is in the old glyph. Over the morph the old
//   glyph moves along the vectors and the new glyph comes back along them.
//   At each time the two shapes almost agree, so the blend keeps the ink.
// Two matchers make the flow: edges and demons. They give the same shapes,
// and edges is faster.

import { entryCell, fieldAt, pack } from './morph-field.js';

const sameShape = (a, b) => a.font === b.font && a.ch === b.ch;

// The map from the em frame of glyph a to the em frame of glyph b:
// p * [sx, sy] + [tx, ty]. It puts the center of the ink box of a on the
// center of the ink box of b. It also scales one box to the other. A box that
// is almost flat (a dash, a dot) keeps its scale on that axis.
function alignment(a, b) {
  if (sameShape(a, b)) return [1, 1, 0, 0];
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
function flowGrid(A, B, M, settings) {
  const a = entryCell(A);
  const b = entryCell(B);
  const x0 = Math.min(b[0], a[0] * M[0] + M[2]);
  const y0 = Math.min(b[1], a[1] * M[1] + M[3]);
  const x1 = Math.max(b[2], a[2] * M[0] + M[2]);
  const y1 = Math.max(b[3], a[3] * M[1] + M[3]);
  const sp = Math.max(1 / settings.flowRes, 1 / B.em);
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
export function demons(atlas, A, B, M, g, settings) {
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
  // The step limit: d / (1 + alpha * d^2) is at most settings.step.
  const alpha = 1 / (4 * settings.step * settings.step);
  for (let it = 0; it < settings.iterations; it++) {
    gridA(atlas, A, M, g, s, fa);
    gradient(fa, g, ax, ay);
    for (let k = 0; k < n; k++) {
      const d = fb[k] - fa[k];
      const nx = (ax[k] + bx[k]) / 2;
      const ny = (ay[k] + by[k]) / 2;
      const den = nx * nx + ny * ny + alpha * d * d;
      if (den < 1e-12) continue;
      const near = Math.min(Math.abs(fa[k]), Math.abs(fb[k])) / settings.band;
      const w = Math.exp(-near * near) / den;
      s[0][k] += w * d * nx;
      s[1][k] += w * d * ny;
    }
    blur(s[0], g.w, g.h, settings.sigma / g.sp, tmp);
    blur(s[1], g.w, g.h, settings.sigma / g.sp, tmp);
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
export function edges(atlas, A, B, M, g, settings) {
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
        settings.normalWeight * (1 - q[k + 2] * p[i + 2] - q[k + 3] * p[i + 3]);
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
  const sigma = settings.sigma / g.sp;
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

// The alignment and the flow of each pair, and one RG texture that holds
// the flows. method.align turns on the alignment, and method.flow is the
// matcher. A pair gets no flow when it has the same shape at both ends, when
// it is small, or when the method has no matcher. Its rect is then empty,
// and the shader reads a zero flow.
export function buildFlows(flows, atlas, maxSize, method, settings) {
  const cells = [];
  for (const f of flows) {
    f.M = method.align ? alignment(f.A, f.B) : [1, 1, 0, 0];
    f.rect = [0, 0, 0, 0];
    f.uv = [0, 0, 0, 0];
    if (!method.flow || sameShape(f.A, f.B)) continue;
    if (Math.max(f.A.size, f.B.size) < settings.minSize) continue;
    f.g = flowGrid(f.A, f.B, f.M, settings);
    f.s = method.flow(atlas, f.A, f.B, f.M, f.g, settings);
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
