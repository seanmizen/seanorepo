import type { City } from './gen.ts';
import { layout, type Pt } from './layout.ts';
import type { Line } from './net.ts';
import { DEFAULTS, defaultOf, parse, TIER_DEFAULTS } from './params.ts';

declare const GIT_SHA: string;
type Snap = {
  step: number;
  total: number;
  algo: string;
  J: number;
  score: Float32Array;
  within: number;
  p50: number;
  p95: number;
  lines: Line[];
  cost: number;
  hash: string;
  N: number;
  budget: number;
};

const q = new URLSearchParams(location.search);
const value = (k: string) => q.get(k) ?? defaultOf(k);
// The setup form, in groups. A parameter in no group goes in Other, so new ones show with no UI change.
const GROUPS: [string, string[]][] = [
  ['City', ['city', 'seed', 'size', 'cell', 'sea', 'rivers', 'hills', 'warp']],
  ['Run', ['algo', 'steps', 'run', 'candidates', 'gpu']],
  ['Goal', ['N', 'walk', 'budget']],
  ['Stations', ['interchange', 'snap']],
  ['Lines', ['shapes', 'turn', 'join']],
];
const HINT: Record<string, string> = {
  city: 'london or lisbon. Empty: generate a city.',
  seed: 'City seed.',
  size: 'Cells on each side.',
  cell: 'Metres for each cell.',
  sea: 'Share of the map under water, 0 to 1.',
  rivers: 'Number of rivers.',
  hills: '0 to 1.',
  warp: 'Coast shape, 0 to 1.',
  algo: 'greedy, anneal or random. A chain: greedy:20,anneal:100.',
  steps: 'Steps for an algorithm with no count.',
  run: 'Seed for the algorithm.',
  candidates: 'Candidate lines for each greedy step.',
  N: 'Target trip time in minutes.',
  walk: 'Longest walk leg in minutes: to a station, from a station, between stations, or the whole trip. 0: the same as N.',
  gpu: '1: score on the GPU if the browser has WebGPU. 0: on the CPU. The result is the same.',
  budget: 'Total cost of track and stations.',
  interchange: 'Share of the station cost to stop at an existing station.',
  snap: 'Radius to move a stop to an existing station, as a share of the tier spacing. 0: off.',
  shapes:
    'Candidate shapes and their weights: line, via, arc. Example: line:1,via:1,arc:1.',
  turn: 'Largest turn in degrees at a via point or a join station. 180: no limit.',
  join: 'Share of anneal moves that merge two lines with a shared end station.',
};
const UNIT: Record<string, string> = {
  spacing: 'm',
  speed: 'km/h',
  headway: 'min',
  dwell: 's',
  accel: 'm/s²',
  cost: 'per km',
  station: 'each',
  minKm: 'km',
  maxKm: 'km',
};
const field = (k: string) =>
  `<label${k === 'algo' || k === 'shapes' ? ' class="wide"' : ''} title="${HINT[k] ?? ''}">${k}<input name="${k}" value="${value(k)}"></label>`;
const grouped = new Set([...GROUPS.flatMap(([, ks]) => ks), 'tiers']);
const groups = [
  ...GROUPS,
  ['Other', Object.keys(DEFAULTS).filter((k) => !grouped.has(k))] as [
    string,
    string[],
  ],
]
  .filter(([, ks]) => ks.length)
  .map(
    ([name, ks]) =>
      `<fieldset><legend>${name}</legend>${ks.map(field).join('')}</fieldset>`,
  )
  .join('');
const TIER_FIELDS = Object.keys(TIER_DEFAULTS.tram);
const tiersOn = String(value('tiers')).split(',');
const tierTable = `<fieldset><legend>Tiers</legend><div style="overflow-x:auto"><table>
<tr><th></th>${TIER_FIELDS.map((f) => `<th>${f}<br><small>${UNIT[f] ?? ''}</small></th>`).join('')}</tr>
${Object.keys(TIER_DEFAULTS)
  .map(
    (t) =>
      `<tr><th><label><input type="checkbox" name="tier-on" value="${t}"${tiersOn.includes(t) ? ' checked' : ''}> ${t}</label></th>${TIER_FIELDS.map((f) => `<td><input name="${t}.${f}" value="${value(`${t}.${f}`)}" aria-label="${t} ${f}"></td>`).join('')}</tr>`,
  )
  .join('')}</table></div></fieldset>`;
