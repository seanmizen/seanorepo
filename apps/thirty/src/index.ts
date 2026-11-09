import type { City } from './gen.ts';
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
  `<label>${k} <input name="${k}" value="${q.get(k) ?? defaultOf(k)}" size="8"></label> `;
const SIZE = 800;
document.body.innerHTML = `<h1>thirty</h1>
<p>Each cell shows the share of jobs it reaches within N minutes. Brighter is better.</p>
<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
<div><canvas id="c" style="width:${SIZE}px;max-width:100%;cursor:grab;touch-action:none"></canvas>
<p><input id="t" type="range" min="0" max="0" value="0" style="width:${SIZE}px;max-width:100%"></p></div>
<div id="k" style="flex:1 1 240px;max-width:340px"></div></div>
<p id="s">Loading…</p>
<p><label>Layer <select id="l"><option>score</option><option>pop</option><option>jobs</option><option>height</option></select></label></p>
<form id="f">${Object.keys(DEFAULTS).map(field).join('')}
<details><summary>Tiers</summary>${Object.entries(TIER_DEFAULTS)
  .map(
    ([t, d]) =>
      `<p>${t}: ${Object.keys(d)
        .map((k) => field(`${t}.${k}`))
        .join('')}</p>`,
  )
  .join('')}</details>
<button>Run</button> <a href="?">Reset</a> · cities: <a href="?city=london">London</a> <a href="?city=lisbon">Lisbon</a></form>
<p><small>commit ${GIT_SHA}${q.get('city') ? ' · Data: © OpenStreetMap contributors (ODbL), GHSL © European Union (CC BY 4.0), Copernicus DEM © ESA/DLR/Airbus' : ''}</small></p>`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const slider = $<HTMLInputElement>('t');
const stats = $('s');
const layer = $<HTMLSelectElement>('l');
const form = $<HTMLFormElement>('f');
const key = $('k');
canvas.width = canvas.height = SIZE * devicePixelRatio;

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
    const k = Math.min(40, Math.max(1, view.k * Math.exp(-e.deltaY * 0.002)));
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
  tram: ['#ffc2dc', 1.5],
  tube: ['#ff9f0a', 2.5],
  rer: ['#ff3b30', 3.5],
  express: ['#ffffff', 5],
};
const fmt = (m: number, N: number) =>
  Number.isFinite(m) ? `${m} min` : `>${2 * N} min`;

let params: ReturnType<typeof parse> | null = null;
try {
  params = parse(q.toString());
} catch {
  // The worker reports the error.
}

function drawKey(max: number) {
  const rgb = (c: number[]) => `rgb(${c.join(',')})`;
  const N = params?.N ?? DEFAULTS.N;
  const label = {
    score: [
      `0% of jobs within ${N} min`,
      `100%`,
      `Fades to 0 at ${2 * N} min.`,
    ],
    pop: ['few homes', 'many', 'Square-root scale.'],
    jobs: ['few jobs', 'many', 'Square-root scale.'],
    height: ['0 m', `${max.toFixed(0)} m`, 'Square-root scale.'],
  }[layer.value] ?? ['', '', ''];
  const swatch = (c: number[]) =>
    `<span style="display:inline-block;width:14px;height:14px;background:${rgb(c)};vertical-align:middle"></span>`;
  const tiers = (params?.tiers ?? Object.keys(STYLE))
    .map((t) => {
      const d = params?.tierDefs[t] ?? TIER_DEFAULTS[t];
      const [c, w] = STYLE[t];
      return `<p><svg width="40" height="14" style="background:#222;vertical-align:middle"><line x1="4" y1="7" x2="36" y2="7" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/></svg>
 <b>${t}</b>: stops ${d.spacing >= 1000 ? `${d.spacing / 1000} km` : `${d.spacing} m`} apart, ${d.speed} km/h, every ${d.headway} min</p>`;
    })
    .join('');
  key.innerHTML = `<h3>Key</h3>
<div style="height:14px;background:linear-gradient(to right,${RAMP.map(rgb).join(',')})"></div>
<p style="display:flex;justify-content:space-between;margin:2px 0"><small>${label[0]}</small><small>${label[1]}</small></p>
<p><small>${label[2]} Shading shows hills.</small></p>
<p>${swatch(SEA)} sea, lake: no walking<br>${swatch(RIVER)} river: walking ×5 (few bridges)</p>
${tiers}
<p><svg width="40" height="14" style="background:#222;vertical-align:middle"><circle cx="10" cy="7" r="2" fill="#fff" stroke="#000"/><circle cx="26" cy="7" r="5" fill="#fff" stroke="#000"/></svg> station: bigger = more lines</p>
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
  if (keyFor !== layer.value) {
    keyFor = layer.value;
    drawKey(max);
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
  // Lines and stations get thinner relative to the map as you zoom in, so detail stays visible.
  const px = canvas.width / w;
  const lw = devicePixelRatio / Math.sqrt(view.k);
  const at = (c: number): [number, number] => [
    ((c % w) + 0.5) * px,
    (Math.floor(c / w) + 0.5) * px,
  ];
  ctx.lineCap = ctx.lineJoin = 'round';
  const order = Object.keys(STYLE);
  const valency = new Map<number, number>();
  for (const l of [...s.lines].sort(
    (a, b) => order.indexOf(a.tier) - order.indexOf(b.tier),
  )) {
    const [color, width] = STYLE[l.tier];
    ctx.strokeStyle = color;
    ctx.lineWidth = width * lw;
    ctx.beginPath();
    for (const c of l.path) ctx.lineTo(...at(c));
    ctx.stroke();
    for (const c of l.stops) valency.set(c, (valency.get(c) ?? 0) + 1);
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = lw;
  for (const [c, v] of valency) {
    ctx.beginPath();
    ctx.arc(...at(c), (1 + v) * lw, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  stats.textContent = `Step ${s.step}/${s.total} ${s.algo} · jobs within ${s.N} min: ${(s.within * 100).toFixed(1)}% · P50 ${fmt(s.p50, s.N)} · P95 ${fmt(s.p95, s.N)} · J ${s.J.toFixed(4)} · cost ${s.cost.toFixed(0)}/${s.budget} · ${s.lines.length} lines · hash ${s.hash} · ${((w * cellM) / 1000).toFixed(0)} km across`;
}
