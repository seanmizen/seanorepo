// Demo page: one station, one train, and a control for each part of the
// sound.
//
// Groups: sound (the top bar), train and stock, scripts, motion, listener,
// mixer, live state and spectrum. The page disables a control that does
// nothing in the current state, and a line under it says why. The settings
// stay in local storage. "Reset to defaults" clears them.

import {
  carOffsets,
  DEFAULT_GEOMETRY,
  type Mix,
  type MixComponent,
  type MotorType,
  STOCKS,
  type StockId,
  type TrainState,
  TubeStation,
  TubeTrain,
} from '../src/index';

// ---- Settings ---------------------------------------------------------------

type Channel = 'ambient' | 'train' | MixComponent;
type Mode = 'manual' | 'physics';
type CurveMode = 'track' | 'fixed';

interface ChannelInfo {
  id: Channel;
  name: string;
  what: string;
  /** True: a part of the train, under the Train fader. */
  part: boolean;
}

const CHANNELS: ChannelInfo[] = [
  {
    id: 'ambient',
    name: 'Ambient',
    what: 'Station background: mains hum, fans, distant trains.',
    part: false,
  },
  {
    id: 'train',
    name: 'Train',
    what: 'The whole train, with its reverb.',
    part: false,
  },
  {
    id: 'motor',
    name: 'Motor',
    what: 'Traction motors, gears and the inverter.',
    part: true,
  },
  {
    id: 'control',
    name: 'Control gear',
    what: 'Camshaft clicks and contactors.',
    part: true,
  },
  {
    id: 'rolling',
    name: 'Rolling',
    what: 'Wheel and rail roar and rumble.',
    part: true,
  },
  {
    id: 'joints',
    name: 'Rail joints',
    what: 'Joint clicks and the wheel flat.',
    part: true,
  },
  {
    id: 'brakes',
    name: 'Brakes and air',
    what: 'Brake hiss, block scrape, groan and the stop lurch.',
    part: true,
  },
  {
    id: 'squeal',
    name: 'Flange squeal',
    what: 'Wheel squeal on curves.',
    part: true,
  },
  {
    id: 'compressor',
    name: 'Compressor',
    what: 'Air compressor. It runs when the main reservoir is low.',
    part: true,
  },
  {
    id: 'doors',
    name: 'Doors',
    what: 'Door engines, the chime and the warning beeps.',
    part: true,
  },
  {
    id: 'tunnel',
    name: 'Tunnel air',
    what: 'Piston wind and rail singing.',
    part: true,
  },
];

const PARTS = CHANNELS.filter((c) => c.part).map((c) => c.id as MixComponent);

interface Settings {
  stock: StockId;
  /** '' = the motor of the stock. */
  motor: MotorType | '';
  mode: Mode;
  /** Speed for the speed slider mode, m/s. */
  speed: number;
  throttle: number;
  brake: number;
  curveMode: CurveMode;
  curve: number;
  /** The listener measures from this point: -1 = the train front, else a car index. */
  ref: number;
  /** Metres from the reference point to the listener. Positive = still to come. */
  distance: number;
  lock: boolean;
  volume: number;
  level: Record<Channel, number>;
  mute: Record<Channel, boolean>;
  repeat: boolean;
}

const DEFAULTS: Settings = {
  stock: '1973',
  motor: '',
  mode: 'manual',
  speed: 0,
  throttle: 0,
  brake: 0,
  curveMode: 'track',
  curve: 0,
  ref: -1,
  distance: 400,
  lock: false,
  volume: 0.8,
  level: Object.fromEntries(CHANNELS.map((c) => [c.id, 1])) as Record<
    Channel,
    number
  >,
  mute: Object.fromEntries(CHANNELS.map((c) => [c.id, false])) as Record<
    Channel,
    boolean
  >,
  repeat: false,
};

const STORE_KEY = 'tube-sounds-demo/settings/v1';
const MOTORS: readonly (MotorType | '')[] = [
  '',
  'dc-camshaft',
  'vvvf-igbt',
  'vvvf-gto',
];

const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, v))
    : d;
const oneOf = <T>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;
const bool = (v: unknown, d: boolean): boolean =>
  typeof v === 'boolean' ? v : d;
