// Main app wiring. No framework, vanilla DOM. See README.md for the file tree.
//
// Flow:
//   1. Render flagship preset buttons + all-ops disclosure.
//   2. Bind drop zone + file input → stash selected File list.
//   3. On preset click → open panel, show chips + advanced, live-update cmd.
//   4. On "Convert" click → multipart POST /api/convert, push job into queue.
//   5. On job done → enqueue download link + keep row for re-download.

import {
  bullets,
  competitors,
  faq,
  footerLine,
  headline,
  subheadline,
} from './copy';
import { buildCurlCmd, buildFfmpegCmd, suggestOutputName } from './ffmpeg-cmd';
import {
  allOpsByCategory,
  findPreset,
  flagshipPresets,
  type Preset,
  type PresetChip,
  suggestPresetsForFile,
} from './ops';
import {
  deletePreset,
  loadSavedPresets,
  readUrlState,
  savePreset,
  stateToShareableUrl,
  writeUrlState,
} from './url-state';

// ─────────────── state ───────────────

interface Job {
  id: string;
  localId: string;
  filename: string;
  op: string;
  status: 'pending' | 'running' | 'done' | 'error';
  outputUrl?: string;
  error?: string;
}

const state = {
  files: [] as File[],
  currentOp: null as string | null,
  currentArgs: {} as Record<string, string>,
  activeChipId: null as string | null,
  jobs: [] as Job[],
};

// Backend is served through the dev proxy at /api.
const API = '/api';

// ─────────────── helpers ───────────────

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// ─────────────── initial render ───────────────

function renderStatic(): void {
  $('headline').textContent = headline;
  $('subheadline').textContent = subheadline;
  $('lane').textContent = 'Server lane — ' + footerLine;

  // Preset grid
  const grid = $('presetGrid');
  grid.innerHTML = '';
  for (const preset of flagshipPresets) {
    const btn = el('button', { class: 'preset-btn', 'data-op': preset.op }, [
      el('span', { class: 'label' }, [preset.label]),
      el('span', { class: 'tag' }, [preset.tag]),
    ]);
    btn.addEventListener('click', () => selectPreset(preset.op));
    grid.appendChild(btn);
  }

  // All ops disclosure
  const all = $('allOps');
  all.innerHTML = '';
  for (const [cat, ops] of Object.entries(allOpsByCategory)) {
    const header = el('div', { class: 'cat' }, [
      cat.toUpperCase() + ' — ' + ops.length,
    ]);
    all.appendChild(header);
    for (const op of ops) {
      const b = el('button', { 'data-op': op }, [op]);
      b.addEventListener('click', () => selectPreset(op));
      all.appendChild(b);
    }
  }

  // Comparison table
  const compareTable = $('compareTable');
  const table = el('table');
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', {}, ['Service']),
      el('th', {}, ['Free file cap']),
      el('th', {}, ['Free count']),
      el('th', {}, ['Login']),
      el('th', {}, ['Paid entry']),
      el('th', {}, ['The gotcha']),
    ]),
  ]);
  const tbody = el('tbody');
  for (const c of competitors) {
    const tr = el(
      'tr',
      c.name.startsWith('ffmpeg-converter') ? { class: 'us' } : {},
      [
        el('td', {}, [c.name]),
        el('td', {}, [c.freeFileCap]),
        el('td', {}, [c.freeCount]),
        el('td', {}, [c.login]),
        el('td', {}, [c.paid]),
        el('td', {}, [c.gotcha]),
      ],
    );
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  compareTable.innerHTML = '';
  compareTable.appendChild(table);

  // FAQ
  const faqBody = $('faqBody');
  faqBody.innerHTML = '';
  for (const item of faq) {
    const d = el('details', {}, [
      el('summary', {}, [item.q]),
      el('p', {}, [item.a]),
    ]);
    faqBody.appendChild(d);
  }

  // Bullets are rendered as a comment for now (future "about" section).
  // Keeping the import live so the data is exported and easy to pick up.
  void bullets;
}

