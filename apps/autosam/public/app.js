// Where: apps/autosam/public/app.js. index.html loads it as a module.
// Why: the page. "/" shows the library. "/<slug>" plays one song: a small
// Web Audio piano plays the chords in the chosen key, and the chord chart
// follows the music. The song file and the edit key go to the server
// (server/app.ts) through /api.

import { LIMITS, parseSong } from '/song-format.js';

const $ = (id) => document.getElementById(id);
const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// Major keys that are written with flats. A minor key uses its relative major.
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1, 6]);
const DEG = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'];
const SUP = {
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
};
const PIANO_LOW = 21; // A0
const PIANO_HIGH = 108; // C8
const mod = (n) => ((n % 12) + 12) % 12;
const minus = (n) => (n < 0 ? `−${-n}` : `+${n}`);

// ---------- Device storage ----------
const local = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is off (a private window). Settings last for this visit.
    }
  },
};
const EDIT_KEY = 'autosam:edit-key';
const getEditKey = () => local.get(EDIT_KEY, '');
const setEditKey = (k) => local.set(EDIT_KEY, k);

// ---------- API ----------
async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && getEditKey()) headers.authorization = `Bearer ${getEditKey()}`;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: 'The server did not answer. Check your connection.' },
    };
  }
  let data = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function errorText(r) {
  const base = r.data?.error || `The server answered ${r.status}.`;
  const details = Array.isArray(r.data?.details)
    ? r.data.details.slice(0, 6).join('\n')
    : '';
  return details ? `${base}\n${details}` : base;
}