const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Read the stored settings. A bad or missing value gets its default. */
const loadSettings = (): Settings => {
  let raw: Record<string, unknown> = {};
  try {
    raw = record(JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}'));
  } catch {
    raw = {};
  }
  const d = DEFAULTS;
  const lv = record(raw.level);
  const mu = record(raw.mute);
  const level = { ...d.level };
  const mute = { ...d.mute };
  for (const c of CHANNELS) {
    level[c.id] = num(lv[c.id], 0, 2, d.level[c.id]);
    mute[c.id] = bool(mu[c.id], d.mute[c.id]);
  }
  return {
    stock: oneOf(raw.stock, ['1973', 'S7'] as const, d.stock),
    motor: oneOf(raw.motor, MOTORS, d.motor),
    mode: oneOf(raw.mode, ['manual', 'physics'] as const, d.mode),
    speed: num(raw.speed, 0, 28, d.speed),
    throttle: num(raw.throttle, 0, 1, d.throttle),
    brake: num(raw.brake, 0, 1, d.brake),
    curveMode: oneOf(raw.curveMode, ['track', 'fixed'] as const, d.curveMode),
    curve: num(raw.curve, 0, 1, d.curve),
    ref: Math.round(num(raw.ref, -1, 6, d.ref)),
    distance: num(raw.distance, -200, 800, d.distance),
    lock: bool(raw.lock, d.lock),
    volume: num(raw.volume, 0, 1.5, d.volume),
    level,
    mute,
    repeat: bool(raw.repeat, d.repeat),
  };
};

let settings = loadSettings();

const save = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    // Private windows can block storage. The page works without it.
  }
};

// ---- Elements ---------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`demo: element #${id} is missing.`);
  return el as T;
};
const input = (id: string) => $<HTMLInputElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);

const ui = {
  sound: button('sound'),
  soundState: $('soundState'),
  soundHint: $('soundHint'),
  volume: input('volume'),
  volumeOut: $('volumeOut'),
  chips: $('chips'),
  reset: button('reset'),
  stock: select('stock'),
  motor: select('motor'),
  motorDefault: $<HTMLOptionElement>('motorDefault'),
  modeManual: input('modeManual'),
  modePhysics: input('modePhysics'),
  modeWhy: $('modeWhy'),
  speed: input('speed'),
  throttle: input('throttle'),
  brake: input('brake'),
  curveMode: select('curveMode'),
  curve: input('curve'),
  ref: select('ref'),
  distance: input('distance'),
  lock: input('lock'),
  lockHint: $('lockHint'),
  placeHint: $('placeHint'),
  arrival: button('arrival'),
  departure: button('departure'),
  service: button('service'),
  stopScript: button('stopScript'),
  repeat: input('repeat'),
  scriptHint: $('scriptHint'),
  scriptWhy: $('scriptWhy'),
  doors: button('doors'),
  doorsWhy: $('doorsWhy'),
  mixer: $('mixer'),
  readout: $('readout'),
  canvas: $<HTMLCanvasElement>('spectrum'),
};

/** Write the value text of a slider row. */
const setOut = (el: HTMLInputElement, text: string) => {
  const out = el.closest('.row')?.querySelector('output');
  if (out) setText(out, text);
};

const setText = (el: Element, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};

/**
 * Enable or disable a control row. A disabled row shows the reason. An
 * empty reason disables the row without a line of its own.
 */
const setRow = (el: HTMLInputElement, reason: string | null) => {
  el.disabled = reason !== null;
  const row = el.closest('.row');
  row?.classList.toggle('off', reason !== null);
  const why = row?.querySelector('.why');
  if (why) setText(why, reason ?? '');
};

/** The slider that the pointer holds. The live view does not move it. */
let held: Element | null = null;
document.addEventListener('pointerdown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range')
    held = e.target;
});
for (const ev of ['pointerup', 'pointercancel'])
  window.addEventListener(ev, () => {
    held = null;
  });
const show = (el: HTMLInputElement, v: number) => {
  if (el !== held) el.value = String(v);
};

// ---- Formatting -------------------------------------------------------------

const fmt = (v: number, d = 1) => v.toFixed(d);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number, d = 0) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const metres = (v: number) => `${signed(Math.round(v))} m`;

// ---- Audio ------------------------------------------------------------------