const options = (xs: string[]) =>
  xs.map((x) => `<option>${x}</option>`).join('');

// One screen: the map on the left, everything else in a column on the right.
document.body.innerHTML = `<style>
body{margin:0;font:13px/1.35 system-ui,sans-serif;background:#fff}
#app{display:flex;flex-wrap:wrap;height:100vh}
#c{display:block;cursor:grab;touch-action:none;background:#111}
#side{flex:1 1 320px;height:100vh;overflow-y:auto;padding:8px 12px;box-sizing:border-box}
#side h1{margin:0 0 4px;font-size:20px}
#side p,#side h3{margin:6px 0}
#t{width:100%}
#lines{max-height:160px;overflow-y:auto}
fieldset{border:1px solid #ccc;margin:6px 0;padding:2px 8px 6px}
legend{font-weight:600}
fieldset label{display:inline-flex;flex-direction:column;width:84px;margin:2px 6px 2px 0;font-size:12px}
fieldset label.wide{width:180px}
fieldset input{width:100%;box-sizing:border-box}
table{border-collapse:collapse}
th{font-weight:500;text-align:left;font-size:12px;padding:0 2px;white-space:nowrap}
th label{display:inline;width:auto;margin:0}
td input{width:44px}
input[type=checkbox]{width:auto}
@media (max-width:700px){#side{height:auto}}
</style>
<div id="app"><canvas id="c"></canvas><div id="side">
<h1>thirty</h1>
<p>Each cell shows the share of jobs it reaches within N minutes. Brighter is better.</p>
<p id="s">Loading…</p>
<p><input id="t" type="range" min="0" max="0" value="0" aria-label="Step"></p>
<p><label>Map <select id="l">${options(['score', 'pop', 'jobs', 'height'])}</select></label>
<label>Lines <select id="m">${options(['by tier', 'by line'])}</select></label>
<label>Stops <select id="st">${options(['dots', 'ticks'])}</select></label></p>
<div id="k"></div>
<form id="f"><h3>Setup</h3>${groups}${tierTable}
<p><button>Run</button> <a href="?">Reset</a> · cities: <a href="?city=london">London</a> <a href="?city=lisbon">Lisbon</a></p></form>
<p><small>commit ${GIT_SHA}${q.get('city') ? ' · Data: © OpenStreetMap contributors (ODbL), GHSL © European Union (CC BY 4.0), Copernicus DEM © ESA/DLR/Airbus' : ''}</small></p>
</div></div>`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const slider = $<HTMLInputElement>('t');
const stats = $('s');
const layer = $<HTMLSelectElement>('l');
const lineMode = $<HTMLSelectElement>('m');
const stopMode = $<HTMLSelectElement>('st');
const form = $<HTMLFormElement>('f');
const key = $('k');

// The canvas fills the height of the window, and leaves 320 px for the column.
function fit() {
  const css = Math.max(280, Math.min(innerHeight, innerWidth - 320));
  canvas.style.width = canvas.style.height = `${css}px`;
  canvas.width = canvas.height = Math.round(css * devicePixelRatio);
  draw();
}
addEventListener('resize', fit);

// Only values that differ from the defaults go in the URL.
form.onsubmit = (e) => {
  e.preventDefault();
  const out = new URLSearchParams();
  const data = new FormData(form);
  for (const [k, v] of data)
    if (k !== 'tier-on' && String(v) !== String(defaultOf(k)))
      out.set(k, String(v));
  const tiers = data.getAll('tier-on').join(',');
  if (tiers !== DEFAULTS.tiers) out.set('tiers', tiers);
  location.search = out.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
};

