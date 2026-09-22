// convert.mjs: turns one image into ASCII art.
//
// This is the pipeline of asciiart.eu/image-to-ascii, which runs in the
// browser. The steps and their order match the site:
//   1. Resize to `width` columns. A text cell is about twice as tall as it is
//      wide, so the row count is scaled by 0.55.
//   2. Apply the CSS filter functions in the site's order.
//   3. Optionally apply edge detection, sharpen and a threshold.
//   4. Take luminance, optionally with error-diffusion dithering.
//   5. Map luminance to a character. Dark pixels get earlier characters.
import sharp from 'sharp';

/** The site's character sets. Dark pixels map to the first character. */
export const CHARSETS = {
  minimalist: '#+-.',
  normal: '@%#*+=-:.',
  normal2: '&$Xx+;:.',
  alphabetic: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric:
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz',
  numerical: '0896452317',
  extended: '@%#{}[]()<>^*+=~-:.',
  math: '+-×÷=≠≈∞√π',
  arrow: '↑↗→↘↓↙←↖',
  grayscale: '@$BWM#*oahkbdpwmZO0QCJYXzcvnxrjft/|()1{}[]-_+~<>i!lI;:,"^`\'.',
  codepage437: '█▓▒░',
  blockelement: '█',
};

/** The site's defaults, from its "reset filters" button. */
export const DEFAULTS = {
  width: 100,
  charset: 'normal',
  chars: null, // literal characters, darkest first. Overrides charset.
  brightness: 100, // percent
  contrast: 100, // percent
  saturation: 100, // percent
  sepia: 0, // percent
  hue: 0, // degrees
  grayscale: 0, // percent
  invert: 0, // percent
  sharpen: false,
  sharpness: 9, // centre weight of the 3x3 sharpen kernel
  edges: false,
  edgeIntensity: 1,
  threshold: null, // 0-255. null turns it off.
  dithering: 'none', // none | FloydSteinberg | JJN | Stucki | Atkinson
  spaceDensity: 1, // spaces added to the end of the charset
  reverse: false, // not on the site: flips the charset for a dark terminal
};

/** Settings that take a number, so keyframes can animate them. */
export const NUMERIC = new Set([
  ...Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'number'),
  'threshold',
]);

// ---- CSS filter functions, with the Filter Effects spec formulas ----------

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

const applyMatrix = (px, m) => {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    px[i] = clamp(m[0] * r + m[1] * g + m[2] * b);
    px[i + 1] = clamp(m[3] * r + m[4] * g + m[5] * b);
    px[i + 2] = clamp(m[6] * r + m[7] * g + m[8] * b);
  }
};

const applyPerChannel = (px, f) => {
  for (let i = 0; i < px.length; i += 4) {
    px[i] = clamp(f(px[i]));
    px[i + 1] = clamp(f(px[i + 1]));
    px[i + 2] = clamp(f(px[i + 2]));
  }
};

const saturateMatrix = (s) => [
  0.213 + 0.787 * s,
  0.715 - 0.715 * s,
  0.072 - 0.072 * s,
  0.213 - 0.213 * s,
  0.715 + 0.285 * s,
  0.072 - 0.072 * s,
  0.213 - 0.213 * s,
  0.715 - 0.715 * s,
  0.072 + 0.928 * s,
];

const sepiaMatrix = (a) => {
  const k = 1 - a;
  return [
    0.393 + 0.607 * k,
    0.769 - 0.769 * k,
    0.189 - 0.189 * k,
    0.349 - 0.349 * k,
    0.686 + 0.314 * k,
    0.168 - 0.168 * k,
    0.272 - 0.272 * k,
    0.534 - 0.534 * k,
    0.131 + 0.869 * k,
  ];
};

const grayscaleMatrix = (a) => {
  const k = 1 - a;
  return [
    0.2126 + 0.7874 * k,
    0.7152 - 0.7152 * k,
    0.0722 - 0.0722 * k,
    0.2126 - 0.2126 * k,
    0.7152 + 0.2848 * k,
    0.0722 - 0.0722 * k,
    0.2126 - 0.2126 * k,
    0.7152 - 0.7152 * k,
    0.0722 + 0.9278 * k,
  ];
};

const hueMatrix = (deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
  ];
};

const applyFilters = (px, o) => {
  if (o.brightness !== 100) {
    applyPerChannel(px, (v) => v * (o.brightness / 100));
  }
  if (o.contrast !== 100) {
    const c = o.contrast / 100;
    applyPerChannel(px, (v) => (v - 127.5) * c + 127.5);
  }
  if (o.saturation !== 100) applyMatrix(px, saturateMatrix(o.saturation / 100));
  if (o.sepia) applyMatrix(px, sepiaMatrix(Math.min(o.sepia, 100) / 100));
  if (o.hue) applyMatrix(px, hueMatrix(o.hue));
  if (o.grayscale) {
    applyMatrix(px, grayscaleMatrix(Math.min(o.grayscale, 100) / 100));
  }
  if (o.invert) {
    const a = Math.min(o.invert, 100) / 100;
    applyPerChannel(px, (v) => v * (1 - a) + (255 - v) * a);
  }
};

const luminance = (px, i) => 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];