let ctx: AudioContext | null = null;
let station: TubeStation | null = null;
let train: TubeTrain | null = null;
let analyser: AnalyserNode | null = null;
let nextService = 0;
let scriptName = '';
let wasScripted = false;

const stockSpec = () => STOCKS[settings.stock];
const motorType = (): MotorType => settings.motor || stockSpec().motor;
const eff = (c: Channel) => (settings.mute[c] ? 0 : settings.level[c]);
const partLevels = (): Partial<Mix> =>
  Object.fromEntries(PARTS.map((c) => [c, eff(c)]));

/** Metres from the train front to the reference point (a car centre). */
const refOffset = (k = settings.ref): number => {
  if (k < 0) return 0;
  const spec = stockSpec();
  return (carOffsets(spec)[k] ?? 0) + (spec.cars[k]?.length ?? 0) / 2;
};
const refName = (k = settings.ref) =>
  k < 0 ? 'the train front' : `car ${k + 1}`;
/** Distance from the reference point to the listener, from the train state. */
const refDistance = (s: TrainState) => s.distance + refOffset();

const applyMotion = () => {
  if (!train) return;
  train.setPhysics(settings.mode === 'physics');
  if (settings.mode === 'manual') train.setSpeed(settings.speed);
  train.setThrottle(settings.throttle);
  train.setBrake(settings.brake);
  train.setCurve(settings.curveMode === 'track' ? null : settings.curve);
};

const applyLock = () => {
  if (!train) return;
  train.setDistanceLock(
    settings.lock
      ? {
          distance: settings.distance,
          car: settings.ref < 0 ? undefined : settings.ref,
        }
      : null,
  );
};

/** Put the reference point at the slider distance. Only without a lock. */
const placeTrain = () => {
  train?.setDistance(settings.distance - refOffset());
};

const applyMix = () => {
  station?.setAmbient(eff('ambient'));
  train?.setLevel(eff('train'));
  train?.setMix(partLevels());
};

/** Build the train. keepPlace: start at the position and speed of the old one. */
const buildTrain = (keepPlace: boolean) => {
  if (!station) return;
  const prev = keepPlace && train ? train.state : null;
  train?.dispose();
  scriptName = '';
  train = new TubeTrain(station, {
    stock: settings.stock,
    motor: motorType(),
    physics: settings.mode === 'physics',
    level: eff('train'),
    mix: partLevels(),
  });
  if (prev) {
    train.setPosition(prev.frontX);
    train.setSpeed(prev.speed);
  } else {
    placeTrain();
  }
  applyLock();
  applyMotion();
};

const renderSound = () => {
  const on = ctx?.state === 'running';
  ui.sound.setAttribute('aria-pressed', String(on));
  ui.soundState.textContent = on ? 'on' : ctx ? 'paused' : 'off';
  ui.soundHint.textContent = !ctx
    ? 'The sound is off. Press Sound to start it. A browser starts audio only after a click. A script button also starts the sound.'
    : on
      ? 'The sound is on. Press Sound to pause it. The train and any script pause with the sound.'
      : 'The sound is paused. The train and any script wait. Press Sound to continue.';
};

const startSound = async (): Promise<void> => {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' });
    station = new TubeStation(ctx, {
      volume: settings.volume,
      ambient: eff('ambient'),
    });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.6;
    station.output.connect(ctx.destination);
    station.output.connect(analyser);
    station.start();
    buildTrain(false);
    ctx.addEventListener('statechange', renderSound);
  } else if (ctx.state !== 'running') {
    await ctx.resume();
  }
  renderSound();
};

const pauseSound = async (): Promise<void> => {
  if (ctx?.state === 'running') await ctx.suspend();
  renderSound();
};

// ---- Controls ---------------------------------------------------------------

const renderRefOptions = () => {
  const spec = stockSpec();
  if (settings.ref >= spec.cars.length) settings.ref = spec.cars.length - 1;
  const opts = [new Option('Train front', '-1')];
  spec.cars.forEach((c, i) => {
    const kind = c.motored ? 'motor car' : 'trailer';
    const extra = c.compressor ? ', compressor' : '';
    opts.push(new Option(`Car ${i + 1} centre (${kind}${extra})`, String(i)));
  });
  ui.ref.replaceChildren(...opts);
  ui.ref.value = String(settings.ref);
};