// ─────────────── preset selection ───────────────

function selectPreset(opName: string): void {
  const preset = findPreset(opName);
  if (!preset) {
    // Op outside the flagship list — build a minimal synthetic preset so the
    // panel still opens.
    state.currentOp = opName;
    state.currentArgs = {};
    state.activeChipId = null;
    renderPanelForSynthetic(opName);
    writeUrlState({ op: opName, args: {} });
    return;
  }

  state.currentOp = opName;
  // Reset args to the first preset chip's defaults if any, otherwise empty.
  const chip = preset.presets[0];
  state.currentArgs = chip ? { ...chip.args } : {};
  state.activeChipId = chip?.id ?? null;

  renderPanel(preset);
  writeUrlState({ op: opName, args: state.currentArgs });
  highlightActiveButton(opName);
}

function highlightActiveButton(op: string): void {
  document.querySelectorAll<HTMLElement>('.preset-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.op === op);
  });
}

function renderPanelForSynthetic(opName: string): void {
  const panel = $('panel');
  panel.hidden = false;
  $('panelTitle').textContent = opName;
  $('panelDesc').textContent =
    'Operation from the full 50-op registry. Advanced users only.';
  $('presetChips').innerHTML = '';
  $('advancedBody').innerHTML =
    '<div class="adv-field"><label>No UI fields mapped for this op — edit the URL directly or the ffmpeg command below.</label></div>';
  updateCmdPreview();
}

function renderPanel(preset: Preset): void {
  const panel = $('panel');
  panel.hidden = false;
  $('panelTitle').textContent = preset.label;
  $('panelDesc').textContent = preset.description;

  // Preset chips
  const chips = $('presetChips');
  chips.innerHTML = '';
  for (const p of preset.presets) {
    const btn = el(
      'button',
      {
        class: 'chip' + (p.id === state.activeChipId ? ' active' : ''),
        'data-chip': p.id,
      },
      [p.label],
    );
    btn.addEventListener('click', () => applyChip(preset, p));
    chips.appendChild(btn);
  }

  // Advanced fields
  const adv = $('advancedBody');
  adv.innerHTML = '';
  if (preset.advanced.length === 0) {
    adv.appendChild(
      el('div', { class: 'adv-field' }, [
        el('label', {}, ['No advanced options for this op. It Just Works™.']),
      ]),
    );
  }
  for (const field of preset.advanced) {
    const wrap = el('div', { class: 'adv-field' });
    wrap.appendChild(el('label', { for: 'adv-' + field.key }, [field.label]));
    let input: HTMLInputElement | HTMLSelectElement;
    if (field.kind === 'select' && field.options) {
      input = el('select', {
        id: 'adv-' + field.key,
        name: field.key,
      }) as HTMLSelectElement;
      for (const o of field.options) {
        const opt = el('option', { value: o.value }, [o.label]);
        if ((state.currentArgs[field.key] ?? field.default) === o.value) {
          opt.setAttribute('selected', '');
        }
        input.appendChild(opt);
      }
    } else {
      input = el('input', {
        id: 'adv-' + field.key,
        name: field.key,
        type: field.kind === 'number' ? 'number' : 'text',
        value: state.currentArgs[field.key] ?? field.default ?? '',
        placeholder: field.placeholder ?? '',
      }) as HTMLInputElement;
    }
    input.addEventListener('input', () => {
      state.currentArgs[field.key] = (input as HTMLInputElement).value;
      state.activeChipId = null;
      for (const c of document.querySelectorAll('.chip')) {
        c.classList.remove('active');
      }
      updateCmdPreview();
      writeUrlState({ op: preset.op, args: state.currentArgs });
    });
    wrap.appendChild(input);
    adv.appendChild(wrap);
  }

  updateCmdPreview();
}

function applyChip(preset: Preset, chip: PresetChip): void {
  state.currentArgs = { ...chip.args };
  state.activeChipId = chip.id;
  renderPanel(preset);
  writeUrlState({ op: preset.op, args: state.currentArgs });
}

