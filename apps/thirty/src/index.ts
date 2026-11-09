import type { City } from './gen.ts';
import type { Line } from './net.ts';
import { DEFAULTS, defaultOf, TIER_DEFAULTS } from './params.ts';

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
document.body.innerHTML = `<h1>thirty</h1>
<p>Each cell shows the share of jobs it reaches within N minutes. Brighter is better.</p>
<canvas id="c" width="640" height="640"></canvas>
<p><input id="t" type="range" min="0" max="0" value="0" style="width:640px"></p>
<p id="s">Generating…</p>
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
<button>Run</button> <a href="?">Reset</a></form>
<p><small>commit ${GIT_SHA}</small></p>`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const slider = $<HTMLInputElement>('t');
const stats = $('s');
const layer = $<HTMLSelectElement>('l');
const form = $<HTMLFormElement>('f');

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
const STYLE: Record<string, [string, number]> = {
  tram: ['#ffc2dc', 1.5],
  tube: ['#ff9f0a', 2.5],
  rer: ['#ff3b30', 3.5],
  express: ['#ffffff', 5],
};
const fmt = (m: number, N: number) =>
  Number.isFinite(m) ? `${m} min` : `>${2 * N} min`;

function draw() {
  const s = snaps[Number(slider.value)];
  if (!city || !s) return;
  const { w, elev, water, cellM } = city;
  const vals =
    { score: s.score, pop: city.pop, jobs: city.jobs, height: elev }[
      layer.value
    ] ?? s.score;
  const max = vals.reduce((m, x) => Math.max(m, x), 1e-12);
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
        ? [25, 45, 80]
        : [45, 85, 140]
      : ramp(layer.value === 'score' ? vals[i] : Math.sqrt(vals[i] / max)).map(
          (c) => c * shade,
        );
    img.data.set([...rgb, 255], i * 4);
  }
  const off = new OffscreenCanvas(w, w);
  off.getContext('2d')?.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const px = canvas.width / w;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
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
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const c of l.path) ctx.lineTo(...at(c));
    ctx.stroke();
    for (const c of l.stops) valency.set(c, (valency.get(c) ?? 0) + 1);
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  for (const [c, v] of valency) {
    ctx.beginPath();
    ctx.arc(...at(c), 1 + v, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  stats.textContent = `Step ${s.step}/${s.total} ${s.algo} · jobs within ${s.N} min: ${(s.within * 100).toFixed(1)}% · P50 ${fmt(s.p50, s.N)} · P95 ${fmt(s.p95, s.N)} · J ${s.J.toFixed(4)} · cost ${s.cost.toFixed(0)}/${s.budget} · ${s.lines.length} lines · hash ${s.hash}`;
}