const MOTOR_NAMES: Record<MotorType, string> = {
  'dc-camshaft': 'DC camshaft',
  'vvvf-igbt': 'IGBT VVVF',
  'vvvf-gto': 'GTO VVVF',
};

/** Write the settings into the controls. */
const syncControls = () => {
  ui.stock.value = settings.stock;
  ui.motorDefault.textContent = `Stock default (${MOTOR_NAMES[stockSpec().motor]})`;
  ui.motor.value = settings.motor;
  ui.modeManual.checked = settings.mode === 'manual';
  ui.modePhysics.checked = settings.mode === 'physics';
  ui.speed.value = String(settings.speed);
  ui.throttle.value = String(settings.throttle);
  ui.brake.value = String(settings.brake);
  ui.curveMode.value = settings.curveMode;
  ui.curve.value = String(settings.curve);
  renderRefOptions();
  ui.distance.value = String(settings.distance);
  ui.lock.checked = settings.lock;
  ui.volume.value = String(settings.volume);
  ui.volumeOut.textContent = pct(settings.volume);
  ui.repeat.checked = settings.repeat;
  renderMixer();
};

ui.sound.addEventListener('click', () => {
  void (ctx?.state === 'running' ? pauseSound() : startSound());
});

ui.volume.addEventListener('input', () => {
  settings.volume = Number(ui.volume.value);
  ui.volumeOut.textContent = pct(settings.volume);
  save();
  station?.setVolume(settings.volume);
});

ui.reset.addEventListener('click', () => {
  settings = structuredClone(DEFAULTS);
  save();
  syncControls();
  station?.setVolume(settings.volume);
  station?.setAmbient(eff('ambient'));
  // A new train at the default place, with the default mix.
  buildTrain(false);
});

ui.stock.addEventListener('change', () => {
  // Keep the reference point (the front or the car) at its distance.
  // A lock keeps settings.distance. Without a lock, use the live distance.
  const live = train && !settings.lock ? refDistance(train.state) : null;
  if (live !== null)
    settings.distance = Math.round(Math.min(800, Math.max(-200, live)));
  settings.stock = ui.stock.value as StockId;
  save();
  syncControls();
  buildTrain(true);
  if (live !== null) train?.setDistance(live - refOffset());
});

ui.motor.addEventListener('change', () => {
  settings.motor = ui.motor.value as MotorType | '';
  save();
  train?.setMotorType(motorType());
  renderMixer();
});

for (const radio of [ui.modeManual, ui.modePhysics]) {
  radio.addEventListener('change', () => {
    const mode: Mode = ui.modePhysics.checked ? 'physics' : 'manual';
    // Back to the slider: continue at the live speed, without a jump.
    if (mode === 'manual' && train)
      settings.speed = Math.min(28, Math.round(train.state.speed * 10) / 10);
    settings.mode = mode;
    ui.speed.value = String(settings.speed);
    save();
    applyMotion();
  });
}

const motionSliders: [
  HTMLInputElement,
  'speed' | 'throttle' | 'brake' | 'curve',
][] = [
  [ui.speed, 'speed'],
  [ui.throttle, 'throttle'],
  [ui.brake, 'brake'],
  [ui.curve, 'curve'],
];
for (const [el, key] of motionSliders) {
  el.addEventListener('input', () => {
    settings[key] = Number(el.value);
    save();
    applyMotion();
  });
}

ui.curveMode.addEventListener('change', () => {
  settings.curveMode = ui.curveMode.value as CurveMode;
  save();
  applyMotion();
});

ui.ref.addEventListener('change', () => {
  // Keep the train where the listener hears it. Only the number changes.
  const front = train ? train.state.distance : settings.distance - refOffset();
  settings.ref = Number(ui.ref.value);
  settings.distance = Math.round(front + refOffset());
  ui.distance.value = String(settings.distance);
  save();
  applyLock();
});

ui.distance.addEventListener('input', () => {
  settings.distance = Number(ui.distance.value);
  save();
  if (settings.lock) applyLock();
  else placeTrain();
});

ui.lock.addEventListener('change', () => {
  // Lock at the distance where the train is now.
  if (ui.lock.checked && train)
    settings.distance = Math.round(
      Math.min(800, Math.max(-200, refDistance(train.state))),
    );
  settings.lock = ui.lock.checked;
  ui.distance.value = String(settings.distance);
  save();
  applyLock();
});