let city: City;
const snaps: Snap[] = [];
const worker = new Worker(new URL('./worker.ts', import.meta.url));
worker.onmessage = ({ data }) => {
  if (data.type === 'city') {
    city = data.city;
    document.body.dataset.gpu = data.gpu ? '1' : '0';
  } else if (data.type === 'snap') {
    const follow = slider.value === slider.max;
    snaps.push(data);
    slider.max = String(snaps.length - 1);
    if (follow) slider.value = slider.max;
    if (follow) draw();
  } else if (data.type === 'done') document.body.dataset.done = data.hash;
  else {
    stats.textContent = data.message;
    console.error(data.message);
    document.body.dataset.done = 'error';
  }
};
worker.postMessage(q.toString());
slider.oninput = () => draw();
layer.onchange = () => draw();
lineMode.onchange = () => draw();
stopMode.onchange = () => draw();

// Zoom and pan. The view maps canvas pixels at zoom 1 to canvas pixels now.
const view = { k: 1, x: 0, y: 0 };
let drag: [number, number] | null = null;
const toCanvas = (cx: number, cy: number) => {
  const r = canvas.getBoundingClientRect();
  const f = canvas.width / r.width;
  return [(cx - r.left) * f, (cy - r.top) * f, f];
};
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [mx, my] = toCanvas(e.clientX, e.clientY);
    const k = Math.min(
      40,
      Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.002)),
    );
    view.x = mx - ((mx - view.x) * k) / view.k;
    view.y = my - ((my - view.y) * k) / view.k;
    view.k = k;
    draw();
  },
  { passive: false },
);
canvas.onpointerdown = (e) => {
  drag = [e.clientX, e.clientY];
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  const f = toCanvas(0, 0)[2];
  view.x += (e.clientX - drag[0]) * f;
  view.y += (e.clientY - drag[1]) * f;
  drag = [e.clientX, e.clientY];
  draw();
};
canvas.onpointerup = () => {
  drag = null;
};
canvas.ondblclick = () => {
  Object.assign(view, { k: 1, x: 0, y: 0 });
  draw();
};

// Viridis-like ramp: lightness rises with value, so it reads without colour vision.
const RAMP = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];
const ramp = (x: number) => {
  const v = Math.min(1, Math.max(0, x)) * 4;
  const i = Math.min(3, Math.floor(v));
  return RAMP[i].map((c, j) => c + (RAMP[i + 1][j] - c) * (v - i));
};
const SEA = [25, 45, 80];
const RIVER = [45, 85, 140];
const STYLE: Record<string, [string, number]> = {
  express: ['#ffffff', 5],
  rer: ['#ff3b30', 3.5],
  tube: ['#ff9f0a', 2.5],
  tram: ['#ffc2dc', 1.5],
};
// Distinct line colours (Trubetskoy's 20, without the darkest).
const PALETTE = [
  '#e6194b',
  '#3cb44b',
  '#ffe119',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#fabebe',
  '#008080',
  '#e6beff',
  '#9a6324',
  '#fffac8',
  '#aaffc3',
  '#808000',
  '#ffd8b1',
  '#ffffff',
];
const fmt = (m: number, N: number) =>
  Number.isFinite(m) ? `${m} min` : `>${2 * N} min`;
const lineColor = (l: Line, id: number) =>
  lineMode.value === 'by line'
    ? PALETTE[id % PALETTE.length]
    : STYLE[l.tier][0];
const svgLine = (c: string, w: number) =>
  `<svg width="40" height="14" style="background:#222;vertical-align:middle"><line x1="4" y1="7" x2="36" y2="7" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/></svg>`;

let params: ReturnType<typeof parse> | null = null;
try {
  params = parse(q.toString());
} catch {
  // The worker reports the error.
}