function say(el, text, kind = '') {
  el.textContent = text;
  el.className = `msg${kind ? ` ${kind}` : ''}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The nodes with a space between each two. A flex or grid layout drops the
// spaces. With no page styles (the bare theme) they keep words apart.
const spaced = (nodes) => nodes.flatMap((n, i) => (i ? [' ', n] : [n]));

// ---------- Edit key panel ----------
function setupKeyPanel(slot) {
  slot.appendChild($('keyPanel'));
  const input = $('editKey');
  const msg = $('keyMsg');
  input.value = getEditKey();
  input.addEventListener('change', () => {
    setEditKey(input.value.trim());
    say(msg, '');
  });
  $('checkKey').addEventListener('click', async () => {
    setEditKey(input.value.trim());
    if (!getEditKey()) {
      say(msg, 'Type the edit key first.', 'err');
      return;
    }
    const r = await api('/api/auth/check', { method: 'POST', auth: true });
    if (r.ok) say(msg, 'The key works. You can save changes.', 'good');
    else say(msg, errorText(r), 'err');
  });
  $('forgetKey').addEventListener('click', () => {
    input.value = '';
    setEditKey('');
    say(msg, 'This device no longer keeps the key.');
  });
}

// =====================================================================
// The library ("/")
// =====================================================================
const NEW_SONG = `title: New song
artist:
key: C
tempo: 90
suggest: -2

[Verse]
C | G | Am | F
C | G | F | C
`;

async function showLibrary() {
  $('libraryView').hidden = false;
  document.title = 'autosam';
  setupKeyPanel($('libKeySlot'));

  const text = $('newText');
  const slugNote = $('newSlug');
  text.value = NEW_SONG;
  const preview = () => {
    const s = parseSong(text.value);
    slugNote.textContent = s.errors.length ? '' : `It will be at /${s.slug}.`;
  };
  text.addEventListener('input', preview);
  preview();
  $('createSong').addEventListener('click', async () => {
    const msg = $('newMsg');
    const parsed = parseSong(text.value);
    if (parsed.errors.length) {
      say(msg, parsed.errors.slice(0, 6).join('\n'), 'err');
      return;
    }
    if (!getEditKey()) {
      say(msg, 'Type the edit key under "Editing" to add a song.', 'err');
      return;
    }
    $('createSong').disabled = true;
    const r = await api('/api/songs', {
      method: 'POST',
      auth: true,
      body: { text: text.value },
    });
    $('createSong').disabled = false;
    if (r.ok) location.href = `/${r.data.slug}`;
    else say(msg, errorText(r), 'err');
  });

  await loadLibrary();
}

async function loadLibrary() {
  const list = $('songList');
  const r = await api('/api/songs');
  list.textContent = '';
  if (!r.ok) {
    list.append(el('p', 'empty', errorText(r)));
    return;
  }
  const { songs, archived } = r.data;
  if (!songs.length)
    list.append(el('p', 'empty', 'No songs yet. Add one below.'));
  for (const s of songs) {
    const row = el('a', 'song-row');
    row.href = `/${s.slug}`;
    const facts = [s.artist, `key of ${s.key}`, `${s.tempo} BPM`].filter(
      Boolean,
    );
    row.append(
      ...spaced([
        el('span', 'song-title', s.title),
        el('span', 'song-meta', facts.join(' · ')),
      ]),
    );
    list.append(row);
  }

  $('archCount').textContent = String(archived.length);
  const arch = $('archList');
  arch.textContent = '';
  if (!archived.length) arch.append(el('p', 'empty', 'Nothing is archived.'));
  for (const s of archived) {
    const row = el('div', 'arch-row');
    const when = new Date(s.archivedAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const btn = el('button', 'btn', 'Restore');
    btn.type = 'button';
    const msg = el('span', 'msg');
    btn.addEventListener('click', async () => {
      if (!getEditKey()) {
        say(msg, 'Type the edit key under "Editing" to restore a song.', 'err');
        return;
      }
      btn.disabled = true;
      const res = await api(
        `/api/archive/${encodeURIComponent(s.id)}/restore`,
        {
          method: 'POST',
          auth: true,
        },
      );
      if (res.ok) await loadLibrary();
      else {
        btn.disabled = false;
        say(msg, errorText(res), 'err');
      }
    });
    row.append(
      ...spaced([
        el('span', 't', s.title),
        el(
          'span',
          'm',
          `${s.artist ? `${s.artist} · ` : ''}/${s.slug} · archived ${when}`,
        ),
        btn,
        msg,
      ]),
    );
    arch.append(row);
  }
}

// =====================================================================
// One song ("/<slug>")
// =====================================================================
let song = null; // parseSong() result
let current = null; // {slug, version, savedText}
let keyRoot = 0;
let keyMinor = false;

const prefs = Object.assign(
  { style: 'pulse', count: true, click: false, loop: false, vol: 0.8 },
  local.get('autosam:prefs', {}),
);
if (!['pulse', 'held'].includes(prefs.style)) prefs.style = 'pulse';
const settings = { ...prefs, shift: 0, bpm: 90 };

const clampShift = (n) =>
  Math.max(
    -LIMITS.maxShift,
    Math.min(LIMITS.maxShift, Math.round(Number(n) || 0)),
  );
const clampBpm = (n) =>
  Math.max(
    LIMITS.minTempo,
    Math.min(LIMITS.maxTempo, Math.round(Number(n) || 90)),
  );

function save() {
  const { style, count, click, loop, vol } = settings;
  local.set('autosam:prefs', { style, count, click, loop, vol });
  if (current)
    local.set(`autosam:song:${current.slug}`, {
      shift: settings.shift,
      bpm: settings.bpm,
    });
}

// ---------- Naming ----------
const majorPcAt = (shift) => mod(keyRoot + (keyMinor ? 3 : 0) + shift);
const spellingAt = (shift) =>
  FLAT_MAJOR_KEYS.has(majorPcAt(shift)) ? FLAT : SHARP;
const spelling = () => spellingAt(settings.shift);
const keyShortAt = (shift) =>
  spellingAt(shift)[mod(keyRoot + shift)] + (keyMinor ? 'm' : '');
const keyNameAt = (shift) =>
  `${spellingAt(shift)[mod(keyRoot + shift)]} ${keyMinor ? 'minor' : 'major'}`;
// The tonic of the original key sits in octave 4 (A4, C4). "A♭(4)".
const octaveAt = (shift) => Math.floor((60 + keyRoot + shift) / 12) - 1;
const semitones = (n) =>
  `${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'}`;

function chordName(ch) {
  if (!ch) return '—';
  const sp = spelling();
  let s = sp[mod(ch.root + settings.shift)] + ch.q;
  if (ch.bass !== null) s += `/${sp[mod(ch.bass + settings.shift)]}`;
  return s;
}
function chordNum(ch) {
  if (!ch) return '';
  // "4⁶" rather than "46" when the quality starts with a digit
  let s =
    DEG[mod(ch.root - keyRoot)] +
    ch.q.replace(/^\d+/, (d) => [...d].map((c) => SUP[c]).join(''));
  if (ch.bass !== null) s += `/${DEG[mod(ch.bass - keyRoot)]}`;
  return s;
}

function chordAt(bar, e) {
  const b = song.bars[bar];
  for (let i = b.changes.length - 1; i >= 0; i--)
    if (b.changes[i].pos <= e) return b.changes[i].chord;
  return b.startChord;
}

// ---------- Voicing ----------
// A shift of up to 6 semitones keeps the hands where they are. Past that,
// the hands move by whole octaves, so -13 plays an octave below -1.
const registerOffset = (shift) => shift - (mod(shift + 6) - 6);

function voiceRH(ch, prev) {
  const off = registerOffset(settings.shift);
  const root = ch.root + settings.shift;
  const pcs = [...new Set(ch.iv.map((i) => mod(root + i)))];
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let r = 0; r < pcs.length; r++) {
    const rot = pcs.slice(r).concat(pcs.slice(0, r));
    for (let low = 53 + off; low <= 66 + off; low++) {
      if (mod(low) !== rot[0]) continue;
      const notes = [low];
      for (let i = 1; i < rot.length; i++) {
        let n = notes[i - 1] + 1;
        while (mod(n) !== rot[i]) n++;
        notes.push(n);
      }
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let score = Math.abs(mean - (65 + off)) * 0.6;
      if (notes[notes.length - 1] > 77 + off) score += 4;
      if (prev) {
        score += notes.reduce(
          (a, n) => a + Math.min(...prev.map((p) => Math.abs(p - n))),
          0,
        );
        score +=
          prev.reduce(
            (a, p) => a + Math.min(...notes.map((n) => Math.abs(p - n))),
            0,
          ) * 0.5;
      }
      if (score < bestScore) {
        bestScore = score;
        best = notes;
      }
    }
  }
  return best;
}
function bassNote(ch) {
  const pc = mod((ch.bass !== null ? ch.bass : ch.root) + settings.shift);
  let m = 40 + registerOffset(settings.shift);
  while (mod(m) !== pc) m++;
  return m; // an octave below is doubled in
}
let voiced = { key: null, rh: null, lh: null };
function getVoicing(ch) {
  const key = `${ch.sym}|${settings.shift}`;
  if (voiced.key !== key)
    voiced = { key, rh: voiceRH(ch, voiced.rh), lh: bassNote(ch) };
  return voiced;
}

// ---------- Audio ----------
let ctx = null;
let comp;
let master;
let dry;
let conv;
let wet;
let wave;
let noiseBuf;
let bus;
let clickBus;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master = ctx.createGain();
  master.gain.value = settings.vol;
  dry = ctx.createGain();
  dry.gain.value = 0.85;
  wet = ctx.createGain();
  wet.gain.value = 0.28;
  conv = ctx.createConvolver();
  conv.buffer = makeIR(2.6);
  dry.connect(comp);
  conv.connect(wet);
  wet.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);

  const amps = [
    0, 1, 0.45, 0.32, 0.17, 0.12, 0.07, 0.05, 0.03, 0.022, 0.014, 0.01, 0.006,
  ];
  wave = ctx.createPeriodicWave(
    new Float32Array(amps.length),
    new Float32Array(amps),
  );

  noiseBuf = ctx.createBuffer(
    1,
    Math.floor(ctx.sampleRate * 0.08),
    ctx.sampleRate,
  );
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  newBuses();
}
function makeIR(sec) {
  const len = Math.floor(ctx.sampleRate * sec);
  const fade = ctx.sampleRate * 0.01;
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++)
      d[i] =
        (Math.random() * 2 - 1) * (1 - i / len) ** 3.4 * Math.min(1, i / fade);
  }
  return b;
}
function newBuses() {
  bus = ctx.createGain();
  bus.connect(dry);
  bus.connect(conv);
  clickBus = ctx.createGain();
  clickBus.connect(comp);
}
function silence() {
  if (!ctx) return;
  const old = [bus, clickBus];
  for (const g of old) g.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
  setTimeout(() => {
    for (const g of old) g.disconnect();
  }, 600);
  newBuses();
}