const playScript =
  (name: string, play: (t: TubeTrain, s: TubeStation) => void) => async () => {
    await startSound();
    if (!train || !station) return;
    scriptName = name;
    play(train, station);
  };

ui.arrival.addEventListener(
  'click',
  playScript('Arrival', (t) => void t.playArrival()),
);
ui.departure.addEventListener(
  'click',
  playScript('Departure', (t) => void t.playDeparture()),
);
ui.service.addEventListener(
  'click',
  playScript('Full service', (t, s) => {
    nextService = s.now + 12;
    void t.playService({ at: nextService });
  }),
);
ui.stopScript.addEventListener('click', () => {
  train?.stopScript();
  // Repeat would start the next service at once.
  settings.repeat = false;
  ui.repeat.checked = false;
  save();
});
ui.repeat.addEventListener('change', () => {
  settings.repeat = ui.repeat.checked;
  save();
  if (settings.repeat) void startSound();
});
ui.doors.addEventListener('click', async () => {
  await startSound();
  if (!train) return;
  if (train.state.doorsOpen) train.doorsClose();
  else train.doorsOpen();
});

// ---- Mixer ------------------------------------------------------------------

const mixRows = new Map<
  Channel,
  {
    row: HTMLElement;
    slider: HTMLInputElement;
    out: HTMLElement;
    mute: HTMLButtonElement;
    what: HTMLElement;
  }
>();

for (const c of CHANNELS) {
  if (c.id === 'motor') {
    const h = document.createElement('h3');
    h.textContent = 'Train parts (under the Train fader)';
    ui.mixer.append(h);
  }
  const row = document.createElement('div');
  row.className = c.part ? 'ch part' : 'ch';
  const id = `mix-${c.id}`;
  const label = document.createElement('label');
  label.className = 'name';
  label.htmlFor = id;
  label.textContent = c.name;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = id;
  slider.min = '0';
  slider.max = '2';
  slider.step = '0.01';
  const out = document.createElement('output');
  out.htmlFor.add(id);
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'mute';
  mute.textContent = 'Mute';
  mute.setAttribute('aria-label', `Mute ${c.name}`);
  const what = document.createElement('span');
  what.className = 'what';
  row.append(label, slider, out, mute, what);
  ui.mixer.append(row);
  mixRows.set(c.id, { row, slider, out, mute, what });

  slider.addEventListener('input', () => {
    settings.level[c.id] = Number(slider.value);
    save();
    applyMix();
    renderMixer();
  });
  mute.addEventListener('click', () => {
    settings.mute[c.id] = !settings.mute[c.id];
    save();
    applyMix();
    renderMixer();
  });
}

/** Why a mixer channel does nothing now, or null. */
const mixReason = (c: ChannelInfo): string | null => {
  if (c.part && eff('train') === 0)
    return 'Off: the Train fader is at 0% or muted.';
  if (c.id === 'control' && motorType() !== 'dc-camshaft')
    return 'Only the DC camshaft motor has control gear clicks.';
  return null;
};

function renderMixer() {
  for (const c of CHANNELS) {
    const r = mixRows.get(c.id);
    if (!r) continue;
    const reason = mixReason(c);
    const muted = settings.mute[c.id];
    show(r.slider, settings.level[c.id]);
    r.out.textContent = muted ? 'muted' : pct(settings.level[c.id]);
    r.mute.setAttribute('aria-pressed', String(muted));
    r.slider.disabled = reason !== null;
    r.mute.disabled = reason !== null;
    r.row.classList.toggle('off', reason !== null || muted);
    r.what.textContent = reason ? `${c.what} ${reason}` : c.what;
  }
}

// ---- Live view --------------------------------------------------------------

const g = DEFAULT_GEOMETRY;
const platformNear = g.listener.x - g.platformStart;
const platformFar = g.listener.x - (g.platformStart + g.platformLength);
ui.placeHint.textContent =
  `The listener stands on the platform, ${fmt(g.listener.lateral)} m from the track. ` +
  `0 m = level with the listener. Positive = still to come, negative = past. ` +
  `The platform runs from ${metres(platformNear)} to ${metres(platformFar)}. The tunnel is beyond.`;