function drawKey(max: number, s: Snap) {
  const rgb = (c: number[]) => `rgb(${c.join(',')})`;
  const N = params?.N ?? DEFAULTS.N;
  const label = {
    score: [
      `0% of jobs within ${N} min`,
      '100%',
      `Fades to 0 at ${2 * N} min.`,
    ],
    pop: ['few homes', 'many', 'Square-root scale.'],
    jobs: ['few jobs', 'many', 'Square-root scale.'],
    height: ['0 m', `${max.toFixed(0)} m`, 'Square-root scale.'],
  }[layer.value] ?? ['', '', ''];
  const swatch = (c: number[]) =>
    `<span style="display:inline-block;width:14px;height:14px;background:${rgb(c)};vertical-align:middle"></span>`;
  const tierText = (t: string) => {
    const d = params?.tierDefs[t] ?? TIER_DEFAULTS[t];
    return `<b>${t}</b>: stops ${d.spacing >= 1000 ? `${d.spacing / 1000} km` : `${d.spacing} m`} apart, ${d.speed} km/h, every ${d.headway} min`;
  };
  const tiers =
    lineMode.value === 'by line'
      ? `<div id="lines">${s.lines.map((l, i) => `<div>${svgLine(lineColor(l, i), STYLE[l.tier][1])} line ${i + 1}: ${l.tier} ${l.shape}${l.loop ? ' loop' : ''}, ${l.stops.length} stops, ${((l.path.length * (city?.cellM ?? 0)) / 1000).toFixed(0)} km</div>`).join('')}</div>`
      : (params?.tiers ?? Object.keys(STYLE))
          .map(
            (t) => `<p>${svgLine(STYLE[t][0], STYLE[t][1])} ${tierText(t)}</p>`,
          )
          .join('');
  key.innerHTML = `<h3>Key</h3>
<div style="height:12px;background:linear-gradient(to right,${RAMP.map(rgb).join(',')})"></div>
<p style="display:flex;justify-content:space-between;margin:2px 0"><small>${label[0]}</small><small>${label[1]}</small></p>
<p><small>${label[2]} Shading shows hills.</small></p>
<p>${swatch(SEA)} sea, lake: no walking ${swatch(RIVER)} river: walking ×5</p>
${tiers}
<p><svg width="56" height="16" style="background:#222;vertical-align:middle"><line x1="2" y1="8" x2="16" y2="8" stroke="#ff9f0a" stroke-width="3"/><line x1="9" y1="8" x2="9" y2="3" stroke="#ff9f0a" stroke-width="2"/><circle cx="30" cy="8" r="5" fill="#fff" stroke="#000"/><circle cx="40" cy="8" r="5" fill="#fff" stroke="#000"/><circle cx="35" cy="8" r="4" fill="#fff"/></svg>
a dot or a tick (the Stops picker): a stop on one line. A round node: an interchange, one node for each three lines. Lines run straight between stations, then 45°. The drawing is a diagram: the real track follows the land.</p>
<p><small>Scroll to zoom. Drag to pan. Double-click to reset.</small></p>`;
}

// The map layer (hillshade and values) of one snapshot, one pixel for each cell.
// draw() makes it again only when the snapshot or the layer changes, so pan and zoom only copy it.
let mapFor = '';
let map = new OffscreenCanvas(1, 1);
let max = 1e-12;
function drawMap(s: Snap) {
  const { w, elev, water, cellM } = city;
  const vals =
    { score: s.score, pop: city.pop, jobs: city.jobs, height: elev }[
      layer.value
    ] ?? s.score;
  max = vals.reduce((m, x) => Math.max(m, x), 1e-12);
  const img = new ImageData(w, w);
  for (let i = 0; i < w * w; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const dx =
      elev[y * w + Math.min(w - 1, x + 1)] - elev[y * w + Math.max(0, x - 1)];
    const dy =
      elev[Math.min(w - 1, y + 1) * w + x] - elev[Math.max(0, y - 1) * w + x];
    const shade = Math.min(1.3, Math.max(0.6, 1 - ((dx + dy) / cellM) * 1.5));
    const rgb = water[i]
      ? water[i] === 1
        ? SEA
        : RIVER
      : ramp(layer.value === 'score' ? vals[i] : Math.sqrt(vals[i] / max)).map(
          (c) => c * shade,
        );
    img.data.set([...rgb, 255], i * 4);
  }
  map = new OffscreenCanvas(w, w);
  map.getContext('2d')?.putImageData(img, 0, 0);
}

