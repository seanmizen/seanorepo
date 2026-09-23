// text.mjs: text layers stamped on top of an ASCII frame.
//
// A layer is { text, anchor, from, to }. It shows from frame `from` (default 0)
// to frame `to` (default: the end). Text can hold variables such as
// {hostname}. A variable with no value stays as written.
import { hostname, uptime } from 'node:os';

export const ANCHORS = [
  'center',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/** Seconds as "300d 2h 34m". Leading zero units are left out. */
export const formatUptime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

/** The variables of the machine this runs on. */
export const machineVars = () => ({
  hostname: hostname().split('.')[0],
  uptime: formatUptime(uptime()),
});

export const fillVars = (text, vars) =>
  String(text).replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );

/** Throws if a layer has no text or an unknown anchor. */
export const checkLayers = (layers) => {
  for (const layer of layers) {
    if (typeof layer.text !== 'string' || layer.text === '') {
      throw new Error('a text layer needs "text"');
    }
    const anchor = layer.anchor ?? 'center';
    if (!ANCHORS.includes(anchor)) {
      throw new Error(
        `unknown anchor "${anchor}". Use one of: ${ANCHORS.join(', ')}`,
      );
    }
  }
};

/** Writes the layers that show at `frame` over the frame's characters. */
export const stampLayers = (ascii, layers, frame, vars) => {
  const rows = ascii.split('\n').map((line) => [...line]);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  for (const row of rows) while (row.length < w) row.push(' ');

  for (const layer of layers) {
    if (frame < (layer.from ?? 0)) continue;
    if (layer.to !== undefined && frame > layer.to) continue;
    const glyphs = [...fillVars(layer.text, vars)].slice(0, w);
    const anchor = layer.anchor ?? 'center';
    const row = anchor.startsWith('top')
      ? 0
      : anchor.startsWith('bottom')
        ? h - 1
        : Math.floor(h / 2);
    const col = anchor.endsWith('left')
      ? 0
      : anchor.endsWith('right')
        ? w - glyphs.length
        : Math.floor((w - glyphs.length) / 2);
    glyphs.forEach((g, i) => {
      rows[row][col + i] = g;
    });
  }
  return rows.map((r) => r.join('')).join('\n');
};

/** Pads a frame with `n` spaces on each side and `n` blank lines above and below. */
export const addMargin = (ascii, n) => {
  if (!n || n < 1) return ascii;
  const rows = ascii.split('\n');
  const w = Math.max(...rows.map((r) => [...r].length));
  const side = ' '.repeat(n);
  const blank = ' '.repeat(w + 2 * n);
  const padded = rows.map(
    (r) => side + r + ' '.repeat(w - [...r].length) + side,
  );
  const edge = Array.from({ length: n }, () => blank);
  return [...edge, ...padded, ...edge].join('\n');
};
