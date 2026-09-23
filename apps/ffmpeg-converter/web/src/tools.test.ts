// Checks on the tool list. Run: yarn workspace ffmpeg-converter-next test

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { TOOLS, toolsForFile } from './tools';

const goOps = new Set(
  [
    ...readFileSync(join(__dirname, '../../ops.go'), 'utf8').matchAll(
      /Name: "(\w+)"/g,
    ),
  ].map((m) => m[1]),
);

test('every slug is unique and URL-safe', () => {
  const slugs = TOOLS.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('every tool uses an op that the Go service has', () => {
  for (const t of TOOLS) assert.ok(goOps.has(t.op), `${t.slug}: ${t.op}`);
});

test('every related link goes to a real page', () => {
  const slugs = new Set(TOOLS.map((t) => t.slug));
  for (const t of TOOLS) {
    for (const r of t.related) assert.ok(slugs.has(r), `${t.slug} → ${r}`);
  }
});

test('no page text names ffmpeg flags', () => {
  for (const t of TOOLS) {
    const text = [t.lede, ...t.faqs.flatMap((f) => [f.q, f.a])].join(' ');
    assert.doesNotMatch(text, /-crf|-preset|libx26|-vf|ffmpeg -i/, t.slug);
  }
});

test('a MOV file offers MP4 first and never MOV to MOV', () => {
  const tools = toolsForFile({ name: 'IMG_0001.MOV', type: 'video/quicktime' });
  assert.equal(tools[0].slug, 'mov-to-mp4');
  assert.ok(!tools.some((t) => t.outputExt === 'mov' && !t.suffix));
  assert.ok(tools.some((t) => t.slug === 'compress-video'));
});

test('a named tool hides its general twin', () => {
  const slugs = toolsForFile({ name: 'a.mp4', type: '' }).map((t) => t.slug);
  assert.ok(slugs.includes('mp4-to-mp3'));
  assert.ok(!slugs.includes('video-to-mp3'));
});

test('an unknown file gets no tools', () => {
  assert.deepEqual(
    toolsForFile({ name: 'notes.pdf', type: 'application/pdf' }),
    [],
  );
});