// A small additive piano: bright attack that darkens, two-stage decay, a touch of hammer noise.
function note(midi, t, dur, vel) {
  if (midi < PIANO_LOW || midi > PIANO_HIGH) return;
  const f = mtof(midi);
  const peak = vel * 0.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.005);
  g.gain.setTargetAtTime(peak * 0.42, t + 0.006, 0.1);
  const sustain = Math.max(0.5, Math.min(3.2, 3.2 - (midi - 40) * 0.05));
  g.gain.setTargetAtTime(0, t + 0.16, sustain * 0.5);
  const off = Math.max(t + dur, t + 0.17);
  g.gain.setTargetAtTime(0, off, 0.09);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.4;
  lp.frequency.setValueAtTime(Math.min(f * (3 + vel * 9), 12000), t);
  lp.frequency.setTargetAtTime(Math.min(f * 2.2 + 300, 7000), t + 0.01, 0.4);
  lp.connect(g);
  g.connect(bus);

  for (const det of [-2, 5]) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(t);
    o.stop(off + 0.6);
  }

  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.max(700, Math.min(f * 3, 6000));
  bp.Q.value = 0.9;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(vel * 0.05, t);
  ng.gain.setTargetAtTime(0, t, 0.012);
  n.connect(bp);
  bp.connect(ng);
  ng.connect(bus);
  n.start(t);
  n.stop(t + 0.08);
}
function click(t, strong) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = strong ? 1760 : 1320;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(strong ? 0.32 : 0.2, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g);
  g.connect(clickBus);
  o.start(t);
  o.stop(t + 0.06);
}
function playChord(v, t, dur, rhVel, lhVel) {
  for (const m of v.rh)
    note(
      m,
      t + Math.random() * 0.006,
      dur,
      rhVel * (0.94 + Math.random() * 0.08),
    );
  if (lhVel) {
    note(v.lh, t, dur, lhVel);
    note(v.lh - 12, t, dur, lhVel * 0.7);
  }
}

// ---------- Transport ----------
let playing = false;
let timer = null;
let pos = null;
let nextTime = 0;
let countLeft = 0;
let pendingJump = null;
let cursorBar = 0;
let shownBar = 0;
let shownE = 0;
const queue = [];

function nextPos(p) {
  if (p.e < 7) return { bar: p.bar, e: p.e + 1 };
  let nb = p.bar + 1;
  if (settings.loop) {
    const s = song.sections[song.bars[p.bar].sec];
    if (nb > s.end) nb = s.start;
  }
  return nb < song.bars.length ? { bar: nb, e: 0 } : null;
}
const spanFrom = (bar, e) => {
  const n = bar.changes.find((c) => c.pos > e);
  return (n ? n.pos : 8) - e;
};

