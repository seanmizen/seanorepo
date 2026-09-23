// Runs the spike: every case in the browser (ffmpeg.wasm) and natively.
//   node serve.mjs <media> &   then   node run.mjs <media> [filter]
// Needs ffmpeg on PATH for the native times, and the media from make-media.sh.

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const media = process.argv[2];
const only = process.argv[3];
const LIMIT_MS = Number(process.env.LIMIT_S ?? 300) * 1000;

// Same args as web/src/tools.ts, so the numbers compare like for like.
const MP4 = [
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  '-movflags',
  '+faststart',
];
const CASES = [
  {
    name: 'MOV to MP4 (iPhone HEVC 1080p, 20 s)',
    input: 'iphone.mov',
    args: MP4,
    output: 'out.mp4',
  },
  {
    name: 'MKV to MP4 (360p, 5 s)',
    input: 'clip.mkv',
    args: MP4,
    output: 'out.mp4',
  },
  {
    name: 'Compress video (720p, 60 s)',
    input: 'big.mp4',
    args: [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
    ],
    output: 'out.mp4',
  },
  {
    name: 'Trim video (720p, 5 s of 60)',
    input: 'big.mp4',
    args: [
      '-ss',
      '10',
      '-t',
      '5',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
    ],
    output: 'out.mp4',
  },
  {
    name: 'MP4 to GIF (4 s, 480 wide)',
    input: 'iphone.mov',
    args: [
      '-ss',
      '2',
      '-t',
      '4',
      '-vf',
      'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
    ],
    output: 'out.gif',
  },
  {
    name: 'MP4 to MP3 (60 s)',
    input: 'big.mp4',
    args: ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'],
    output: 'out.mp3',
  },
  {
    name: 'WAV to MP3 (8 s)',
    input: 'voice.wav',
    args: ['-c:a', 'libmp3lame', '-b:a', '192k'],
    output: 'out.mp3',
  },
  {
    name: 'PNG to JPG',
    input: 'logo.png',
    args: ['-q:v', '2'],
    output: 'out.jpg',
  },
  {
    name: 'WebP to JPG',
    input: 'photo.webp',
    args: ['-q:v', '2'],
    output: 'out.jpg',
  },
  {
    name: 'HEIC to JPG (iPhone, 48 tiles)',
    input: 'iphone-image1.heic',
    args: ['-q:v', '2'],
    output: 'out.jpg',
  },
].filter((c) => !only || c.name.toLowerCase().includes(only.toLowerCase()));

function native(c) {
  const out = join(media, `native-${c.output}`);
  const t = performance.now();
  try {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      join(media, c.input),
      ...c.args,
      out,
    ]);
    return { execMs: performance.now() - t, outBytes: statSync(out).size };
  } catch (e) {
    return { error: String(e.stderr ?? e).slice(0, 200) };
  }
}

const browser = await chromium.launch();
const results = [];

async function page(throttle) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await p.goto('http://localhost:4060/');
  await p.waitForFunction(() => typeof window.bench === 'function');
  return p;
}

const first = await page(1);
console.log(
  'detect:',
  JSON.stringify(await first.evaluate(() => window.detect())),
);
console.log('wasm ffmpeg:', await first.evaluate(() => window.version()));
await first.close();

for (const [label, core, throttle] of [
  ['wasm 1 thread', 'st', 1],
  ['wasm 4 threads', 'mt', 1],
  ['wasm 1 thread, CPU/4', 'st', 4],
  ['wasm 4 threads, CPU/4', 'mt', 4],
]) {
  let p = await page(throttle);
  for (const c of CASES) {
    // A case that runs longer than LIMIT_MS counts as a failure. The page
    // is replaced, because ffmpeg.wasm cannot stop a running exec.
    const r = await Promise.race([
      // The threaded core deadlocks when x264 asks for more threads than
      // its pool has (8 on an 8-core machine). 4 or fewer works.
      p.evaluate((a) => window.bench(a), {
        core,
        input: c.input,
        args: core === 'mt' ? ['-threads', '4', ...c.args] : c.args,
        output: c.output,
      }),
      new Promise((ok) =>
        setTimeout(() => ok({ error: `over ${LIMIT_MS / 1000} s` }), LIMIT_MS),
      ),
    ]);
    if (r.error?.startsWith('over')) {
      await p.close();
      p = await page(throttle);
    }
    results.push({ case: c.name, where: label, ...r });
    console.log(
      label.padEnd(22),
      c.name.padEnd(40),
      r.error
        ? `ERROR ${r.error}`
        : `${(r.execMs / 1000).toFixed(1)} s (load ${(r.loadMs / 1000).toFixed(1)} s)`,
    );
  }
  await p.close();
}
for (const c of CASES) {
  const r = native(c);
  results.push({
    case: c.name,
    where: 'native',
    ...r,
    inBytes: statSync(join(media, c.input)).size,
  });
  console.log(
    'native'.padEnd(22),
    c.name.padEnd(40),
    r.error ? `ERROR ${r.error}` : `${(r.execMs / 1000).toFixed(1)} s`,
  );
}
await browser.close();
console.log(JSON.stringify(results));
