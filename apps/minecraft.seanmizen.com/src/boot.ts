// minecraft.seanmizen.com — production WASM bootstrap.
//
// This is a thin production wrapper around the swindowzig WASM bootstrap
// (utils/swindowzig/backends/wasm/*.ts). The swindowzig version is wired for
// the dev server — it fetches `../../zig-out/bin/app.wasm` and the overlay
// it shows on failure is meant for local iteration. This file replaces that
// with a production loader that:
//
//   - Fetches ./app.wasm (same directory as index.html)
//   - Surfaces missing-wasm / missing-WebGPU states through the styled
//     overlay in public/index.html instead of just logging to console
//   - Re-uses the real webgpu + events + audio bridges from swindowzig
//     without copying them (bun bundles them in at build time)

import { audioImports } from '../../../utils/swindowzig/backends/wasm/audio';
import { attachEventListeners } from '../../../utils/swindowzig/backends/wasm/events';
import { initWebGPU } from '../../../utils/swindowzig/backends/wasm/webgpu';

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

declare global {
  interface Window {
    wasmMemory?: WebAssembly.Memory;
  }
}

async function main(): Promise<void> {
  const ov = getOverlay();
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('canvas#canvas not found');
  if (!ov) throw new Error('overlay elements not found');

  // Fullscreen canvas with DPR-aware backing store.
  const resizeCanvas = (): void => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
  };
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // WebGPU availability check.
  if (!('gpu' in navigator)) {
    setStatus(
      ov,
      'err',
      'WebGPU unavailable',
      'This game needs WebGPU',
      'Try the latest Chrome or Edge on desktop. Firefox and Safari WebGPU support is still landing.',
      'Background: <a href="https://caniuse.com/webgpu">caniuse.com/webgpu</a>.',
    );
    return;
  }

  // Fetch the wasm bytes. Same-directory path, not the dev-server relative.
  let wasmBytes: ArrayBuffer;
  try {
    const response = await fetch('./app.wasm', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    wasmBytes = await response.arrayBuffer();
  } catch (err) {
    console.warn('[minecraft] app.wasm fetch failed:', err);
    setStatus(
      ov,
      'warn',
      'build pending',
      'minecraft.seanmizen.com',
      'The voxel engine is being ported to the browser. The docker image, static hosting and Cloudflare tunnel are all wired up — only the wasm artifact is missing.',
      'See <code>apps/minecraft.seanmizen.com/INVESTIGATION.md</code> for the exact next steps.',
    );
    return;
  }

  // Initialise WebGPU eagerly — the Zig side's extern calls run synchronously
  // once the module is instantiated and assume the device is already live.
  let gpu: Awaited<ReturnType<typeof initWebGPU>>;
  try {
    gpu = await initWebGPU(canvas);
  } catch (err) {
    console.error('[minecraft] WebGPU init failed:', err);
    setStatus(
      ov,
      'err',
      'WebGPU init failed',
      'Could not acquire a WebGPU device',
      String(err instanceof Error ? err.message : err),
    );
    return;
  }

  const imports = {
    env: {
      jsGetTime: (): number => performance.now(),
      jsLog: (ptr: number, len: number): void => {
        const mem = window.wasmMemory;
        if (!mem) {
          console.log('[wasm log]', ptr, len);
          return;
        }
        const bytes = new Uint8Array(mem.buffer, ptr, len);
        console.log('[wasm]', new TextDecoder().decode(bytes));
      },
      jsSetDebugInfo: (..._args: unknown[]): void => {
        // noop in prod — debug HUD only used by backends/wasm/debug.html
      },
    },
    webgpu: gpu.imports,
    audio: audioImports,
  };

  let instance: WebAssembly.Instance;
  try {
    const result = await WebAssembly.instantiate(wasmBytes, imports);
    instance = result.instance;
  } catch (err) {
    console.error('[minecraft] wasm instantiate failed:', err);
    setStatus(
      ov,
      'err',
      'wasm instantiate failed',
      'Voxel wasm could not be instantiated',
      String(err instanceof Error ? err.message : err),
      'Check the browser console for the import/export mismatch.',
    );
    return;
  }

  const exports = instance.exports as unknown as {
    memory: WebAssembly.Memory;
    swindowzig_init?: () => void;
    swindowzig_frame?: (timestamp: number) => void;
    swindowzig_event_resize?: (w: number, h: number, dpi: number) => void;
    swindowzig_config_disable_context_menu?: number;
    swindowzig_config_hide_cursor?: number;
  };

  // Expose wasm memory to the webgpu bridge (it needs to read vertex/shader
  // descriptors out of linear memory by pointer).
  window.wasmMemory = exports.memory;

  const init = exports.swindowzig_init;
  const frame = exports.swindowzig_frame;
  const notifyResize = exports.swindowzig_event_resize;

  if (typeof init !== 'function' || typeof frame !== 'function') {
    console.warn(
      '[minecraft] wasm missing swindowzig_init/swindowzig_frame exports',
      Object.keys(exports),
    );
    setStatus(
      ov,
      'warn',
      'entry shim pending',
      'Voxel wasm missing entry exports',
      'The current zig build produces an app.wasm without swindowzig_init/swindowzig_frame exports, so there is no entry point for the frame loop.',
      'See <code>apps/minecraft.seanmizen.com/INVESTIGATION.md</code> § Phase 2.',
    );
    return;
  }

  // Config flags from Zig — default to game-friendly values.
  const disableContextMenu =
    ((exports.swindowzig_config_disable_context_menu as number | undefined) ??
      1) !== 0;
  const hideCursor =
    ((exports.swindowzig_config_hide_cursor as number | undefined) ?? 0) !== 0;
  if (hideCursor) canvas.style.cursor = 'none';

  // Wire DOM event listeners through swindowzig's standard bindings.
  attachEventListeners(
    canvas,
    {
      swindowzig_init: init,
      swindowzig_frame: frame,
      swindowzig_event_resize: notifyResize ?? (() => {}),
    } as never,
    { disableContextMenu },
  );

  // Push initial size to Zig before init so `ctx.window()` returns correct dims.
  if (notifyResize) {
    notifyResize(canvas.width, canvas.height, window.devicePixelRatio || 1);
    window.addEventListener('resize', () => {
      notifyResize(canvas.width, canvas.height, window.devicePixelRatio || 1);
    });
  }

  // Hand off: hide the overlay and start the frame loop.
  hideOverlay(ov);
  try {
    init();
  } catch (err) {
    console.error('[minecraft] swindowzig_init threw:', err);
    setStatus(
      ov,
      'err',
      'init failed',
      'Engine initialisation failed',
      String(err instanceof Error ? err.message : err),
    );
    return;
  }

  // Bind frame into a local so the narrowing from the typeof check above
  // survives into the closure.
  const frameFn = frame;
  function tickLoop(ts: number): void {
    try {
      frameFn(ts);
    } catch (err) {
      console.error('[minecraft] swindowzig_frame threw:', err);
      return;
    }
    requestAnimationFrame(tickLoop);
  }
  requestAnimationFrame(tickLoop);
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
