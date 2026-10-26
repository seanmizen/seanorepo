// autosam morph: read the page.
//
// Where: morph.js imports this module.
// When: before and after the theme changes, while the morph measures.
// Why: the morph needs each visible character (place, font, color, clip),
// the size of each box with text, and the value of each theme token. It
// also holds the boxes and the tokens at their old values while the glyphs
// move.

const root = document.documentElement;

// The curve of every part of the morph. ease() in morph.js is the same
// curve as a function.
export const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Elements whose text the morph never draws.
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
export function snapshot() {
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
// height. The element is not inline, not display: contents, and not inside
// an SVG. data-morph-skip marks the layer and the debug panel, and they
// stay out. The page
// sets box-sizing: border-box, so the box is also the width and height to
// set. A box with no text in it cannot change size with the font. It takes
// its size from its parent, so it needs no animation.
export function boxes() {
  const out = new Map();
  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP.has(el.tagName) || el.closest('[data-morph-skip]')) continue;
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
export function morphBoxes(before, after, ms) {
  const anims = [];
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
      { duration: ms, easing: EASING, fill: 'backwards' },
    );
    anim.pause();
    anim.currentTime = 0;
    anims.push(anim);
  }
  return anims;
}

// The tokens that themes.css morphs are the ones in its transition-property.
// During a morph a paused animation on :root moves them, on the clock of the
// glyphs and the boxes. CSS transitions would start at the style change, and
// the first frame of a new theme is slow: they would move ahead while the
// glyphs wait.
export function tokenNames() {
  return getComputedStyle(root)
    .transitionProperty.split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('--'));
}
export function tokenValues(names) {
  const cs = getComputedStyle(root);
  return names.map((n) => cs.getPropertyValue(n).trim());
}
export function morphTokens(names, from, to, ms) {
  const frames = {};
  names.forEach((n, i) => {
    if (from[i] !== to[i]) frames[n] = [from[i], to[i]];
  });
  const anim = root.animate(frames, {
    duration: ms,
    easing: EASING,
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