const renderLive = (s: TrainState | null) => {
  const scripted = s?.scripted ?? false;
  const physics = settings.mode === 'physics';
  const moving = (s?.speed ?? 0) > 0.3;
  const scriptReason =
    'A script drives the train. Press Stop script to take over.';

  // Motion.
  ui.modeManual.disabled = scripted;
  ui.modePhysics.disabled = scripted;
  setText(
    ui.modeWhy,
    scripted
      ? scriptReason
      : physics
        ? 'Throttle and brake drive the speed through the train dynamics.'
        : 'The slider sets the speed. Throttle and brake still set the motor load and the brake air.',
  );
  // During a script the mode row gives the reason once ('' = no own line).
  setRow(
    ui.speed,
    scripted
      ? ''
      : physics
        ? 'Physics sets the speed. Use throttle and brake.'
        : null,
  );
  setRow(ui.throttle, scripted ? '' : null);
  setRow(ui.brake, scripted ? '' : null);
  setRow(
    ui.curve,
    settings.curveMode === 'track' ? 'The track layout sets the curve.' : null,
  );
  if (s && (scripted || physics)) show(ui.speed, s.speed);
  if (s && scripted) {
    show(ui.throttle, s.throttle);
    show(ui.brake, s.brake);
  }
  const speedNow = s && (scripted || physics) ? s.speed : settings.speed;
  setOut(ui.speed, `${fmt(speedNow)} m/s`);
  setOut(ui.throttle, pct(Number(ui.throttle.value)));
  setOut(ui.brake, pct(Number(ui.brake.value)));
  setOut(ui.curve, pct(settings.curve));

  // Listener.
  const live = s ? refDistance(s) : settings.distance;
  if (settings.lock) {
    setRow(ui.distance, null);
  } else {
    setRow(
      ui.distance,
      scripted
        ? 'A script moves the train. Lock the distance to hold it.'
        : null,
    );
    if (s) show(ui.distance, Math.round(live));
  }
  setOut(ui.distance, metres(settings.lock ? settings.distance : live));
  setText(
    ui.lockHint,
    settings.lock
      ? `On: the listener rides with the train, ${metres(settings.distance)} from ${refName()}, in every mode. ` +
          'Speed changes the sound, distance does not. There is no Doppler shift, because the path length stays the same. ' +
          'A move of the slider glides the pitch for a moment, as a real move does.'
      : 'Off: the train runs past the listener, and the slider follows it. Drag the slider to move the train.',
  );

  // Scripts.
  ui.stopScript.disabled = !scripted;
  ui.departure.disabled = moving && !scripted;
  setText(
    ui.scriptWhy,
    ui.departure.disabled
      ? 'Departure: the train must stand still. A departure starts from a stand.'
      : '',
  );
  setText(
    ui.scriptHint,
    scripted
      ? `Running: ${scriptName || 'a script'}. The motion controls follow it.${settings.repeat ? ' Repeat is on.' : ''}`
      : `No script. You drive the train with the Motion controls.${settings.repeat ? ' Repeat is on: the next service starts soon.' : ''}`,
  );
  setText(
    ui.doors,
    s?.doorsOpen ? 'Close the doors (with warning)' : 'Open the doors',
  );
  const doorsReason = scripted
    ? 'The script works the doors.'
    : moving
      ? 'The train must stand still.'
      : null;
  ui.doors.disabled = doorsReason !== null;
  setText(ui.doorsWhy, doorsReason ?? '');

  // Status chips in the top bar.
  const dash = '–';
  const chips: [string, string][] = [
    ['Speed', s ? `${fmt(s.speed)} m/s (${fmt(s.speed * 3.6, 0)} km/h)` : dash],
    [
      'Distance',
      s ? `${metres(live)} (${settings.ref < 0 ? 'front' : refName()})` : dash,
    ],
    ['Script', scripted ? scriptName || 'running' : 'none'],
    ['Lock', settings.lock ? `on, ${metres(settings.distance)}` : 'off'],
    ['Doors', s ? (s.doorsOpen ? 'open' : 'closed') : dash],
  ];
  const chipHtml = chips.map(([k, v]) => `<li><b>${k}</b>${v}</li>`).join('');
  if (ui.chips.innerHTML !== chipHtml) ui.chips.innerHTML = chipHtml;

  // Detailed state.
  const rows: [string, string][] = s
    ? [
        ['speed', `${fmt(s.speed)} m/s (${fmt(s.speed * 3.6, 0)} km/h)`],
        ['acceleration', `${signed(s.accel, 2)} m/s²`],
        [`distance, ${refName()}`, metres(live)],
        ['track position', `${fmt(s.frontX, 0)} m (train front)`],
        ['throttle, brake', `${pct(s.throttle)}, ${pct(s.brake)}`],
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
        ['brake cylinder', pct(s.cylinder)],
        [
          'main reservoir',
          `${pct(s.reservoir)}${s.compressorOn ? ' (compressor on)' : ''}`,
        ],
        ['doors', s.doorsOpen ? 'open' : 'closed'],
        [
          'lock',
          s.locked
            ? `on, ${metres(settings.distance)} from ${refName()}`
            : 'off',
        ],
      ]
    : [['train', 'The train starts with the sound.']];
  const html = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  if (ui.readout.innerHTML !== html) ui.readout.innerHTML = html;
};

