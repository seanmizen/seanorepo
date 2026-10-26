// autosam morph debug panel.
//
// Where: morph.js imports this module when the URL has ?debug=morph.
// When: once, at page load. The panel stays on screen.
// Why: the flow has settings with no one right value. The panel changes
// them, holds the morph at a time t, and replays it, so a person can find
// good values by eye. Copy puts the settings on the clipboard as JSON.

const morph = window.autosamMorph;
const p = morph.params;
const root = document.documentElement;

// name, kind, then for a range: min, max, step, unit.
const FIELDS = [
  ['matcher', 'select', ['demons', 'edges', 'none']],
  ['align', 'check'],
  ['normalWeight', 'range', 0, 0.5, 0.005, 'em'],
  ['sigma', 'range', 0, 0.2, 0.005, 'em'],
  ['iterations', 'range', 0, 200, 1, ''],
  ['step', 'range', 0.001, 0.05, 0.001, 'em'],
  ['band', 'range', 0.02, 0.6, 0.01, 'em'],
  ['flowRes', 'range', 8, 128, 1, '/em'],
  ['minSize', 'range', 0, 100, 1, 'px'],
  ['ms', 'range', 100, 5000, 50, 'ms'],
  ['hold', 'check'],
  ['t', 'range', 0, 1, 0.005, ''],
];

// A change to these needs new flows, so a held morph plays again.
const REBUILD = new Set([
  'matcher',
  'align',
  'normalWeight',
  'sigma',
  'iterations',
  'step',
  'band',
  'flowRes',
  'minSize',
]);

const duration = () =>
  Number.parseFloat(getComputedStyle(root).getPropertyValue('--morph')) || 0;

const panel = document.createElement('div');
panel.className = 'morph-debug';
panel.dataset.morphSkip = '';

const value = (name) => (name === 'ms' ? duration() : p[name]);

function set(name, v) {
  if (name === 'ms') root.style.setProperty('--morph', `${v}ms`);
  else p[name] = v;
  if (REBUILD.has(name) && p.hold) morph.replay();
}

for (const [name, kind, ...opt] of FIELDS) {
  const row = document.createElement('label');
  const label = document.createElement('span');
  label.textContent = name;
  const out = document.createElement('output');
  let input;
  if (kind === 'select') {
    input = document.createElement('select');
    for (const o of opt[0]) input.add(new Option(o, o));
    input.value = value(name);
    input.addEventListener('change', () => set(name, input.value));
  } else if (kind === 'check') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value(name);
    input.addEventListener('change', () => set(name, input.checked));
  } else {
    const [min, max, step, unit] = opt;
    input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step });
    input.value = value(name);
    const show = () => {
      out.textContent = `${input.value}${unit}`;
    };
    show();
    input.addEventListener('input', () => {
      show();
      if (name === 't') p.t = Number(input.value);
    });
    // A rebuild is slow, so it waits for the end of the drag.
    if (name !== 't') {
      input.addEventListener('change', () => set(name, Number(input.value)));
    }
  }
  row.append(label, input, out);
  panel.append(row);
}

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
