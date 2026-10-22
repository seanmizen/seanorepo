// Demo page: one station, one train, controls and a live spectrum.

import {
  type MotorType,
  type StockId,
  TubeStation,
  TubeTrain,
} from '../src/index';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`demo: element #${id} is missing.`);
  return el as T;
};

const slider = (id: string) => $<HTMLInputElement>(id);
const controls = {
  speed: slider('speed'),
  throttle: slider('throttle'),
  brake: slider('brake'),
  distance: slider('distance'),
  curve: slider('curve'),
  volume: slider('volume'),
};
const stockSel = $<HTMLSelectElement>('stock');
const motorSel = $<HTMLSelectElement>('motor');
const physics = $<HTMLInputElement>('physics');
const trackCurves = $<HTMLInputElement>('trackCurves');
const loop = $<HTMLInputElement>('loop');
const readout = $<HTMLDListElement>('readout');
const canvas = $<HTMLCanvasElement>('spectrum');

let ctx: AudioContext | null = null;
let station: TubeStation | null = null;
let train: TubeTrain | null = null;
let analyser: AnalyserNode | null = null;
let nextService = 0;

const buildTrain = () => {
  if (!station) return;
  const prev = train?.state;
  train?.dispose();
  const motor = (motorSel.value || undefined) as MotorType | undefined;
  train = new TubeTrain(station, {
    stock: stockSel.value as StockId,
    motor,
    physics: physics.checked,
  });
  if (prev) {
    train.setPosition(prev.frontX);
    train.setSpeed(prev.speed);
  } else {
    train.setDistance(Number(controls.distance.value));
  }
  applyControls();
};

const applyControls = () => {
  if (!train) return;
  train.setSpeed(Number(controls.speed.value));
  train.setThrottle(Number(controls.throttle.value));
  train.setBrake(Number(controls.brake.value));
  train.setCurve(trackCurves.checked ? null : Number(controls.curve.value));
  train.setPhysics(physics.checked);
};

const start = async () => {
  if (ctx) {
    await ctx.resume();
    return;
  }
  ctx = new AudioContext({ latencyHint: 'playback' });
  station = new TubeStation(ctx, { volume: Number(controls.volume.value) });
  analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.6;
  station.output.connect(ctx.destination);
  station.output.connect(analyser);
  station.start();
  buildTrain();
  $<HTMLButtonElement>('start').textContent = 'Audio on';
  requestAnimationFrame(frame);
};

const withTrain = (fn: (t: TubeTrain, s: TubeStation) => void) => async () => {
  await start();
  if (train && station) fn(train, station);
};

$('start').addEventListener('click', start);
stockSel.addEventListener('change', buildTrain);
motorSel.addEventListener('change', () => {
  if (!train) return;
  if (motorSel.value) train.setMotorType(motorSel.value as MotorType);
  else buildTrain();
});
$('arrival').addEventListener(
  'click',
  withTrain((t) => void t.playArrival()),
);
$('departure').addEventListener(
  'click',
  withTrain((t) => void t.playDeparture()),
);
$('service').addEventListener(
  'click',
  withTrain((t, s) => {
    nextService = s.now + 12;
    void t.playService({ at: nextService });
  }),
);
$('open').addEventListener(
  'click',
  withTrain((t) => t.doorsOpen()),
);
$('close').addEventListener(
  'click',
  withTrain((t) => t.doorsClose()),
);
$('stopScript').addEventListener(
  'click',
  withTrain((t) => t.stopScript()),
);
physics.addEventListener('change', applyControls);
trackCurves.addEventListener('change', applyControls);

for (const [name, el] of Object.entries(controls)) {
  el.addEventListener('input', () => {
    if (name === 'volume') {
      station?.setVolume(Number(el.value));
      return;
    }
    if (!train) return;
    train.stopScript();
    loop.checked = false;
    if (name === 'distance') train.setDistance(Number(el.value));
    if (name === 'curve') trackCurves.checked = false;
    applyControls();
  });
}

const fmt = (v: number, d = 1) => v.toFixed(d);

const frame = () => {
  requestAnimationFrame(frame);
  if (!train || !station || !analyser) return;
  const s = train.state;

  // Repeat the service on the 70 s timeline of the game.
  if (loop.checked && !s.scripted && station.now > nextService) {
    nextService = Math.max(nextService + 70, station.now + 12);
    void train.playService({ at: nextService });
  }

  // While a script runs, the sliders follow it.
  if (s.scripted || physics.checked) {
    controls.speed.value = String(s.speed);
    controls.distance.value = String(Math.round(s.distance));
  }
  if (s.scripted) {
    controls.throttle.value = String(s.throttle);
    controls.brake.value = String(s.brake);
  }
  for (const [name, el] of Object.entries(controls)) {
    const out = document.getElementById(`${name}Out`);
    if (out) out.textContent = name === 'distance' ? `${el.value} m` : el.value;
  }
  const rows: [string, string][] = [
    ['speed', `${fmt(s.speed)} m/s (${fmt(s.speed * 3.6, 0)} km/h)`],
    ['distance', `${fmt(s.distance, 0)} m`],
    ['gear mesh', `${fmt(s.meshHz, 0)} Hz`],
    s.motor === 'dc-camshaft'
      ? [
          'camshaft',
          s.notch < 0
            ? 'off'
            : `notch ${s.notch + 1}, ${fmt(s.current, 2)} p.u.`,
        ]
      : [
          'inverter',
          s.f1 > 0
            ? `f1 ${fmt(s.f1)} Hz, carrier ${fmt(s.carrier, 0)} Hz`
            : 'gated off',
        ],
    ['brake cyl.', fmt(s.cylinder, 2)],
    [
      'reservoir',
      `${fmt(s.reservoir, 3)}${s.compressorOn ? ' (compressor on)' : ''}`,
    ],
    ['doors', s.doorsOpen ? 'open' : 'closed'],
    ['script', s.scripted ? 'running' : '-'],
  ];
  readout.innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
  drawSpectrum(analyser);
};

const bins = new Float32Array(4096);
const drawSpectrum = (a: AnalyserNode) => {
  const g = canvas.getContext('2d');
  if (!g) return;
  a.getFloatFrequencyData(bins);
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, w, h);
  const sr = a.context.sampleRate;
  const lo = 40;
  const hi = 10000;
  g.beginPath();
  for (let x = 0; x < w; x++) {
    const f = lo * (hi / lo) ** (x / w);
    const bin = Math.round((f / sr) * a.fftSize);
    const db = bins[bin] ?? -140;
    const y = h - ((db + 110) / 90) * h;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = '#ffcf5a';
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.font = '11px system-ui';
  for (const f of [100, 250, 500, 1000, 2000, 5000]) {
    const x = (Math.log(f / lo) / Math.log(hi / lo)) * w;
    g.fillRect(x, 0, 1, h);
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, 12);
  }
};