function playStep(p, t, ed) {
  const bar = song.bars[p.bar];
  const ch = chordAt(p.bar, p.e);
  const strikes = p.e === 0 || bar.changes.some((c) => c.pos === p.e);
  if (settings.click && p.e % 2 === 0) click(t, p.e === 0);
  if (!ch) return null;
  const v = getVoicing(ch);
  const last = p.bar === song.bars.length - 1 && !settings.loop;
  if (last) {
    if (p.e === 0) playChord(v, t, 3.5, 0.62, 0.7);
  } else if (settings.style === 'pulse') {
    const vel = strikes ? 0.8 : p.e % 2 === 0 ? 0.6 : 0.5;
    for (const m of v.rh)
      note(
        m,
        t + Math.random() * 0.005,
        ed * 0.92,
        vel * (0.94 + Math.random() * 0.08),
      );
    if (strikes) {
      const d = ed * spanFrom(bar, p.e) + 0.04;
      note(v.lh, t, d, 0.72);
      note(v.lh - 12, t, d, 0.5);
    }
  } else if (strikes) {
    playChord(v, t, ed * spanFrom(bar, p.e) + 0.08, 0.62, 0.72);
  }
  return { rh: v.rh.slice(), lh: v.lh };
}

function schedule() {
  if (!playing) return;
  const ahead = ctx.currentTime + (document.hidden ? 1.6 : 0.12);
  while (nextTime < ahead) {
    const ed = 30 / settings.bpm;
    if (countLeft > 0) {
      const k = 8 - countLeft;
      if (k % 2 === 0) click(nextTime, k === 0);
      queue.push({
        t: nextTime,
        kind: 'count',
        beat: k / 2,
        left: countLeft / 2,
      });
      countLeft--;
      nextTime += ed;
      continue;
    }
    if (!pos) {
      queue.push({ t: nextTime + 1.5, kind: 'end' });
      clearInterval(timer);
      timer = null;
      return;
    }
    const v = playStep(pos, nextTime, ed);
    queue.push({ t: nextTime, kind: 'step', bar: pos.bar, e: pos.e, v });
    let np = nextPos(pos);
    if ((np === null || np.e === 0) && pendingJump !== null) {
      np = { bar: pendingJump, e: 0 };
      pendingJump = null;
    }
    pos = np;
    nextTime += ed;
  }
}

let wakeLock = null;
function play() {
  initAudio();
  playing = true;
  following = true;
  pos = { bar: cursorBar, e: 0 };
  countLeft = settings.count ? 8 : 0;
  pendingJump = null;
  voiced = { key: null, rh: null, lh: null };
  nextTime = ctx.currentTime + 0.08;
  queue.length = 0;
  schedule();
  timer = setInterval(schedule, 25);
  try {
    navigator.wakeLock
      ?.request('screen')
      .then((l) => {
        wakeLock = l;
      })
      .catch(() => {});
  } catch {
    // No wake lock here. The screen may sleep.
  }
  updatePlayBtn();
}
function stop(natural) {
  playing = false;
  clearInterval(timer);
  timer = null;
  queue.length = 0;
  pendingJump = null;
  if (!natural) silence();
  cursorBar = natural ? 0 : shownBar;
  try {
    wakeLock?.release();
  } catch {
    // The lock is gone already.
  }
  wakeLock = null;
  updatePlayBtn();
  showAt(cursorBar, 0);
}
const toggle = () => (playing ? stop(false) : play());

function goTo(bar) {
  if (playing) {
    pendingJump = bar;
    following = true;
    updateRefollow();
    markBars(shownE);
    updateNext(shownBar, shownE);
  } else {
    cursorBar = bar;
    showAt(bar, 0);
    audition(bar);
  }
}
function audition(bar) {
  if (!ctx) return;
  initAudio();
  silence();
  const ch = chordAt(bar, 0);
  if (!ch) return;
  voiced = { key: null, rh: null, lh: null };
  playChord(getVoicing(ch), ctx.currentTime + 0.03, 1.4, 0.5, 0.55);
}

// ---------- Display ----------
const els = {};
let barEls = [];
let keyEls = {};
let kbdOffset = null;
const reduceMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches;

function updatePlayBtn() {
  els.playBtn.setAttribute('aria-pressed', String(playing));
  els.playLabel.textContent = playing ? 'Stop' : 'Play';
  els.playIcon.innerHTML = playing
    ? '<rect x="2" y="2" width="10" height="10" rx="1"/>'
    : '<path d="M2 1l11 6-11 6z"/>';
  updateRefollow();
}

function nextChange(p, curSym) {
  let q = p;
  let jump = pendingJump;
  for (let k = 1; k <= 128; k++) {
    let nq = nextPos(q);
    if ((nq === null || nq.e === 0) && jump !== null) {
      nq = { bar: jump, e: 0 };
      jump = null;
    }
    if (!nq) return { end: true, beats: k / 2 };
    const jumped = nq.e === 0 && nq.bar !== q.bar + 1;
    const c = song.bars[nq.bar].changes.find((x) => x.pos === nq.e);
    const ch = c ? c.chord : jumped ? chordAt(nq.bar, 0) : null;
    if (ch && ch.sym !== curSym) return { chord: ch, beats: k / 2 };
    q = nq;
  }
  return null;
}
const beatsText = (b) =>
  b === 0.5
    ? 'on the "and"'
    : `in ${String(b).replace('.5', '½')} beat${b === 1 ? '' : 's'}`;

function updateNext(bar, e) {
  const cur = chordAt(bar, e);
  const n = nextChange({ bar, e }, cur ? cur.sym : null);
  if (!n) {
    els.nextChord.textContent = '—';
    els.nextIn.textContent = '';
  } else if (n.end) {
    els.nextChord.textContent = 'End';
    els.nextIn.textContent = beatsText(n.beats);
  } else {
    els.nextChord.textContent = chordName(n.chord);
    els.nextIn.textContent = `${chordNum(n.chord)} · ${beatsText(n.beats)}`;
  }
}

