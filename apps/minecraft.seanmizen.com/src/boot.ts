// minecraft.seanmizen.com: production entry point.
//
// All start-up code and every wasm import are in the swindowzig loader
// (utils/swindowzig/backends/wasm/loader.ts). bun bundles the loader into
// public/boot.js. This file gives the loader its options:
//
//   - It loads ./app.wasm, in the same directory as index.html.
//   - It starts the chunk worker pool (C9) with the content-hashed chunk
//     files. bundle.sh gives their names to `bun build --define`. Without
//     the names, the main thread runs the chunk jobs.
//   - It shows each failure in the styled overlay of public/index.html.

import {
  type LoadFailure,
  loadWasm,
} from '#/utils/swindowzig/backends/wasm/loader';

// bundle.sh defines these names, for example './chunks-0123456789abcdef.wasm'.
declare const __CHUNKS_WASM_URL__: string | undefined;
declare const __CHUNK_WORKER_URL__: string | undefined;

function chunkWorkerFiles():
  | { wasmUrl: string; workerUrl: string }
  | undefined {
  if (
    typeof __CHUNKS_WASM_URL__ !== 'string' ||
    typeof __CHUNK_WORKER_URL__ !== 'string'
  ) {
    return undefined;
  }
  return { wasmUrl: __CHUNKS_WASM_URL__, workerUrl: __CHUNK_WORKER_URL__ };
}

interface OverlayElements {
  overlay: HTMLElement;
  status: HTMLElement;
  title: HTMLElement;
  message: HTMLElement;
  hint: HTMLElement;
}

function getOverlay(): OverlayElements | null {
  const overlay = document.getElementById('overlay');
  const status = document.getElementById('status');
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const hint = document.getElementById('hint');
  if (!overlay || !status || !title || !message || !hint) return null;
  return { overlay, status, title, message, hint };
}

function setStatus(
  ov: OverlayElements,
  tone: 'ok' | 'warn' | 'err',
  label: string,
  title: string,
  message: string,
  hint?: string,
): void {
  ov.status.className = `status ${tone}`;
  ov.status.textContent = label;
  ov.title.textContent = title;
  ov.message.textContent = message;
  if (hint !== undefined) ov.hint.innerHTML = hint;
  ov.overlay.classList.remove('hidden');
}

function hideOverlay(ov: OverlayElements): void {
  ov.overlay.classList.add('hidden');
}

function showFailure(ov: OverlayElements, failure: LoadFailure): void {
  switch (failure.kind) {
    case 'no-webgpu':
      setStatus(
        ov,
        'err',
        'WebGPU unavailable',
        'This game needs WebGPU',
        'Try the latest Chrome or Edge on desktop. Firefox and Safari WebGPU support is still landing.',
        'Background: <a href="https://caniuse.com/webgpu">caniuse.com/webgpu</a>.',
      );
      return;
    case 'fetch':
      setStatus(
        ov,
        'warn',
        'build pending',
        'minecraft.seanmizen.com',
        'The voxel engine is being ported to the browser. The docker image, static hosting and Cloudflare tunnel are all wired up — only the wasm artifact is missing.',
        'See <code>apps/minecraft.seanmizen.com/INVESTIGATION.md</code> for the exact next steps.',
      );
      return;
    case 'webgpu-init':
      setStatus(
        ov,
        'err',
        'WebGPU init failed',
        'Could not acquire a WebGPU device',
        failure.message,
      );
      return;
    case 'instantiate':
      setStatus(
        ov,
        'err',
        'wasm instantiate failed',
        'Voxel wasm could not be instantiated',
        failure.message,
        'Check the browser console for the import/export mismatch.',
      );
      return;
    case 'missing-exports':
      setStatus(
        ov,
        'warn',
        'entry shim pending',
        'Voxel wasm missing entry exports',
        'The current zig build produces an app.wasm without swindowzig_init/swindowzig_frame exports, so there is no entry point for the frame loop.',
        'See <code>apps/minecraft.seanmizen.com/INVESTIGATION.md</code> § Phase 2.',
      );
      return;
    case 'init':
      setStatus(
        ov,
        'err',
        'init failed',
        'Engine initialisation failed',
        failure.message,
      );
      return;
  }
}

async function main(): Promise<void> {
  const ov = getOverlay();
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('canvas#canvas not found');
  if (!ov) throw new Error('overlay elements not found');

  await loadWasm({
    canvas,
    wasmUrl: './app.wasm',
    chunkWorkers: chunkWorkerFiles(),
    logPrefix: '[minecraft]',
    canvasSize: 'device',
    lockOnClick: true,
    onFailure: (failure) => showFailure(ov, failure),
    onStart: () => hideOverlay(ov),
  });
}

main().catch((err) => {
  console.error('[minecraft] boot failed:', err);
  const ov = getOverlay();
  if (ov) {
    setStatus(
      ov,
      'err',
      'boot error',
      'Something broke while starting up',
      String(err instanceof Error ? err.message : err),
    );
  }
});
