// action.seanmizen.com: the page entry point. The swindowzig loader
// (utils/swindowzig/backends/wasm/loader.ts) builds every wasm import,
// the WebSocket bridge (backends/wasm/net.ts) included. bun bundles this
// file into public/boot.js (build.sh).

import { gameOwnsKey } from '#/utils/swindowzig/backends/wasm/events';
import {
  type LoadFailure,
  loadWasm,
} from '#/utils/swindowzig/backends/wasm/loader';

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

// The console key: the backtick key (the key left of 1, on any layout).
// swindowzig has no key code for it. The web backend sends each key that it
// does not know as the Unknown key, and the game opens the console on
// Unknown (game/src/game_console.zig). So this listener stops the other
// unknown keys before backends/wasm/events.ts gets them.
// While the console is open, the hidden text <input> has the focus. Then
// the backtick key types "`", and the console closes on that character.
// On a layout where the key types another character, the listener sends
// "`" in its place.
const KNOWN_KEYCODES = new Set([
  8, 9, 13, 16, 17, 18, 27, 32, 37, 38, 39, 40, 91, 92, 93, 224,
]);
const knownKey = (code: number): boolean =>
  KNOWN_KEYCODES.has(code) ||
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90);

function filterKey(e: KeyboardEvent): void {
  const active = document.activeElement;
  const typing = active instanceof HTMLInputElement;
  if (e.code === 'Backquote') {
    if (typing && e.type === 'keydown') {
      e.preventDefault();
      active.dispatchEvent(new InputEvent('input', { data: '`' }));
    }
    return;
  }
  // While text input is on, the hidden <input> and events.ts handle keys.
  if (typing || knownKey(e.keyCode || e.which)) return;
  if (gameOwnsKey(e)) e.preventDefault();
  e.stopImmediatePropagation();
}
window.addEventListener('keydown', filterKey, { capture: true });
window.addEventListener('keyup', filterKey, { capture: true });

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (canvas) {
  loadWasm({
    canvas,
    wasmUrl: './action.wasm',
    logPrefix: '[action]',
    canvasSize: 'device',
    cursorFollowsLock: true,
    // No lockOnClick: the game asks for the lock (ctx.setMouseCapture) on
    // the click that it wants, and reads the state with jsPointerLocked.
    onFailure,
    onStart: () => document.getElementById('overlay')?.classList.add('hidden'),
  }).catch((err) => show('Start failed', String(err)));
}