let keyFor = '';
function draw() {
  const s = snaps[Number(slider.value)];
  if (!city || !s) return;
  const { w, cellM } = city;
  if (mapFor !== `${slider.value}|${layer.value}`) {
    mapFor = `${slider.value}|${layer.value}`;
    drawMap(s);
  }
  const want = `${layer.value}|${lineMode.value}|${lineMode.value === 'by line' ? s.step : ''}`;
  if (keyFor !== want) {
    keyFor = want;
    drawKey(max, s);
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.k, 0, 0, view.k, view.x, view.y);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(map, 0, 0, canvas.width, canvas.height);

  // Lines get thinner relative to the map as you zoom in, so detail stays visible.
  const px = canvas.width / w;
  const lw = devicePixelRatio / Math.sqrt(view.k);
  const u = STYLE.tube[1] * lw; // One line width on the tube map.
  const at = (c: number): Pt => [
    ((c % w) + 0.5) * px,
    (Math.floor(c / w) + 0.5) * px,
  ];
  // Schematic legs between two stations: straight, then 45°. Always built from the
  // lower cell index, so all lines between the same two stations share both legs.
  const legs = (a: number, b: number) => {
    const [p, e] = a < b ? [a, b] : [b, a];
    const dx = (e % w) - (p % w);
    const dy = Math.floor(e / w) - Math.floor(p / w);
    const d = Math.min(Math.abs(dx), Math.abs(dy));
    const k = e - Math.sign(dx) * d - Math.sign(dy) * d * w;
    const out = k === p || k === e ? [p, e] : [p, k, e];
    return a < b ? out : out.reverse();
  };
  // One-cell steps along a straight or 45° leg. Bundling works on these steps,
  // so lines that use the same cells run side by side whatever their stations are.
  const cells = (a: number, b: number) => {
    const dx = Math.sign((b % w) - (a % w));
    const dy = Math.sign(Math.floor(b / w) - Math.floor(a / w));
    const out: number[] = [];
    for (let c = a; c !== b; ) {
      c += dx + dy * w;
      out.push(c);
    }
    return out;
  };
  const order = Object.keys(STYLE);
  const ids = s.lines
    .map((_, i) => i)
    .sort(
      (a, b) =>
        order.indexOf(s.lines[a].tier) - order.indexOf(s.lines[b].tier) ||
        a - b,
    );
  const lines = ids.map((i) => {
    const l = s.lines[i];
    // A loop draws back to its first stop.
    const st = l.loop ? [...l.stops, l.stops[0]] : l.stops;
    return {
      ...l,
      path: st
        .flatMap((c, k) => (k ? legs(st[k - 1], c).slice(1) : [c]))
        .flatMap((c, k, p) => (k ? cells(p[k - 1], c) : [c])),
    };
  });
  const width = (l: Line) =>
    lineMode.value === 'by line' ? u : STYLE[l.tier][1] * lw;
  const { pts, stations } = layout(lines, at, width, 0.6 * u);
  // Rounded corners: each bend is an arc no wider than half of either leg.
  const stroke = (all: Pt[], loop: boolean) => {
    // Remove points where the line goes straight on, so corners get their full radius.
    const p = all.filter((q, k) => {
      if (k === 0 || k === all.length - 1) return true;
      const [a, b] = [all[k - 1], all[k + 1]];
      return (
        Math.abs(
          (q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0]),
        ) > 1e-6
      );
    });
    ctx.beginPath();
    ctx.moveTo(...p[0]);
    for (let k = 1; k < p.length - 1; k++) {
      const half = (q: Pt) => Math.hypot(q[0] - p[k][0], q[1] - p[k][1]) / 2;
      ctx.arcTo(
        ...p[k],
        ...p[k + 1],
        Math.min(3 * u, half(p[k - 1]), half(p[k + 1])),
      );
    }
    ctx.lineTo(...p[p.length - 1]);
    if (loop) ctx.closePath();
    ctx.stroke();
  };
  ctx.lineCap = ctx.lineJoin = 'round';
  lines.forEach((l, j) => {
    ctx.strokeStyle = lineColor(l, ids[j]);
    ctx.lineWidth = width(l);
    stroke(pts[j], l.loop);
  });
  // Tube-map stations. One line: a dot, or a tick on its side. Two or more: round nodes
  // 3u wide, one node for each three lines, touching, so they draw as one shape.
  for (const list of stations.values()) {
    if (list.length === 1 && stopMode.value === 'dots') {
      for (const [color, r] of [
        ['#000', 0.9 * u + 0.5 * lw],
        ['#fff', 0.9 * u - 0.5 * lw],
      ] as const) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(...list[0].p, r, 0, 7);
        ctx.fill();
      }
      continue;
    }
    if (list.length === 1) {
      const { i, p } = list[0];
      const path = pts[i];
      const k = path.indexOf(p);
      const [a, b] = [
        path[Math.max(0, k - 1)],
        path[Math.min(path.length - 1, k + 1)],
      ];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const t = width(lines[i]) / 2 + 0.7 * u;
      ctx.strokeStyle = lineColor(lines[i], ids[i]);
      ctx.lineWidth = 0.8 * u;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(...p);
      ctx.lineTo(
        p[0] - ((b[1] - a[1]) / len) * t,
        p[1] + ((b[0] - a[0]) / len) * t,
      );
      ctx.stroke();
      ctx.lineCap = 'round';
      continue;
    }
    // Sort the lines along the direction they spread in, then group them in threes.
    let axis: Pt = [1, 0];
    let far = 0;
    for (const v of list)
      for (const z of list) {
        const d = Math.hypot(v.p[0] - z.p[0], v.p[1] - z.p[1]);
        if (d > far)
          [axis, far] = [[(z.p[0] - v.p[0]) / d, (z.p[1] - v.p[1]) / d], d];
      }
    const sorted = [...list].sort(
      (v, z) =>
        v.p[0] * axis[0] +
        v.p[1] * axis[1] -
        (z.p[0] * axis[0] + z.p[1] * axis[1]),
    );
    const nodes: Pt[] = [];
    for (let g = 0; g < sorted.length; g += 3) {
      const group = sorted.slice(g, g + 3);
      nodes.push([
        group.reduce((m, v) => m + v.p[0], 0) / group.length,
        group.reduce((m, v) => m + v.p[1], 0) / group.length,
      ]);
    }
    // Space the nodes exactly one diameter apart, centred on their mean.
    const mid: Pt = [
      nodes.reduce((m, n) => m + n[0], 0) / nodes.length,
      nodes.reduce((m, n) => m + n[1], 0) / nodes.length,
    ];
    const placed = nodes.map(
      (_, g): Pt => [
        mid[0] + axis[0] * 3 * u * (g - (nodes.length - 1) / 2),
        mid[1] + axis[1] * 3 * u * (g - (nodes.length - 1) / 2),
      ],
    );
    for (const [color, r] of [
      ['#000', 1.5 * u + lw],
      ['#fff', 1.5 * u - lw],
    ] as const) {
      ctx.fillStyle = color;
      for (const n of placed) {
        ctx.beginPath();
        ctx.arc(...n, r, 0, 7);
        ctx.fill();
      }
    }
  }
  stats.textContent = `Step ${s.step}/${s.total} ${s.algo} · jobs within ${s.N} min: ${(s.within * 100).toFixed(1)}% · P50 ${fmt(s.p50, s.N)} · P95 ${fmt(s.p95, s.N)} · J ${s.J.toFixed(4)} · cost ${s.cost.toFixed(0)}/${s.budget} · ${s.lines.length} lines · hash ${s.hash} · ${((w * cellM) / 1000).toFixed(0)} km across`;
}

fit();
