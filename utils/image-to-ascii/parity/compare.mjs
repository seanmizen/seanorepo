#!/usr/bin/env node
// compare.mjs: runs the JS and the Go image-to-ascii on the same inputs and
// reports how many characters differ.
//
// Where: a dev machine with Node, the repo's node_modules, and Go.
// When:  while both versions exist, to review the Go port.
// Why:   the Go binary replaces the JS tool. This shows how close the two are.
//        The resize differs (sharp uses Lanczos, Go averages areas), so a few
//        percent of characters differ at edges. The shape must match exactly.
//
// Usage: node utils/image-to-ascii/parity/compare.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = join(root, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'ascii-parity-'));
const bin = join(tmp, 'image-to-ascii');
execFileSync('go', ['build', '-o', bin, './cmd/image-to-ascii'], { cwd: root });

const photo = join(
  repo,
  'apps/seanmizen.com/src/components/shader-sean/IMG_4011_crop2.jpeg',
);
const logo = join(repo, 'apps/seanmizen.com/public/android-chrome-512x512.png');
const fixed = ['--var', 'hostname=asus', '--var', 'uptime=300d 2h 34m'];
const cases = [
  ['defaults', [photo]],
  ['reverse + contrast', [photo, '--reverse', '--contrast', '180']],
  ['codepage437', [photo, '--charset', 'codepage437', '--width', '60']],
  [
    'chars a-z',
    [photo, '--chars', 'abcdefghijklmnopqrstuvwxyz', '--width', '52'],
  ],
  [
    'brightness + saturation',
    [photo, '--brightness', '130', '--saturation', '40'],
  ],
  [
    'sepia + hue + grayscale',
    [photo, '--sepia', '50', '--hue', '90', '--grayscale', '30'],
  ],
  ['invert', [photo, '--invert', '100']],
  ['sharpen', [photo, '--sharpen', '--sharpness', '12']],
  ['edges', [photo, '--edges', '--edgeIntensity', '2']],
  ['threshold', [photo, '--threshold', '110']],
  ['FloydSteinberg', [photo, '--dithering', 'FloydSteinberg']],
  ['Atkinson', [photo, '--dithering', 'Atkinson']],
  ['transparent PNG', [logo, '--width', '60']],
  [
    'keyframes + margin',
    [
      photo,
      '--key',
      'contrast=0:100,10:250',
      '--key',
      'brightness=0:100,15:0',
      '--reverse',
      '--margin',
      '2',
      '--ease',
      'smooth',
    ],
  ],
  ['login.json', ['--spec', join(root, 'examples/login.json'), ...fixed]],
  [
    'sean-login.json',
    ['--spec', join(root, 'examples/sean-login.json'), ...fixed],
  ],
];

const render = (cmd, args, dir) => {
  const animated = args.includes('--key') || args.includes('--spec');
  if (animated) {
    execFileSync(cmd[0], [...cmd.slice(1), ...args, '--out', dir], {
      stdio: 'ignore',
    });
    return readdirSync(dir)
      .sort()
      .map((f) => readFileSync(join(dir, f), 'utf8'));
  }
  return [
    execFileSync(cmd[0], [...cmd.slice(1), ...args], { encoding: 'utf8' }),
  ];
};

let failed = 0;
console.log('case                        frames  size      differ');
cases.forEach(([name, args], n) => {
  const js = render(
    ['node', join(root, 'src/cli.mjs')],
    args,
    join(tmp, `js${n}`),
  );
  const go = render([bin], args, join(tmp, `go${n}`));
  let total = 0;
  let diff = 0;
  let shape = js.length === go.length;
  js.forEach((frame, i) => {
    const a = frame.split('\n');
    const b = (go[i] ?? '').split('\n');
    if (a.length !== b.length) shape = false;
    a.forEach((line, r) => {
      const x = [...line];
      const y = [...(b[r] ?? '')];
      if (x.length !== y.length) shape = false;
      x.forEach((c, k) => {
        total++;
        if (c !== y[k]) diff++;
      });
    });
  });
  const rows = js[0].split('\n').length;
  const cols = [...js[0].split('\n')[0]].length;
  const pct = total ? ((100 * diff) / total).toFixed(1) : '0.0';
  if (!shape) failed++;
  console.log(
    `${name.padEnd(28)}${String(js.length).padStart(6)}  ${`${cols}x${rows}`.padEnd(8)}${shape ? '' : ' SHAPE MISMATCH'}  ${pct.padStart(5)}%`,
  );
});
process.exit(failed ? 1 : 0);
