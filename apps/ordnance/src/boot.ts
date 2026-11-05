// Ordnance: the page entry point. The swindowzig loader (backends/wasm of
// the swindowzig release, copied to game/zig-out/swindowzig-wasm/ by the
// game build) loads public/ordnance.wasm into the canvas.
//
// The keyboard and the wheel belong to the game. The engine gives Ctrl and
// Cmd shortcuts to the browser, so this file takes them first:
// - Ctrl, Cmd or Alt with a key: no browser action (no bookmark on Ctrl+D,
//   no find, no print). Reload (Ctrl+R, F5) and the developer tools
//   (F12, Ctrl+Shift+I, J, C) stay with the browser.
// - A tap of Alt: no browser menu.
// - Ctrl with the wheel: no page zoom. The engine drops that wheel event,
//   so this file sends it on again with no Ctrl. The game reads Ctrl from
//   the keyboard.
// - The numpad + and - work as = and -: the engine has no numpad keys.
//
// The style and the map seed: the URL (?style=fog&seed=3), else the
// ORDNANCE_STYLE that the dev server was started with (rsbuild.config.js).
import { type LoadFailure, loadWasm } from '#swindowzig/loader';

// RSBuild puts the value in at build time (rsbuild.config.js).
declare const process: { env: Record<string, string | undefined> };

function show(title: string, message: string): void {
  const overlay = document.getElementById('overlay');
  const t = document.getElementById('title');
  const m = document.getElementById('message');
  if (!overlay || !t || !m) return;
  t.textContent = title;
  m.textContent = message;
  overlay.classList.remove('hidden');
}

function onFailure(f: LoadFailure): void {
  if (f.kind === 'no-webgpu') {
    show(
      'This game needs WebGPU',
      'Use a recent Chrome or Edge on a desktop computer.',
    );
  } else {
    show(`Start failed (${f.kind})`, f.message || 'See the browser console.');
  }
}

/** True for the shortcuts that stay with the browser. */
function browserKeeps(e: KeyboardEvent): boolean {
  if (/^F\d{1,2}$/.test(e.key)) return true;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'r') return true;
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(k))
    return true;
  return false;
}

const numpad: Record<string, { code: string; key: string; keyCode: number }> = {
  NumpadAdd: { code: 'Equal', key: '=', keyCode: 187 },
  NumpadSubtract: { code: 'Minus', key: '-', keyCode: 189 },
};

function onKey(e: KeyboardEvent): void {
  const mapped = numpad[e.code];
  if (mapped) {
    // Send it again as the main keyboard key. The engine reads e.code.
    e.preventDefault();
    e.stopImmediatePropagation();
    window.dispatchEvent(
      new KeyboardEvent(e.type, {
        code: mapped.code,
        key: mapped.key,
        keyCode: mapped.keyCode,
        repeat: e.repeat,
      } as KeyboardEventInit),
    );
    return;
  }
  if (browserKeeps(e)) return;
  if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Alt') e.preventDefault();
}
window.addEventListener('keydown', onKey, { capture: true });
window.addEventListener('keyup', onKey, { capture: true });

window.addEventListener(
  'wheel',
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.target?.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  },
  { capture: true, passive: false },
);

// The game uses the right mouse button: no context menu on the canvas.
window.addEventListener('contextmenu', (e) => e.preventDefault());

const styles = [
  'supply_line',
  'drone_war',
  'blitz',
  'fog',
  'manoeuvre',
  'frontier',
];
const params = new URLSearchParams(location.search);
const styleName = params.get('style') ?? process.env.ORDNANCE_STYLE ?? '';
const styleIndex = Math.max(0, styles.indexOf(styleName));
const seed = Math.max(1, Number.parseInt(params.get('seed') ?? '1', 10) || 1);

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (canvas) {
  loadWasm({
    canvas,
    wasmUrl: './ordnance.wasm',
    logPrefix: '[ordnance]',
    canvasSize: 'device',
    env: {
      jsStyle: () => styleIndex,
      jsSeed: () => seed,
    },
    onFailure,
    onStart: () => document.getElementById('overlay')?.classList.add('hidden'),
  }).catch((err) => show('Start failed', String(err)));
}