function updateCmdPreview(): void {
  if (!state.currentOp) return;
  const inputName = state.files[0]?.name ?? 'input.ext';
  const preset = findPreset(state.currentOp);
  const outputName = preset
    ? suggestOutputName(inputName, preset, state.currentArgs.ext)
    : 'output';
  const cmd = buildFfmpegCmd(
    state.currentOp,
    state.currentArgs,
    inputName,
    outputName,
  );
  const curl = buildCurlCmd(state.currentOp, state.currentArgs, inputName);
  $('cmdLine').textContent = cmd;
  $('curlLine').textContent = curl;
}

// ─────────────── file drop / pick ───────────────

function bindDropZone(): void {
  const dz = $('dropzone');
  const input = $<HTMLInputElement>('fileInput');

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0)
      handleFiles(Array.from(input.files));
  });
  for (const evt of ['dragenter', 'dragover']) {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
  }
  for (const evt of ['dragleave', 'drop']) {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
    });
  }
  dz.addEventListener('drop', (e) => {
    const dt = (e as DragEvent).dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files);
    if (files.length > 0) handleFiles(files);
  });
}

function handleFiles(files: File[]): void {
  state.files = files;
  const first = files[0];
  if (!first) return;

  // Update drop zone text to show what's loaded.
  const dz = $('dropzone');
  const title = dz.querySelector('.drop-title') as HTMLElement;
  const sub = dz.querySelector('.drop-sub') as HTMLElement;
  title.textContent =
    files.length === 1 ? first.name : `${files.length} files ready`;
  sub.innerHTML = `<span class="underline">pick a conversion below</span> or <span class="underline">drop different file</span>`;

  // Auto-suggest: highlight recommended preset buttons for this file type.
  const recommended = suggestPresetsForFile(first.name);
  document.querySelectorAll<HTMLElement>('.preset-btn').forEach((b) => {
    const op = b.dataset.op ?? '';
    b.style.opacity = recommended.includes(op) ? '1' : '0.35';
  });
  // Re-preview cmd if a preset is already chosen.
  if (state.currentOp) updateCmdPreview();
}

// ─────────────── run ───────────────

async function runConversion(): Promise<void> {
  if (!state.currentOp) return;
  if (state.files.length === 0) {
    alert('Drop a file first.');
    return;
  }

  const localId = crypto.randomUUID();
  const job: Job = {
    id: '',
    localId,
    filename: state.files.map((f) => f.name).join(', '),
    op: state.currentOp,
    status: 'pending',
  };
  state.jobs.unshift(job);
  renderQueue();

  const form = new FormData();
  form.append('op', state.currentOp);
  for (const f of state.files) form.append('file', f);
  for (const [k, v] of Object.entries(state.currentArgs)) {
    if (v !== '') form.append(k, v);
  }

  try {
    job.status = 'running';
    renderQueue();
    const res = await fetch(API + '/convert', { method: 'POST', body: form });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || res.statusText);
    }
    const data = await res.json();
    job.id = data.job_id ?? '';
    job.status = 'done';
    job.outputUrl = API + (data.output ?? `/jobs/${job.id}/output`);
    renderQueue();

    // Auto-trigger download so the user sees the file immediately.
    const a = document.createElement('a');
    a.href = job.outputUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e: unknown) {
    job.status = 'error';
    job.error = e instanceof Error ? e.message : String(e);
    renderQueue();
  }
}

