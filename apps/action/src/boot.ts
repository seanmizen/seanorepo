// action.seanmizen.com: the page entry point. The swindowzig loader
// (utils/swindowzig/backends/wasm/loader.ts) builds every wasm import,
// the WebSocket bridge (backends/wasm/net.ts) included. bun bundles this
// file into public/boot.js (build.sh).

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