// Sobel edge detection. The site paints the border white and inverts the
// edges, so edges come out dark on a light field.
const applyEdges = (px, w, h, intensity) => {
  const out = new Float32Array(px.length);
  const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i + 3] = 255;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[i] = out[i + 1] = out[i + 2] = 255;
        continue;
      }
      let gx = 0;
      let gy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const l = luminance(px, ((y + dy) * w + (x + dx)) * 4);
          const k = (dy + 1) * 3 + (dx + 1);
          gx += l * kx[k];
          gy += l * ky[k];
        }
      }
      const edge = Math.trunc(Math.sqrt(gx * gx + gy * gy) * intensity);
      out[i] = out[i + 1] = out[i + 2] = clamp(255 - edge);
    }
  }
  px.set(out);
};

const applySharpen = (px, w, h, centre) => {
  const k = [-1, -1, -1, -1, centre, -1, -1, -1, -1];
  const out = new Float32Array(px.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const yy = y + ky - 1;
          const xx = x + kx - 1;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 4;
          const wt = k[ky * 3 + kx];
          r += px[j] * wt;
          g += px[j + 1] * wt;
          b += px[j + 2] * wt;
        }
      }
      const i = (y * w + x) * 4;
      out[i] = clamp(r);
      out[i + 1] = clamp(g);
      out[i + 2] = clamp(b);
      out[i + 3] = px[i + 3];
    }
  }
  px.set(out);
};

// Error-diffusion kernels as [dx, dy, weight]. The site quantises to 15
// levels. It adds the error to the red channel of each neighbour only. That
// is part of how the site's output looks, so this keeps it.
const KERNELS = {
  FloydSteinberg: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  JJN: [
    [1, 0, 7],
    [2, 0, 5],
    [-2, 1, 3],
    [-1, 1, 5],
    [0, 1, 7],
    [1, 1, 5],
    [2, 1, 3],
    [-2, 2, 1],
    [-1, 2, 3],
    [0, 2, 5],
    [1, 2, 3],
    [2, 2, 1],
  ].map(([x, y, n]) => [x, y, n / 48]),
  Stucki: [
    [1, 0, 8],
    [2, 0, 4],
    [-2, 1, 2],
    [-1, 1, 4],
    [0, 1, 8],
    [1, 1, 4],
    [2, 1, 2],
    [-2, 2, 1],
    [-1, 2, 2],
    [0, 2, 4],
    [1, 2, 2],
    [2, 2, 1],
  ].map(([x, y, n]) => [x, y, n / 42]),
  Atkinson: [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ].map(([x, y]) => [x, y, 1 / 8]),
};

/**
 * The characters for one set of options, darkest first. `chars` wins over
 * `charset`. An unknown charset name is an error.
 */
export const glyphsFor = (o) => {
  let base;
  if (o.chars) base = String(o.chars);
  else if (Object.hasOwn(CHARSETS, o.charset)) base = CHARSETS[o.charset];
  else {
    throw new Error(
      `unknown charset "${o.charset}". Use one of: ${Object.keys(CHARSETS).join(', ')}. For your own characters, use --chars.`,
    );
  }
  const spaces = ' '.repeat(Math.max(0, Math.round(o.spaceDensity)));
  const glyphs = [...base, ...spaces];
  return o.reverse ? glyphs.reverse() : glyphs;
};

/** The character for a luminance of 0-255. */
export const glyphFor = (glyphs, l) => {
  const v = l < 0 ? 0 : l > 255 ? 255 : l;
  return glyphs[Math.floor((v * (glyphs.length - 1)) / 255)];
};

/**
 * Decodes an image once, so each frame of an animation only resizes it.
 * @returns {Promise<{ pipeline: import('sharp').Sharp, aspect: number }>}
 */
export const loadImage = async (image) => {
  const pipeline = sharp(image).rotate(); // obey EXIF orientation
  const meta = await pipeline.metadata();
  const upright = (meta.orientation ?? 1) >= 5;
  const aspect = upright ? meta.height / meta.width : meta.width / meta.height;
  return { pipeline, aspect };
};

/** Converts a loaded image to ASCII. Returns the lines joined by "\n". */
export const toAscii = async (loaded, opts = {}) => {
  const o = { ...DEFAULTS, ...opts };
  const w = Math.max(1, Math.round(o.width));
  const h = Math.max(1, Math.floor(0.55 * Math.floor(w / loaded.aspect)));
  const data = await loaded.pipeline
    .clone()
    .resize(w, h, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  // Floats, so the dithering error is not rounded away.
  const px = new Float32Array(data);

  applyFilters(px, o);
  if (o.edges) applyEdges(px, w, h, o.edgeIntensity);
  if (o.sharpen) applySharpen(px, w, h, o.sharpness);
  if (o.threshold !== null && o.threshold !== undefined) {
    for (let i = 0; i < px.length; i += 4) {
      const v = luminance(px, i) < o.threshold ? 0 : 255;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }

  const glyphs = glyphsFor(o);
  const kernel = KERNELS[o.dithering];
  const lines = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] < 16) {
        line += ' ';
        continue;
      }
      let l = luminance(px, i);
      if (kernel) {
        const q = (Math.round((l / 255) * 14) / 14) * 255;
        const err = l - q;
        for (const [dx, dy, wt] of kernel) {
          const j = ((y + dy) * w + (x + dx)) * 4;
          if (j >= 0 && j < px.length) px[j] += err * wt;
        }
        l = q;
      }
      line += glyphFor(glyphs, l);
    }
    lines.push(line);
  }
  return lines.join('\n');
};
