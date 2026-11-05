// Ordnance: the page entry point. The swindowzig loader (backends/wasm of
// the swindowzig release, copied to game/zig-out/swindowzig-wasm/ by the
// game build) loads public/ordnance.wasm into the canvas.
import { type LoadFailure, loadWasm } from '#swindowzig/loader';

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

// The game uses the right mouse button: no context menu on the canvas.
window.addEventListener('contextmenu', (e) => e.preventDefault());

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (canvas) {
  loadWasm({
    canvas,
    wasmUrl: './ordnance.wasm',
    logPrefix: '[ordnance]',
    canvasSize: 'device',
    onFailure,
    onStart: () => document.getElementById('overlay')?.classList.add('hidden'),
  }).catch((err) => show('Start failed', String(err)));
}
