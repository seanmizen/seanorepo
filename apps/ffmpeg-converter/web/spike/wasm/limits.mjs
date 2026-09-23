// File-size limits of ffmpeg.wasm: MP4 to MP3 on 250 MB to 3 GB inputs,
// with the 1-thread and the 4-thread core, and with the file mounted.
// Audio only, so the time is mostly reading the file into WASM memory.
//   node serve.mjs <media> &   then   node limits.mjs

import { chromium } from 'playwright';

const browser = await chromium.launch();
for (const [core, fn] of [
  ['st', 'bench'],
  ['mt', 'bench'],
  ['st', 'benchMounted'],
]) {
  for (const mb of [250, 500, 1000, 1500, 1900, 3000]) {
    const p = await browser.newPage(); // A new page for each size: a clean heap.
    await p.goto('http://localhost:4060/');
    await p.waitForFunction(() => typeof window.bench === 'function');
    const r = await p
      .evaluate(
        ([input, core, fn]) =>
          window[fn]({
            core,
            input,
            args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'],
            output: 'out.mp3',
          }),
        [`size-${mb}mb.mp4`, core, fn],
      )
      .catch((e) => ({ error: String(e.message).slice(0, 200) }));
    console.log(
      `${core} ${fn === 'bench' ? 'copy ' : 'mount'}`,
      `${String(mb).padStart(5)} MB`,
      r.error
        ? `FAIL ${r.error}`
        : `ok, read ${(r.readMs / 1000).toFixed(1)} s, convert ${(r.execMs / 1000).toFixed(1)} s`,
    );
    await p.close();
  }
}
await browser.close();