function showAt(bar, e, v) {
  shownBar = bar;
  shownE = e;
  const b = song.bars[bar];
  const s = song.sections[b.sec];
  els.secName.textContent = s.name;
  els.secBar.textContent = `${bar - s.start + 1} of ${s.end - s.start + 1}`;
  els.songBar.textContent = `${bar + 1} / ${song.bars.length}`;
  const ch = chordAt(bar, e);
  els.nowChord.classList.remove('counting');
  els.nowChord.textContent = chordName(ch);
  els.nowNum.textContent = chordNum(ch);
  updateNext(bar, e);
  els.beats.forEach((d, i) => {
    showBeat(d, playing && i === Math.floor(e / 2));
  });
  let shown = v;
  if (!shown && ch)
    shown = playing
      ? getVoicing(ch)
      : { rh: voiceRH(ch, null), lh: bassNote(ch) };
  showKeys(shown);
  markBars(e);
  if (playing && !following) updateRefollow();
}

// A beat dot is text, so it shows with no page styles (REQ-BARE-001).
// The class gives the look in the other themes.
function showBeat(d, on) {
  d.classList.toggle('on', on);
  d.textContent = on ? '●' : '○';
}

function showCount(ev) {
  els.nowChord.classList.add('counting');
  els.nowChord.textContent = String(ev.beat + 1);
  els.nowNum.textContent = 'count-in';
  const first = chordAt(cursorBar, 0);
  els.nextChord.textContent = chordName(first);
  els.nextIn.textContent =
    (first ? `${chordNum(first)} · ` : '') + beatsText(ev.left);
  els.beats.forEach((d, i) => {
    showBeat(d, i === ev.beat);
  });
}

function showKeys(v) {
  for (const k of Object.values(keyEls)) k.classList.remove('rh', 'lh');
  if (!v) {
    els.rh.textContent = '—';
    els.lh.textContent = '—';
    return;
  }
  for (const m of v.rh) keyEls[m]?.classList.add('rh');
  for (const m of [v.lh, v.lh - 12]) keyEls[m]?.classList.add('lh');
  const sp = spelling();
  els.rh.textContent = v.rh.map((m) => sp[mod(m)]).join(' ');
  els.lh.textContent = `${sp[mod(v.lh)]} (octaves)`;
}

// The bar that plays (or plays first) has aria-current, and its chords sit
// in a <mark>. A queued jump has the text "(next)". So both show with no
// page styles (REQ-BARE-001). The classes give the look in the other
// themes.
function markCurrent(node, on) {
  if (on) node.setAttribute('aria-current', 'true');
  else node.removeAttribute('aria-current');
  const cs = node.querySelector('.cs');
  if ((cs.tagName === 'MARK') === on) return;
  const next = el(on ? 'mark' : 'span', cs.className);
  next.append(...cs.childNodes);
  cs.replaceWith(next);
}

function markPending(node, on) {
  node.classList.toggle('pending', on);
  const flag = node.querySelector('.flag');
  if (on && !flag)
    node.querySelector('.cs').after(el('span', 'flag', ' (next)'));
  if (!on && flag) flag.remove();
}

let lastCur = -1;
function markBars(e) {
  barEls.forEach((node, i) => {
    node.classList.toggle('cur', playing && i === shownBar);
    node.classList.toggle('cursor', !playing && i === cursorBar);
    markCurrent(node, i === (playing ? shownBar : cursorBar));
    markPending(node, playing && i === pendingJump);
  });
  if (playing && barEls[shownBar]) {
    barEls[shownBar].querySelectorAll('.r8 i').forEach((t, i) => {
      t.classList.toggle('lit', i <= (e || 0));
    });
    if (lastCur !== shownBar && lastCur >= 0 && barEls[lastCur]) {
      for (const t of barEls[lastCur].querySelectorAll('.r8 i'))
        t.classList.remove('lit');
    }
    lastCur = shownBar;
  }
  const secIdx = song.bars[shownBar].sec;
  document.querySelectorAll('.sec').forEach((node, i) => {
    node.classList.toggle('looping', settings.loop && i === secIdx);
  });
}

// ---------- Follow scrolling ----------
// Any scroll you make yourself while playing unlocks the view. The "Back to
// bar" button (or F) locks it again.
let following = true;
let quietUntil = 0;
let intentAt = Number.NEGATIVE_INFINITY;
const quiet = (ms) => {
  quietUntil = Math.max(quietUntil, performance.now() + ms);
};