const frame = () => {
  requestAnimationFrame(frame);
  const s = train?.state ?? null;
  if (s && train && station) {
    // Repeat the service on the 70 s timeline of the game.
    if (settings.repeat && !s.scripted && station.now > nextService) {
      nextService = Math.max(nextService + 70, station.now + 12);
      scriptName = 'Full service (repeat)';
      void train.playService({ at: nextService });
    }
    // At the end of a script, the controls take over from where it stopped.
    if (wasScripted && !s.scripted) {
      settings.speed = Math.min(28, Math.round(s.speed * 10) / 10);
      settings.throttle = s.throttle;
      settings.brake = s.brake;
      ui.speed.value = String(settings.speed);
      ui.throttle.value = String(settings.throttle);
      ui.brake.value = String(settings.brake);
      save();
      scriptName = '';
    }
    wasScripted = s.scripted;
  }
  renderLive(train?.state ?? null);
  if (analyser && ctx?.state === 'running') drawSpectrum(analyser);
  else drawIdle();
};

// ---- Spectrum ---------------------------------------------------------------

const bins = new Float32Array(4096);
let idle = false;

/** Match the canvas pixels to its size on the page, so text is not stretched. */
const fitCanvas = (): boolean => {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(ui.canvas.clientWidth * dpr);
  const h = Math.round(ui.canvas.clientHeight * dpr);
  if (w === 0 || (ui.canvas.width === w && ui.canvas.height === h))
    return false;
  ui.canvas.width = w;
  ui.canvas.height = h;
  return true;
};

const drawIdle = () => {
  if (fitCanvas()) idle = false;
  if (idle) return;
  idle = true;
  const dpr = window.devicePixelRatio || 1;
  const c = ui.canvas.getContext('2d');
  if (!c) return;
  c.fillStyle = '#000';
  c.fillRect(0, 0, ui.canvas.width, ui.canvas.height);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.font = `${14 * dpr}px system-ui`;
  c.fillText('The spectrum shows while the sound is on.', 16 * dpr, 30 * dpr);
};

const drawSpectrum = (a: AnalyserNode) => {
  idle = false;
  fitCanvas();
  const dpr = window.devicePixelRatio || 1;
  const c = ui.canvas.getContext('2d');
  if (!c) return;
  a.getFloatFrequencyData(bins);
  const w = ui.canvas.width;
  const h = ui.canvas.height;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(0, 0, w, h);
  const sr = a.context.sampleRate;
  const lo = 40;
  const hi = 10000;
  c.beginPath();
  for (let x = 0; x < w; x++) {
    const f = lo * (hi / lo) ** (x / w);
    const bin = Math.round((f / sr) * a.fftSize);
    const db = bins[bin] ?? -140;
    const y = h - ((db + 110) / 90) * h;
    if (x === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.strokeStyle = '#ffcf5a';
  c.lineWidth = 1.5 * dpr;
  c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.font = `${11 * dpr}px system-ui`;
  for (const f of [100, 250, 500, 1000, 2000, 5000]) {
    const x = (Math.log(f / lo) / Math.log(hi / lo)) * w;
    c.fillRect(x, 0, dpr, h);
    c.fillText(
      f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`,
      x + 3 * dpr,
      12 * dpr,
    );
  }
};

syncControls();
renderSound();
requestAnimationFrame(frame);
