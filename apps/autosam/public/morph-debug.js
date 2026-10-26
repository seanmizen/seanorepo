// autosam morph debug panel.
//
// Where: morph.js imports this module when the URL has ?debug=true.
// When: once, at page load. The panel stays on screen.
// Why: the morph has methods and settings with no one right value. The
// panel picks the method, changes its settings, holds the morph at a time
// t, and replays it, so a person can compare by eye. Copy puts the
// settings on the clipboard as JSON.

const morph = window.autosamMorph;
const p = morph.params;
const root = document.documentElement;
const FLOW = ['edges', 'demons'];

// Each row of the panel. A row with methods shows only for those methods.
// A change to a row with rebuild makes new flows, so a held morph replays.
const FIELDS = [
  { name: 'method', options: morph.methods, rebuild: true },
  {
    name: 'normalWeight',
    min: 0,
    max: 0.5,
    step: 0.005,
    unit: 'em',
    methods: ['edges'],
    rebuild: true,
  },
  {
    name: 'sigma',
    min: 0,
    max: 0.2,
    step: 0.005,
    unit: 'em',
    methods: FLOW,
    rebuild: true,
  },
  {
    name: 'iterations',
    min: 0,
    max: 200,
    step: 1,
    unit: '',
    methods: ['demons'],
    rebuild: true,
  },
  {
    name: 'step',
    min: 0.001,
    max: 0.05,
    step: 0.001,
    unit: 'em',
    methods: ['demons'],
    rebuild: true,
  },
  {
    name: 'band',
    min: 0.02,
    max: 0.6,
    step: 0.01,
    unit: 'em',
    methods: ['demons'],
    rebuild: true,
  },
  {
    name: 'flowRes',
    min: 8,
    max: 128,
    step: 1,
    unit: '/em',
    methods: FLOW,
    rebuild: true,
  },
  {
    name: 'minSize',
    min: 0,
    max: 100,
    step: 1,
    unit: 'px',
    methods: FLOW,
    rebuild: true,
  },
  { name: 'ms', min: 100, max: 5000, step: 50, unit: 'ms' },
  { name: 'hold', check: true },
  { name: 't', min: 0, max: 1, step: 0.005, unit: '' },
];

const duration = () =>
  Number.parseFloat(getComputedStyle(root).getPropertyValue('--morph')) || 0;

const value = (name) => (name === 'ms' ? duration() : p[name]);

const panel = document.createElement('div');
panel.className = 'morph-debug';
panel.dataset.morphSkip = '';

const rows = [];
const showRows = () => {
  for (const { row, field } of rows) {
    row.hidden = Boolean(field.methods) && !field.methods.includes(p.method);
  }
};

function set(field, v) {
  if (field.name === 'ms') root.style.setProperty('--morph', `${v}ms`);
  else p[field.name] = v;
  if (field.name === 'method') showRows();
  if (field.rebuild && p.hold) morph.replay();
}

for (const field of FIELDS) {
  const row = document.createElement('label');
  const label = document.createElement('span');
  label.textContent = field.name;
  const out = document.createElement('output');
  let input;
  if (field.options) {
    input = document.createElement('select');
    for (const o of field.options) input.add(new Option(o, o));
    input.value = value(field.name);
    input.addEventListener('change', () => set(field, input.value));
  } else if (field.check) {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value(field.name);
    input.addEventListener('change', () => set(field, input.checked));
  } else {
    const { min, max, step, unit } = field;
    input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step });
    input.value = value(field.name);
    const show = () => {
      out.textContent = `${input.value}${unit}`;
    };
    show();
    input.addEventListener('input', () => {
      show();
      if (field.name === 't') p.t = Number(input.value);
    });
    // A rebuild is slow, so it waits for the end of the drag.
    if (field.name !== 't') {
      input.addEventListener('change', () => set(field, Number(input.value)));
    }
  }
  row.append(label, input, out);
  panel.append(row);
  rows.push({ row, field });
}
showRows();

const stats = document.createElement('pre');
const showStats = () => {
  stats.textContent = morph.stats
    ? Object.entries(morph.stats)
        .map(([k, v]) => `${k} ${v}`)
        .join('  ')
    : 'press a theme button';
};
showStats();
addEventListener('autosam-morph-stats', showStats);

const buttons = document.createElement('div');
const replay = document.createElement('button');
replay.type = 'button';
replay.textContent = 'Replay';
replay.addEventListener('click', () => morph.replay());
const copy = document.createElement('button');
copy.type = 'button';
copy.textContent = 'Copy';
copy.addEventListener('click', () => {
  const out = { ...p, ms: duration() };
  delete out.hold;
  delete out.t;
  navigator.clipboard.writeText(JSON.stringify(out));
  copy.textContent = 'Copied';
  setTimeout(() => {
    copy.textContent = 'Copy';
  }, 1200);
});
buttons.append(replay, copy);
panel.append(stats, buttons);
document.body.append(panel);
