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
// glyph edge. A blend of two fields gives a shape between the two glyphs,
// with no need to match points.
//
// The steps:
// 1. Read each character: its box, font, color, opacity and clip.
// 2. Apply the new theme with transitions off, and read the same again.
// 3. Put back the old theme. Make the fields and fill the WebGL buffers.
// 4. Hide the real text and show the layer. Apply the new theme with
//    transitions on, so the tokens (colors, radii, shadows) morph under it.
// 5. Blend each glyph over --morph. Then remove the layer and show the text.

// The distance that a field holds on each side of the edge, in em. Where two
// glyphs differ by more than this, the blend falls on a flat part of a field
// and the edge tears.
const R_EM = 0.5;
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

function readStyle(el, cache) {
  if (cache.has(el)) return cache.get(el);
  const cs = getComputedStyle(el);
  let st = null;
  if (cs.visibility === 'visible') {
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
    // layer goes. A background paints only inside the box of its element, so
    // text that shows its background (background-clip: text) clips to that
    // box, as text in an overflow box clips to the overflow box.
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
        if (!p || SKIP.has(p.tagName) || !/\S/.test(n.data)) {
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
            top: r.top,
            bottom: r.bottom,
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

// Write the field of one glyph into the atlas. 0.5 is the edge, more is
// inside. The field holds R_EM on each side, so fields of different sizes
// blend in the same units.
function writeField(alpha, w, h, radius, atlas, atlasW, ox, oy, buf) {
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
    const a = alpha[i * 4 + 3] / 255;
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
      const dist = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
      const val = 0.5 - dist / (2 * radius);
      atlas[(oy + y) * atlasW + ox + x] = Math.max(
        0,
        Math.min(255, Math.round(val * 255)),
      );
    }
  }
}

// Rasterize each glyph that the morph needs, and pack the fields into one
// atlas. Return null when the atlas is too big.
function buildAtlas(keys, dpr, maxSize) {
  const scratch = document.createElement('canvas');
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  const ascent = new Map();
  const cells = new Map();
  for (const key of keys) {
    const { ch, font, size } = key;
    ctx.font = font;
    const m = ctx.measureText(ch);
    if (!ascent.has(font)) ascent.set(font, m.fontBoundingBoxAscent);
    const pad = R_EM * size + 1;
    const x0 = -m.actualBoundingBoxLeft - pad;
    const x1 = m.actualBoundingBoxRight + pad;
    const y0 = -m.actualBoundingBoxAscent - pad;
    const y1 = m.actualBoundingBoxDescent + pad;
    cells.set(key.id, {
      ...key,
      x0,
      y0,
      x1,
      y1,
      w: Math.ceil((x1 - x0) * dpr),
      h: Math.ceil((y1 - y0) * dpr),
    });
  }

  // Shelf packing: the tallest cells first, in rows.
  const list = [...cells.values()].sort((a, b) => b.h - a.h);
  const W = Math.min(2048, maxSize);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const c of list) {
    if (c.w > W) return null;
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
  const H = y + row;
  if (H > maxSize) return null;

  const atlas = new Uint8Array(W * Math.max(1, H));
  const buf = {
    outer: new Float64Array(0),
    inner: new Float64Array(0),
    f: new Float64Array(0),
    v: new Uint16Array(0),
    z: new Float64Array(0),
  };
  for (const c of list) {
    if (scratch.width < c.w || scratch.height < c.h) {
      scratch.width = Math.max(scratch.width, c.w);
      scratch.height = Math.max(scratch.height, c.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.w, c.h);
    ctx.setTransform(dpr, 0, 0, dpr, -c.x0 * dpr, -c.y0 * dpr);
    ctx.font = c.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000';
    ctx.fillText(c.ch, 0, 0);
    const alpha = ctx.getImageData(0, 0, c.w, c.h).data;
    writeField(alpha, c.w, c.h, R_EM * c.size * dpr, atlas, W, c.ax, c.ay, buf);
    // The cell in em, from the pen origin on the baseline, and in atlas UV.
    c.em = [c.x0 / c.size, c.y0 / c.size, c.x1 / c.size, c.y1 / c.size];
    c.uv = [c.ax / W, c.ay / H, (c.ax + c.w) / W, (c.ay + c.h) / H];
  }
  return { atlas, W, H, cells, ascent };
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
uniform vec2 u_view;
uniform float u_t;
out vec2 v_q;
out vec2 v_px;
flat out vec4 v_cellA, v_uvA, v_cellB, v_uvB, v_col, v_clip;
flat out float v_size;
void main() {
  vec2 q = mix(min(a_cellA.xy, a_cellB.xy), max(a_cellA.zw, a_cellB.zw), a_corner);
  vec2 px = mix(a_orig.xy, a_orig.zw, u_t) + q * mix(a_size.x, a_size.y, u_t);
  v_q = q;
  v_px = px;
  v_cellA = a_cellA; v_uvA = a_uvA; v_cellB = a_cellB; v_uvB = a_uvB;
  v_col = mix(a_colA, a_colB, u_t);
  v_clip = mix(a_clipA, a_clipB, u_t);
  v_size = mix(a_size.x, a_size.y, u_t);
  vec2 c = px / u_view * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform float u_t;
uniform float u_blur;
uniform float u_dpr;
in vec2 v_q;
in vec2 v_px;
flat in vec4 v_cellA, v_uvA, v_cellB, v_uvB, v_col, v_clip;
flat in float v_size;
out vec4 o;
// No early return: the mipmap level needs the derivatives of every pixel.
float field(vec4 cell, vec4 uv, vec2 q, float lod) {
  vec2 f = (q - cell.xy) / (cell.zw - cell.xy);
  float inside = step(0.0, f.x) * step(0.0, f.y) * step(f.x, 1.0) * step(f.y, 1.0);
  return inside * texture(u_atlas, mix(uv.xy, uv.zw, clamp(f, 0.0, 1.0)), lod).r;
}
void main() {
  if (v_px.x < v_clip.x || v_px.y < v_clip.y || v_px.x > v_clip.z || v_px.y > v_clip.w) discard;
  // u_blur is in em. One mipmap level doubles the blur in texels.
  float lod = log2(max(1.0, u_blur * v_size * u_dpr));
  float d = mix(field(v_cellA, v_uvA, v_q, lod), field(v_cellB, v_uvB, v_q, lod), u_t);
  float w = max(fwidth(d), 1e-4);
  float a = clamp((d - 0.5) / w + 0.5, 0.0, 1.0) * v_col.a;
  o = vec4(v_col.rgb * a, a);
}`;

let gl = null;
let canvas = null;
let program = null;
let uView = null;
let uT = null;
let uBlur = null;
let uDpr = null;
// A blend of two fields has creases along the middle of each stroke. A
// blurred field (a higher mipmap level) smooths them. The blur is in em, so
// small text gets the same blur as large text. It is greatest halfway and
// zero at each end, so the first and last frames are sharp.
const BLUR_EM = 0.06;

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
  uBlur = gl.getUniformLocation(program, 'u_blur');
  uDpr = gl.getUniformLocation(program, 'u_dpr');
  return true;
}

const FLOATS = 40; // 10 vec4 for each glyph.

function upload(atlas, data, count) {
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
  for (let i = 0; i < 10; i++) {
    gl.enableVertexAttribArray(i + 1);
    gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
    gl.vertexAttribDivisor(i + 1, 1);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    atlas.W,
    atlas.H,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    atlas.atlas,
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { vao, buffers: [corners, inst], tex, count };
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
  gl.uniform1f(uBlur, BLUR_EM * Math.sin(Math.PI * t));
  gl.uniform1f(uDpr, scene.dpr);
  gl.bindVertexArray(scene.vao);
  gl.bindTexture(gl.TEXTURE_2D, scene.tex);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.count);
}

function release(scene) {
  gl.deleteVertexArray(scene.vao);
  for (const b of scene.buffers) gl.deleteBuffer(b);
  gl.deleteTexture(scene.tex);
}

// ---------- The morph ----------

// cubic-bezier(0.4, 0, 0.2, 1), the same curve as the token transitions.
function ease(x) {
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

function finish() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  removeEventListener('scroll', finish);
  removeEventListener('resize', finish);
  root.classList.remove('morphing');
  canvas.remove();
  release(active.scene);
  active = null;
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

async function morph(apply) {
  finish();
  const ms = duration();
  if (ms <= 0 || !setup()) {
    apply();
    return;
  }
  if (document.fonts.status === 'loading') await document.fonts.ready;

  // Transitions off for the whole measure. A press during a morph then
  // starts from the end of the last morph, not from a token between values.
  root.classList.add('morph-measure');
  flush();
  const old = { ...root.dataset };
  const before = snapshot();
  apply();
  let after = snapshot();
  if (document.fonts.status === 'loading') {
    // The new theme asked for a font that is not loaded yet. Wait, and read
    // again.
    setData(old);
    flush();
    await document.fonts.ready;
    apply();
    after = snapshot();
  }
  setData(old);
  flush();
  root.classList.remove('morph-measure');

  const list = pairs(before, after);
  const dpr = devicePixelRatio || 1;
  const keys = new Map();
  for (const pair of list) {
    for (const g of pair) {
      g.id = `${g.font}|${g.ch}`;
      if (!keys.has(g.id))
        keys.set(g.id, { id: g.id, ch: g.ch, font: g.font, size: g.size });
    }
  }
  const atlas = buildAtlas(
    keys.values(),
    dpr,
    gl.getParameter(gl.MAX_TEXTURE_SIZE),
  );
  if (!atlas || list.length === 0) {
    apply();
    return;
  }

  const data = new Float32Array(list.length * FLOATS);
  list.forEach(([a, b], i) => {
    const ca = atlas.cells.get(a.id);
    const cb = atlas.cells.get(b.id);
    const ya = a.top + atlas.ascent.get(a.font);
    const yb = b.top + atlas.ascent.get(b.font);
    data.set(
      [
        a.x,
        ya,
        b.x,
        yb,
        a.size,
        b.size,
        0,
        0,
        ...ca.em,
        ...ca.uv,
        ...cb.em,
        ...cb.uv,
        ...a.color,
        ...b.color,
        ...a.clip,
        ...b.clip,
      ],
      i * FLOATS,
    );
  });

  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  const scene = {
    ...upload(atlas, data, list.length),
    vw: innerWidth,
    vh: innerHeight,
    dpr,
  };
  draw(scene, 0);
  document.body.append(canvas);
  root.classList.add('morphing');
  apply();

  const start = performance.now();
  active = { scene, raf: 0 };
  const frame = (now) => {
    const x = Math.min(1, (now - start) / ms);
    draw(scene, ease(x));
    if (x < 1) active.raf = requestAnimationFrame(frame);
    else finish();
  };
  active.raf = requestAnimationFrame(frame);
  addEventListener('scroll', finish, { passive: true });
  addEventListener('resize', finish);
}

window.autosamMorph = morph;