function renderQueue(): void {
  const q = $('queue');
  const list = $('queueList');
  q.hidden = state.jobs.length === 0;
  list.innerHTML = '';
  for (const job of state.jobs) {
    const li = el('li');
    li.appendChild(el('span', { class: 'q-name' }, [job.filename]));
    li.appendChild(
      el('span', { class: 'q-status ' + job.status }, [job.status]),
    );
    const actions = el('span', { class: 'q-actions' });
    if (job.status === 'done' && job.outputUrl) {
      const a = el(
        'a',
        { href: job.outputUrl, class: 'ghost small', download: '' },
        ['download'],
      );
      actions.appendChild(a);
    } else if (job.status === 'error') {
      const err = el('span', { class: 'q-name', title: job.error ?? '' }, [
        (job.error ?? '').slice(0, 80) || 'failed',
      ]);
      actions.appendChild(err);
    }
    li.appendChild(actions);
    list.appendChild(li);
  }
}

// ─────────────── saved presets ───────────────

function renderSaved(): void {
  const list = loadSavedPresets();
  const section = $('savedPresets');
  const ul = $('savedList');
  section.hidden = list.length === 0;
  ul.innerHTML = '';
  for (const p of list) {
    const li = el('li');
    const a = el('button', { class: 'ghost small', 'data-id': p.id }, [
      p.name + ' → ' + p.op,
    ]);
    a.addEventListener('click', () => {
      state.currentArgs = { ...p.args };
      selectPreset(p.op);
      writeUrlState({ op: p.op, args: p.args });
    });
    const x = el('button', { class: 'x', 'aria-label': 'Delete preset' }, [
      '×',
    ]);
    x.addEventListener('click', () => {
      deletePreset(p.id);
      renderSaved();
    });
    li.appendChild(a);
    li.appendChild(x);
    ul.appendChild(li);
  }
}

// ─────────────── theme ───────────────

const THEME_KEY = 'ffmpeg-converter:theme';
function applyInitialTheme(): void {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved ?? (prefersDark ? 'dark' : 'dark'); // default dark
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(theme);
}
function toggleTheme(): void {
  const isDark = document.body.classList.contains('dark');
  const next = isDark ? 'light' : 'dark';
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(next);
  localStorage.setItem(THEME_KEY, next);
}

// ─────────────── bindings ───────────────

function bindControls(): void {
  $('runBtn').addEventListener('click', runConversion);

  $('closePanel').addEventListener('click', () => {
    $('panel').hidden = true;
    state.currentOp = null;
    writeUrlState({ args: {} });
    highlightActiveButton('');
  });

  $('copyCmd').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('cmdLine').textContent ?? '');
    flash($('copyCmd'));
  });
  $('copyCurl').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('curlLine').textContent ?? '');
    flash($('copyCurl'));
  });
  $('shareBtn').addEventListener('click', async () => {
    const url = stateToShareableUrl({
      op: state.currentOp ?? undefined,
      args: state.currentArgs,
    });
    await navigator.clipboard.writeText(url);
    flash($('shareBtn'));
  });
  $('saveBtn').addEventListener('click', () => {
    if (!state.currentOp) return;
    const name = prompt('Name this preset:', state.currentOp);
    if (!name) return;
    savePreset(name, state.currentOp, state.currentArgs);
    renderSaved();
  });
  $('themeBtn').addEventListener('click', toggleTheme);
}

function flash(btn: HTMLElement): void {
  const prev = btn.textContent;
  btn.textContent = '✓';
  setTimeout(() => {
    btn.textContent = prev;
  }, 900);
}

// ─────────────── boot ───────────────

function boot(): void {
  applyInitialTheme();
  renderStatic();
  bindDropZone();
  bindControls();
  renderSaved();

  // Hydrate from URL state (bookmarked preset).
  const urlState = readUrlState();
  if (urlState.op) {
    state.currentArgs = urlState.args;
    selectPreset(urlState.op);
  }

  // Health ping — silently mark the backend as alive.
  fetch(API + '/health')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data) {
        console.log('[ffmpeg-converter] backend alive, ops=' + data.ops);
      } else {
        console.warn(
          '[ffmpeg-converter] backend health check failed — running with mocked endpoint',
        );
      }
    })
    .catch(() => {
      console.warn(
        '[ffmpeg-converter] backend unreachable — /api/convert will fail. See web/README.md',
      );
    });
}

boot();
