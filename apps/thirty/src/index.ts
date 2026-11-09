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
const field = (k: string) =>
  `<label>${k} <input name="${k}" value="${q.get(k) ?? defaultOf(k)}" size="6"></label> `;
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
@media (max-width:700px){#side{height:auto}}
</style>
<div id="app"><canvas id="c"></canvas><div id="side">
<h1>thirty</h1>
<p>Each cell shows the share of jobs it reaches within N minutes. Brighter is better.</p>
<p id="s">Loading…</p>
<p><input id="t" type="range" min="0" max="0" value="0" aria-label="Step"></p>
<p><label>Map <select id="l">${options(['score', 'pop', 'jobs', 'height'])}</select></label>
<label>Lines <select id="m">${options(['by tier', 'by line'])}</select></label></p>
<div id="k"></div>
<form id="f"><h3>Setup</h3>${Object.keys(DEFAULTS).map(field).join('')}
<details><summary>Tiers</summary>${Object.entries(TIER_DEFAULTS)
  .map(
    ([t, d]) =>
      `<p>${t}: ${Object.keys(d)
        .map((k) => field(`${t}.${k}`))
        .join('')}</p>`,
  )
  .join('')}</details>
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
  for (const [k, v] of new FormData(form))
    if (String(v) !== String(defaultOf(k))) out.set(k, String(v));
  location.search = out.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
};

let city: City;
const snaps: Snap[] = [];
const worker = new Worker(new URL('./worker.ts', import.meta.url));
worker.onmessage = ({ data }) => {
  if (data.type === 'city') city = data.city;
  else if (data.type === 'snap') {
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
      ? `<div id="lines">${s.lines.map((l, i) => `<div>${svgLine(lineColor(l, i), STYLE[l.tier][1])} line ${i + 1}: ${l.tier}, ${l.stops.length} stops, ${((l.path.length * (city?.cellM ?? 0)) / 1000).toFixed(0)} km</div>`).join('')}</div>`
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
<p><svg width="40" height="14" style="background:#222;vertical-align:middle"><circle cx="10" cy="7" r="3" fill="#fff" stroke="#000"/><line x1="22" y1="7" x2="34" y2="7" stroke="#000" stroke-width="8" stroke-linecap="round"/><line x1="22" y1="7" x2="34" y2="7" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>
station on the lines that stop there. A long marker is an interchange. Lines that share a station touch. Others keep a gap.</p>
<p><small>Scroll to zoom. Drag to pan. Double-click to reset.</small></p>`;
}

let keyFor = '';
function draw() {
  const s = snaps[Number(slider.value)];
  if (!city || !s) return;
  const { w, elev, water, cellM } = city;
  const vals =
    { score: s.score, pop: city.pop, jobs: city.jobs, height: elev }[
      layer.value
    ] ?? s.score;
  const max = vals.reduce((m, x) => Math.max(m, x), 1e-12);
  const want = `${layer.value}|${lineMode.value}|${lineMode.value === 'by line' ? s.step : ''}`;
  if (keyFor !== want) {
    keyFor = want;
    drawKey(max, s);
  }
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
  const off = new OffscreenCanvas(w, w);
  off.getContext('2d')?.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.k, 0, 0, view.k, view.x, view.y);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

  // Lines get thinner relative to the map as you zoom in, so detail stays visible.
  const px = canvas.width / w;
  const lw = devicePixelRatio / Math.sqrt(view.k);
  const at = (c: number): Pt => [
    ((c % w) + 0.5) * px,
    (Math.floor(c / w) + 0.5) * px,
  ];
  const order = Object.keys(STYLE);
  const ids = s.lines
    .map((_, i) => i)
    .sort(
      (a, b) =>
        order.indexOf(s.lines[a].tier) - order.indexOf(s.lines[b].tier) ||
        a - b,
    );
  const lines = ids.map((i) => s.lines[i]);
  const width = (l: Line) => STYLE[l.tier][1] * lw;
  const { pts, stations } = layout(lines, at, width, 1.5 * lw);
  ctx.lineCap = ctx.lineJoin = 'round';
  lines.forEach((l, j) => {
    ctx.strokeStyle = lineColor(l, ids[j]);
    ctx.lineWidth = width(l);
    ctx.beginPath();
    for (const p of pts[j]) ctx.lineTo(...p);
    ctx.stroke();
  });
  // A station is a white marker across the lines that stop there.
  for (const list of stations.values()) {
    let [a, b] = [list[0].p, list[0].p];
    let far = 0;
    for (const u of list)
      for (const v of list) {
        const d = Math.hypot(u.p[0] - v.p[0], u.p[1] - v.p[1]);
        if (d > far) [a, b, far] = [u.p, v.p, d];
      }
    const r = Math.max(...list.map((u) => width(lines[u.i]))) / 2 + 1.2 * lw;
    for (const [color, extra] of [
      ['#000', lw],
      ['#fff', 0],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * r + 2 * extra - 2 * lw;
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(b[0] + 1e-3, b[1]);
      ctx.stroke();
    }
  }
  stats.textContent = `Step ${s.step}/${s.total} ${s.algo} · jobs within ${s.N} min: ${(s.within * 100).toFixed(1)}% · P50 ${fmt(s.p50, s.N)} · P95 ${fmt(s.p95, s.N)} · J ${s.J.toFixed(4)} · cost ${s.cost.toFixed(0)}/${s.budget} · ${s.lines.length} lines · hash ${s.hash} · ${((w * cellM) / 1000).toFixed(0)} km across`;
}

fit();
