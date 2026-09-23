// Browser side of the spike. run.mjs calls window.detect() and
// window.bench() through Playwright.

import { FFmpeg } from '/ffmpeg/index.js';

// What the site would check before it shows "Convert on this device".
window.detect = () => ({
  webAssembly: typeof WebAssembly === 'object',
  simd: WebAssembly.validate(
    new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10,
      1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]),
  ),
  sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
  crossOriginIsolated: self.crossOriginIsolated === true,
  cores: navigator.hardwareConcurrency ?? null,
  deviceMemoryGB: navigator.deviceMemory ?? null,
});

const loaded = {};
async function load(core) {
  if (loaded[core]) return { ff: loaded[core], loadMs: 0 };
  const ff = new FFmpeg();
  const logs = [];
  ff.on('log', ({ message }) => logs.push(message));
  const t = performance.now();
  const base = core === 'mt' ? '/core-mt' : '/core';
  await ff.load({
    coreURL: `${base}/ffmpeg-core.js`,
    wasmURL: `${base}/ffmpeg-core.wasm`,
    ...(core === 'mt' ? { workerURL: `${base}/ffmpeg-core.worker.js` } : {}),
  });
  ff.logs = logs;
  loaded[core] = ff;
  return { ff, loadMs: performance.now() - t };
}

// One conversion. Returns timings in ms, or { error }.
window.bench = async ({ core, input, args, output }) => {
  try {
    const { ff, loadMs } = await load(core);
    let t = performance.now();
    const data = new Uint8Array(
      await (await fetch(`/media/${input}`)).arrayBuffer(),
    );
    const readMs = performance.now() - t;
    await ff.writeFile(input, data);
    ff.logs.length = 0;
    t = performance.now();
    const code = await ff.exec([
      '-hide_banner',
      '-y',
      '-i',
      input,
      ...args,
      output,
    ]);
    const execMs = performance.now() - t;
    let outBytes = 0;
    if (code === 0) outBytes = (await ff.readFile(output)).length;
    await ff.deleteFile(input).catch(() => {});
    await ff.deleteFile(output).catch(() => {});
    if (code === 0) return { loadMs, readMs, execMs, outBytes };
    // After an abort the instance is dead. Load a new one next time.
    ff.terminate();
    loaded[core] = undefined;
    return { error: `exit ${code}: ${ff.logs.slice(-4).join(' | ')}` };
  } catch (e) {
    loaded[core] = undefined;
    return { error: String(e?.message ?? e).slice(0, 300) };
  }
};

window.version = async () => {
  const { ff } = await load('st');
  ff.logs.length = 0;
  await ff.exec(['-version']);
  return ff.logs[0];
};

// The same, but the file is mounted (WORKERFS) and not copied into WASM
// memory. This is how the site would pass a File from <input type=file>.
window.benchMounted = async ({ core, input, args, output }) => {
  try {
    const { ff } = await load(core);
    let t = performance.now();
    // A File from <input type=file> when there is one (the real site path),
    // else a download.
    const picked = document.getElementById('file')?.files?.[0];
    const file =
      picked ??
      new File([await (await fetch(`/media/${input}`)).blob()], input);
    input = file.name;
    const readMs = performance.now() - t;
    await ff.createDir('/in').catch(() => {});
    await ff.mount('WORKERFS', { files: [file] }, '/in');
    t = performance.now();
    const code = await ff.exec([
      '-hide_banner',
      '-y',
      '-i',
      `/in/${input}`,
      ...args,
      output,
    ]);
    const execMs = performance.now() - t;
    await ff.unmount('/in');
    if (code !== 0)
      throw new Error(`exit ${code}: ${ff.logs.slice(-3).join(' | ')}`);
    const outBytes = (await ff.readFile(output)).length;
    await ff.deleteFile(output);
    return { readMs, execMs, outBytes };
  } catch (e) {
    loaded[core] = undefined;
    return { error: String(e?.message ?? e).slice(0, 300) };
  }
};
