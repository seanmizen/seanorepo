import { describe, expect, test } from 'bun:test';
import { parseSong, slugify } from '../public/song-format.js';

const GOOD = `title: Test Song
artist: Someone
key: Bb
tempo: 100
suggest: -2, +3

[Verse]
Bb | F/A Gm7 | Eb6 F@4
`;

describe('slugify', () => {
  test('makes a safe address', () => {
    expect(slugify('Somewhere Only We Know')).toBe('somewhere-only-we-know');
    expect(slugify('Café & Bar!')).toBe('cafe-and-bar');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('   ')).toBe('song');
    expect(slugify('x'.repeat(200)).length).toBe(80);
  });
});

describe('parseSong', () => {
  test('reads the settings and the chart', () => {
    const s = parseSong(GOOD);
    expect(s.errors).toEqual([]);
    expect(s.slug).toBe('test-song');
    expect(s.meta.key).toEqual({ root: 10, minor: false });
    expect(s.meta.tempo).toBe(100);
    expect(s.meta.suggest).toEqual([-2, 3]);
    expect(s.bars.length).toBe(3);
    expect(s.bars[1].changes.map((c) => c.pos)).toEqual([0, 4]);
    expect(s.bars[2].changes.map((c) => c.pos)).toEqual([0, 6]);
  });

  test('a slug setting wins over the title', () => {
    expect(parseSong(`slug: my-tune\n${GOOD}`).slug).toBe('my-tune');
  });

  test('refuses bad settings', () => {
    const errors = parseSong(
      'title: x\nkey: H\ntempo: 9000\nsuggest: 0\nslug: Not OK\ncolour: red\n[A]\nC',
    ).errors.join('\n');
    expect(errors).toContain('"H" is not a key');
    expect(errors).toContain('tempo must be');
    expect(errors).toContain('"0" is not a transposition');
    expect(errors).toContain('slug can use');
    expect(errors).toContain('"colour" is not a setting');
  });

  test('refuses more than two suggestions, and a repeat', () => {
    expect(
      parseSong('title: x\nkey: C\nsuggest: -1 -2 -3\n[A]\nC').errors[0],
    ).toContain('at most 2');
    expect(
      parseSong('title: x\nkey: C\nsuggest: -2, -2\n[A]\nC').errors[0],
    ).toContain('two times');
  });

  test('needs a title, a key and bars', () => {
    const errors = parseSong('artist: x').errors.join('\n');
    expect(errors).toContain('needs a title');
    expect(errors).toContain('needs a key');
    expect(errors).toContain('no bars');
  });

  test('refuses a setting after the chart, and an unknown chord', () => {
    const errors = parseSong(
      'title: x\nkey: C\n[A]\nC | Q7\ntempo: 80',
    ).errors.join('\n');
    expect(errors).toContain('"Q7" is not a chord');
    expect(errors).toContain('at the top');
  });

  test('refuses a site address', () => {
    expect(parseSong('title: API\nkey: C\n[A]\nC').errors.join()).toContain(
      'belongs to the site',
    );
  });

  test('refuses a very long file', () => {
    expect(parseSong('x'.repeat(40000)).errors[0]).toContain('too long');
  });

  test('carries a chord into a bar that starts with no chord', () => {
    const s = parseSong('title: x\nkey: C\n[A]\nC | G@3');
    expect(s.bars[1].startChord?.sym).toBe('C');
  });
});
