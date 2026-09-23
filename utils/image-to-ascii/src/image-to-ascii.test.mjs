import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { glyphFor, glyphsFor, loadImage, toAscii } from './convert.mjs';
import {
  EASINGS,
  frameCount,
  parseTrack,
  trackFromJson,
  valueAt,
} from './keyframes.mjs';

test('a track parses, sorts, and rejects bad input', () => {
  assert.deepEqual(parseTrack('20:250,0:100'), [
    [0, 100],
    [20, 250],
  ]);
  assert.throws(() => parseTrack('0:100,0:200'), /two keyframes/);
  assert.throws(() => parseTrack('x:1'), /bad keyframe/);
  assert.deepEqual(trackFromJson({ 40: 80, 0: 100 }), [
    [0, 100],
    [40, 80],
  ]);
});

test('values hold outside the keyframes and interpolate between them', () => {
  const track = parseTrack('10:100,20:200,40:0');
  assert.equal(valueAt(track, 0), 100);
  assert.equal(valueAt(track, 15), 150);
  assert.equal(valueAt(track, 30), 100);
  assert.equal(valueAt(track, 99), 0);
  assert.equal(valueAt(track, 15, EASINGS.smooth), 150);
  assert.ok(valueAt(track, 12, EASINGS.smooth) < valueAt(track, 12));
});

test('the frame count reaches the last keyframe of any track', () => {
  assert.equal(
    frameCount({ a: parseTrack('0:1,80:2'), b: parseTrack('0:1,50:2') }),
    81,
  );
});

test('the darkest pixel gets the first glyph, and reverse flips it', () => {
  const glyphs = glyphsFor({ charset: 'minimalist', spaceDensity: 1 });
  assert.deepEqual(glyphs, ['#', '+', '-', '.', ' ']);
  assert.equal(glyphFor(glyphs, 0), '#');
  assert.equal(glyphFor(glyphs, 255), ' ');
  const flipped = glyphsFor({
    charset: 'minimalist',
    spaceDensity: 1,
    reverse: true,
  });
  assert.equal(glyphFor(flipped, 0), ' ');
});

test('an image converts to the expected shape', async () => {
  // Left half black, right half white, 200x100.
  const raw = Buffer.alloc(200 * 100 * 3);
  for (let y = 0; y < 100; y++) {
    for (let x = 100; x < 200; x++)
      raw.fill(255, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
  }
  const png = await sharp(raw, {
    raw: { width: 200, height: 100, channels: 3 },
  })
    .png()
    .toBuffer();
  const ascii = await toAscii(await loadImage(png), {
    width: 20,
    charset: 'minimalist',
  });
  const lines = ascii.split('\n');
  // Rows: floor(0.55 * floor(20 / 2)) = 5.
  assert.equal(lines.length, 5);
  assert.ok(lines.every((l) => l.length === 20));
  assert.ok(lines.every((l) => l.startsWith('#####') && l.endsWith('     ')));
});

test('text layers land on their anchors, and only in their frames', async () => {
  const { stampLayers } = await import('./text.mjs');
  const blank = Array.from({ length: 5 }, () => '.'.repeat(20)).join('\n');
  const layers = [
    { text: '{hostname}', anchor: 'bottom-left' },
    { text: 'up {uptime}', anchor: 'bottom-right' },
    { text: 'hi', anchor: 'center', from: 3, to: 4 },
  ];
  const vars = { hostname: 'asus', uptime: '2h 5m' };
  const f0 = stampLayers(blank, layers, 0, vars).split('\n');
  assert.equal(f0[4], `asus${'.'.repeat(8)}up 2h 5m`);
  assert.ok(f0[4].startsWith('asus'));
  assert.ok(f0[4].endsWith('up 2h 5m'));
  assert.equal(f0[2], '.'.repeat(20));
  const f3 = stampLayers(blank, layers, 3, vars).split('\n');
  assert.equal(f3[2], `${'.'.repeat(9)}hi${'.'.repeat(9)}`);
  assert.equal(
    stampLayers(blank, layers, 5, vars).split('\n')[2],
    '.'.repeat(20),
  );
});

test('uptime reads as days, hours and minutes', async () => {
  const { formatUptime, fillVars } = await import('./text.mjs');
  assert.equal(
    formatUptime(300 * 86400 + 2 * 3600 + 34 * 60 + 9),
    '300d 2h 34m',
  );
  assert.equal(formatUptime(2 * 3600 + 60), '2h 1m');
  assert.equal(formatUptime(59), '0m');
  assert.equal(fillVars('{a} {b}', { a: 1 }), '1 {b}');
});

test('an unknown charset is an error, and chars is literal', () => {
  assert.throws(
    () => glyphsFor({ charset: 'alphabetical', spaceDensity: 0 }),
    /unknown charset/,
  );
  assert.deepEqual(
    glyphsFor({ chars: 'ab', charset: 'nope', spaceDensity: 0 }),
    ['a', 'b'],
  );
});

test('clearFrom blanks the image and keeps the text', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'ascii-'));
  const img = new URL(
    '../../../apps/seanmizen.com/src/components/shader-sean/IMG_4011_crop2.jpeg',
    import.meta.url,
  ).pathname;
  const cli = new URL('./cli.mjs', import.meta.url).pathname;
  execFileSync(
    'node',
    [
      cli,
      img,
      '--width',
      '30',
      '--key',
      'contrast=0:100,2:200',
      '--clear-from',
      '1',
      '--out',
      dir,
    ],
    { stdio: 'ignore' },
  );
  assert.match(readFileSync(join(dir, '0000.txt'), 'utf8'), /[^\s]/);
  assert.equal(readFileSync(join(dir, '0002.txt'), 'utf8').trim(), '');
});

test('margin pads every side', async () => {
  const { addMargin } = await import('./text.mjs');
  assert.equal(addMargin('ab\nc', 1), '    \n ab \n c  \n    ');
  assert.equal(addMargin('ab', 0), 'ab');
});