function barPlace(node) {
  const r = node.getBoundingClientRect();
  const narrow = window.innerWidth < 980;
  const top = narrow ? els.now.getBoundingClientRect().bottom : 0;
  return {
    above: r.top < top + 4,
    below: r.bottom > window.innerHeight - 8,
    narrow,
  };
}
function follow(bar, force) {
  const node = barEls[bar];
  if (!node || (!following && !force)) return;
  const p = barPlace(node);
  if (force || p.above || p.below) {
    quiet(reduceMotion ? 200 : 1000);
    node.scrollIntoView({
      block: p.narrow ? 'start' : 'center',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }
}
function updateRefollow() {
  const btn = $('refollow');
  btn.hidden = !(playing && !following);
  if (btn.hidden || !barEls[shownBar]) return;
  $('refollowBar').textContent = String(shownBar + 1);
  $('refollowArrow').textContent = barPlace(barEls[shownBar]).above ? '↑' : '↓';
}
function unfollow() {
  following = false;
  updateRefollow();
}
function relock() {
  following = true;
  updateRefollow();
  follow(shownBar, true);
}
const markIntent = () => {
  intentAt = performance.now();
};

function frame() {
  if (ctx) {
    const now =
      ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
    let latest = null;
    while (queue.length && queue[0].t <= now) {
      const ev = queue.shift();
      if (ev.kind === 'end') {
        stop(true);
        latest = null;
        break;
      }
      latest = ev;
    }
    if (latest && playing) {
      if (latest.kind === 'count') showCount(latest);
      else {
        const moved = latest.bar !== shownBar;
        showAt(latest.bar, latest.e, latest.v);
        if (moved || latest.e === 0) follow(latest.bar);
      }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Building the song view ----------
function buildKeyboard() {
  const off = registerOffset(settings.shift);
  if (off === kbdOffset) return;
  kbdOffset = off;
  const low = Math.max(PIANO_LOW, 28 + off); // E1 at the original register
  const high = Math.min(PIANO_HIGH, 84 + off); // C6
  const kbd = $('kbd');
  kbd.textContent = '';
  keyEls = {};
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(mod(m));
  const whites = [];
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
  const w = 100 / whites.length;
  for (const m of whites) {
    const k = el('div', 'w');
    if (mod(m) === 0) k.append(el('span', '', `C${Math.floor(m / 12) - 1}`));
    kbd.append(k);
    keyEls[m] = k;
  }
  for (let m = low; m <= high; m++) {
    if (!isBlack(m)) continue;
    const leftWhite = whites.indexOf(m - 1);
    if (leftWhite < 0) continue;
    const k = el('div', 'b');
    k.style.left = `calc(${(leftWhite + 1) * w}% - ${w * 0.3}%)`;
    k.style.width = `${w * 0.6}%`;
    kbd.append(k);
    keyEls[m] = k;
  }
}

function renderChart() {
  const root = $('sections');
  quiet(300);
  root.textContent = '';
  barEls = [];
  for (const s of song.sections) {
    const sec = el('div', 'sec');
    const head = el('div', 'sec-head');
    const nameBtn = el('button', 'sec-name', s.name);
    nameBtn.type = 'button';
    nameBtn.addEventListener('click', () => goTo(s.start));
    head.append(
      nameBtn,
      el('span', 'sec-meta', `bars ${s.start + 1}–${s.end + 1}`),
    );
    const grid = el('div', 'bars');
    for (let i = s.start; i <= s.end; i++) {
      const b = song.bars[i];
      const bar = el('button', 'bar');
      bar.type = 'button';
      const names = b.changes.map((c) => chordName(c.chord));
      bar.setAttribute(
        'aria-label',
        `Bar ${i + 1}: ${names.join(', ') || `continues ${chordName(b.startChord)}`}`,
      );
      const cs = el('span', `cs${b.changes.length > 1 ? ' multi' : ''}`);
      if (b.changes.length)
        cs.append(...spaced(names.map((n) => el('span', '', n))));
      else cs.append(el('span', 'tie', chordName(b.startChord)));
      const r8 = el('span', 'r8');
      for (let k = 0; k < 8; k++)
        r8.append(el('i', b.changes.some((c) => c.pos === k) ? 'chg' : ''));
      bar.append(el('span', 'bn', String(i + 1)), ' ', cs, r8);
      bar.addEventListener('click', () => goTo(i));
      grid.append(bar);
      barEls[i] = bar;
    }
    sec.append(head, grid);
    root.append(sec);
  }
  lastCur = -1;
}

function renderKeyButtons() {
  const seg = $('shiftSeg');
  seg.textContent = '';
  const choices = [{ shift: 0, small: 'original' }].concat(
    song.meta.suggest.map((s) => ({
      shift: s,
      small: `${s < 0 ? 'down' : 'up'} ${Math.abs(s)}`,
    })),
  );
  const labels = choices.map((c) => {
    const label = el('label');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'shift';
    radio.value = String(c.shift);
    radio.addEventListener('change', () => setShift(c.shift));
    label.append(
      ...spaced([
        radio,
        el('b', '', keyShortAt(c.shift)),
        el('small', '', c.small),
      ]),
    );
    return label;
  });
  seg.append(...spaced(labels));
}

function renderSettings() {
  const n = settings.shift;
  $('shiftVal').textContent =
    `${keyShortAt(n)}(${octaveAt(n)}) (${n === 0 ? 'original' : `${minus(n)} ${n === 1 || n === -1 ? 'semitone' : 'semitones'}`})`;
  for (const r of $('shiftSeg').querySelectorAll('input'))
    r.checked = Number(r.value) === n;
  for (const r of $('styleSeg').querySelectorAll('input'))
    r.checked = r.value === settings.style;
  $('octDown').disabled = n - 12 < -LIMITS.maxShift;
  $('octUp').disabled = n + 12 > LIMITS.maxShift;
  $('shiftDown').disabled = n - 1 < -LIMITS.maxShift;
  $('shiftUp').disabled = n + 1 > LIMITS.maxShift;
  const keyline = $('keyline');
  keyline.textContent = '';
  keyline.append('Original key ', el('b', '', keyNameAt(0)), '. ');
  if (n === 0) keyline.append("You're playing in the original key.");
  else
    keyline.append(
      "You're playing in ",
      el('b', '', keyNameAt(n)),
      `, ${n < 0 ? 'down' : 'up'} ${semitones(n)}.`,
    );
  $('tempo').value = String(settings.bpm);
  $('tempoVal').textContent = `${settings.bpm} BPM`;
  $('tempoReset').textContent = String(song.meta.tempo);
  $('vol').value = String(settings.vol);
  $('optCount').checked = settings.count;
  $('optClick').checked = settings.click;
  $('optLoop').checked = settings.loop;
}

function setShift(n) {
  settings.shift = clampShift(n);
  save();
  buildKeyboard();
  renderSettings();
  renderChart();
  if (playing) {
    markBars(shownE);
    els.nowChord.textContent = chordName(chordAt(shownBar, shownE));
    els.nowNum.textContent = chordNum(chordAt(shownBar, shownE));
    updateNext(shownBar, shownE);
  } else {
    showAt(cursorBar, 0);
    audition(cursorBar);
  }
}

// Load a parsed song into the view. `fresh`: a new page load, so read the
// settings that this device keeps for the song.
function loadSong(parsed, fresh) {
  song = parsed;
  keyRoot = parsed.meta.key.root;
  keyMinor = parsed.meta.key.minor;
  if (fresh) {
    const kept = local.get(`autosam:song:${current.slug}`, {});
    settings.shift = clampShift(kept.shift ?? 0);
    settings.bpm = clampBpm(kept.bpm ?? parsed.meta.tempo);
  }
  cursorBar = Math.min(cursorBar, song.bars.length - 1);
  voiced = { key: null, rh: null, lh: null };
  document.title = `${parsed.meta.title} · autosam`;
  $('songTitle').textContent = parsed.meta.title;
  $('crumbPage').textContent = `/${current.slug}`;
  $('eyebrow').textContent = parsed.meta.artist;
  $('eyebrow').hidden = !parsed.meta.artist;
  $('songNotes').textContent = parsed.meta.notes;
  kbdOffset = null;
  buildKeyboard();
  renderKeyButtons();
  renderSettings();
  renderChart();
  showAt(cursorBar, 0);
}

// ---------- The song editor ----------
function setupEditor() {
  const ta = $('chartText');
  const msg = $('editMsg');
  const showErrors = (errors) =>
    say(
      msg,
      errors.slice(0, 6).join('\n') +
        (errors.length > 6 ? `\n…and ${errors.length - 6} more.` : ''),
      'err',
    );
  const dirty = () => ta.value !== current.savedText;
  ta.addEventListener('input', () =>
    say(msg, dirty() ? 'You have changes that are not saved.' : ''),
  );

  $('previewSong').addEventListener('click', () => {
    const parsed = parseSong(ta.value);
    if (parsed.errors.length) return showErrors(parsed.errors);
    if (playing) stop(false);
    loadSong(parsed, false);
    say(msg, 'The page plays your changes now. Save them to keep them.');
  });

  $('saveSong').addEventListener('click', async () => {
    const text = ta.value;
    const parsed = parseSong(text);
    if (parsed.errors.length) return showErrors(parsed.errors);
    if (!getEditKey())
      return say(msg, 'Type the edit key under "Editing" to save.', 'err');
    $('saveSong').disabled = true;
    const r = await api(`/api/songs/${encodeURIComponent(current.slug)}`, {
      method: 'PUT',
      auth: true,
      body: { text, version: current.version },
    });
    $('saveSong').disabled = false;
    if (!r.ok) return say(msg, errorText(r), 'err');
    const moved = r.data.slug !== current.slug;
    if (moved) {
      local.set(
        `autosam:song:${r.data.slug}`,
        local.get(`autosam:song:${current.slug}`, {}),
      );
      history.replaceState(null, '', `/${r.data.slug}`);
    }
    current = { slug: r.data.slug, version: r.data.version, savedText: text };
    if (playing) stop(false);
    loadSong(parsed, false);
    say(
      msg,
      moved ? `Saved. The song is now at /${r.data.slug}.` : 'Saved.',
      'good',
    );
  });

  $('discardSong').addEventListener('click', () => {
    ta.value = current.savedText;
    if (playing) stop(false);
    loadSong(parseSong(current.savedText), false);
    say(msg, 'Back to the saved song.');
  });

  // Two clicks archive the song. The first click arms the button for 4 s.
  let armed = null;
  const archiveBtn = $('archiveSong');
  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    archiveBtn.textContent = 'Archive this song';
    archiveBtn.classList.remove('armed');
  };
  archiveBtn.addEventListener('click', async () => {
    if (!armed) {
      if (!getEditKey())
        return say(msg, 'Type the edit key under "Editing" to archive.', 'err');
      archiveBtn.textContent = 'Click again to archive';
      archiveBtn.classList.add('armed');
      armed = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    archiveBtn.disabled = true;
    const r = await api(`/api/songs/${encodeURIComponent(current.slug)}`, {
      method: 'DELETE',
      auth: true,
    });
    archiveBtn.disabled = false;
    if (!r.ok) return say(msg, errorText(r), 'err');
    if (playing) stop(false);
    current.savedText = ta.value; // no "unsaved changes" warning on the way out
    location.href = '/';
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
  });
}

function wireSongControls() {
  Object.assign(els, {
    secName: $('secName'),
    secBar: $('secBar'),
    songBar: $('songBar'),
    nowChord: $('nowChord'),
    nowNum: $('nowNum'),
    nextChord: $('nextChord'),
    nextIn: $('nextIn'),
    beats: [...$('beats').children],
    playBtn: $('playBtn'),
    playLabel: $('playLabel'),
    playIcon: $('playIcon'),
    rh: $('rhNotes'),
    lh: $('lhNotes'),
    now: $('now'),
  });
  els.playBtn.addEventListener('click', toggle);
  $('startBtn').addEventListener('click', () => goTo(0));
  $('shiftDown').addEventListener('click', () => setShift(settings.shift - 1));
  $('shiftUp').addEventListener('click', () => setShift(settings.shift + 1));
  $('octDown').addEventListener('click', () => setShift(settings.shift - 12));
  $('octUp').addEventListener('click', () => setShift(settings.shift + 12));
  for (const r of $('styleSeg').querySelectorAll('input')) {
    r.addEventListener('change', () => {
      settings.style = r.value;
      save();
      renderSettings();
    });
  }
  $('tempo').addEventListener('input', (e) => {
    settings.bpm = clampBpm(e.target.value);
    $('tempoVal').textContent = `${settings.bpm} BPM`;
    save();
  });
  $('tempoReset').addEventListener('click', () => {
    settings.bpm = song.meta.tempo;
    save();
    renderSettings();
  });
  $('vol').addEventListener('input', (e) => {
    settings.vol = Number(e.target.value);
    if (master)
      master.gain.setTargetAtTime(settings.vol, ctx.currentTime, 0.03);
    save();
  });
  $('optCount').addEventListener('change', (e) => {
    settings.count = e.target.checked;
    save();
  });
  $('optClick').addEventListener('change', (e) => {
    settings.click = e.target.checked;
    save();
  });
  $('optLoop').addEventListener('change', (e) => {
    settings.loop = e.target.checked;
    save();
    markBars(shownE);
    updateNext(shownBar, shownE);
  });
  $('refollow').addEventListener('click', relock);

  window.addEventListener(
    'scroll',
    () => {
      if (playing && !following) {
        updateRefollow();
        return;
      }
      if (!playing) return;
      const t = performance.now();
      if (t < quietUntil && t - intentAt > 400) return; // our own scroll, or a redraw
      unfollow();
    },
    { passive: true },
  );
  window.addEventListener('wheel', markIntent, { passive: true });
  window.addEventListener('touchmove', markIntent, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    if (e.target === document.documentElement) markIntent();
  });

  const typing = (t) =>
    t &&
    (t.tagName === 'TEXTAREA' ||
      (t.tagName === 'INPUT' &&
        !['checkbox', 'radio', 'range'].includes(t.type)));
  const SCROLL_KEYS = [
    'PageUp',
    'PageDown',
    'Home',
    'End',
    'ArrowUp',
    'ArrowDown',
  ];
  document.addEventListener('keydown', (e) => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) toggle();
      return;
    }
    if (SCROLL_KEYS.includes(e.key)) {
      markIntent();
      return;
    }
    if (e.key === 'f' || e.key === 'F') {
      if (playing) relock();
      return;
    }
    if (e.target.tagName === 'INPUT' && e.target.type === 'range') return;
    const secIdx =
      song.bars[playing ? (pendingJump ?? shownBar) : cursorBar].sec;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(song.sections[Math.min(song.sections.length - 1, secIdx + 1)].start);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const s = song.sections[secIdx];
      const here = playing ? shownBar : cursorBar;
      goTo(
        here > s.start && !playing
          ? s.start
          : song.sections[Math.max(0, secIdx - 1)].start,
      );
    } else if (e.key === '0') setShift(0);
    else if (e.key === '1' && song.meta.suggest[0] !== undefined)
      setShift(song.meta.suggest[0]);
    else if (e.key === '2' && song.meta.suggest[1] !== undefined)
      setShift(song.meta.suggest[1]);
  });
  // Stop Space from also "clicking" whichever button has focus
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !typing(e.target)) e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (playing && timer) schedule();
  });
}

async function showSong(slug) {
  $('nfPage').textContent = `/${slug}`;
  const r = await api(`/api/songs/${encodeURIComponent(slug)}`);
  if (!r.ok) {
    $('notFound').hidden = false;
    $('nfMsg').textContent =
      r.status === 404
        ? `There is no song at /${slug}. It may be archived: look in the library.`
        : errorText(r);
    document.title = 'No song here · autosam';
    return;
  }
  const parsed = parseSong(r.data.text);
  if (parsed.errors.length) {
    $('notFound').hidden = false;
    $('nfMsg').textContent =
      `This song file has errors:\n${parsed.errors.slice(0, 6).join('\n')}`;
    return;
  }
  $('songView').hidden = false;
  setupKeyPanel($('songKeySlot'));
  current = {
    slug: r.data.slug,
    version: r.data.version,
    savedText: r.data.text,
  };
  $('chartText').value = r.data.text;
  wireSongControls();
  setupEditor();
  loadSong(parsed, true);
  requestAnimationFrame(frame);
}

// ---------- Start ----------
const path = location.pathname.replace(/\/+$/, '');
if (!path) showLibrary();
else {
  let slug = path.slice(1);
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Keep the raw text. The server answers 404.
  }
  showSong(slug);
}
