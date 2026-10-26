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

describe('meters', () => {
  const song = (body: string) => parseSong(`title: x\nkey: C\n${body}`);
  const steps = (s: ReturnType<typeof parseSong>) =>
    s.bars.map((b) => b.meter.steps);
  const pos = (s: ReturnType<typeof parseSong>, i: number) =>
    s.bars[i].changes.map((c) => c.pos);

  test('a song with no time setting is 4/4, as before', () => {
    const s = parseSong(GOOD);
    expect(s.meta.time.text).toBe('4/4');
    expect(steps(s)).toEqual([8, 8, 8]);
    expect(s.sections[0].meter.text).toBe('4/4');
  });

  test('each bar has the length of its meter', () => {
    expect(steps(song('time: 2/4\n[A]\nC'))).toEqual([4]);
    expect(steps(song('time: 3/4\n[A]\nC'))).toEqual([6]);
    expect(steps(song('time: 5/4\n[A]\nC'))).toEqual([10]);
    expect(steps(song('time: 7/4\n[A]\nC'))).toEqual([14]);
    expect(steps(song('time: 6/8\n[A]\nC'))).toEqual([6]);
    expect(steps(song('time: 9/8\n[A]\nC'))).toEqual([9]);
    expect(steps(song('time: 12/8\n[A]\nC'))).toEqual([12]);
  });

  test('a section changes the meter until the next change', () => {
    const s = song(
      'time: 3/4\n[Verse]\nA | D\n[Chorus 4/4]\nG | C\n[Solo]\nG\n[Verse 2 3/4]\nA',
    );
    expect(s.errors).toEqual([]);
    expect(s.sections.map((x) => x.name)).toEqual([
      'Verse',
      'Chorus',
      'Solo',
      'Verse 2',
    ]);
    expect(s.sections.map((x) => x.meter.text)).toEqual([
      '3/4',
      '4/4',
      '4/4',
      '3/4',
    ]);
    expect(steps(s)).toEqual([6, 6, 8, 8, 8, 6]);
  });

  test('a section name can end in a number that is not a meter', () => {
    expect(song('[Verse 2]\nC').sections[0].name).toBe('Verse 2');
  });

  test('the chords spread over the beats of the meter', () => {
    const s = song('time: 3/4\n[A]\nC G | C F G');
    expect(pos(s, 0)).toEqual([0, 4]);
    expect(pos(s, 1)).toEqual([0, 2, 4]);
    // In 6/8 two chords land on the two groups of three: beats 1 and 4.
    const c = song('time: 6/8\n[A]\nC G | C F G | C@4 G@6');
    expect(pos(c, 0)).toEqual([0, 3]);
    expect(pos(c, 1)).toEqual([0, 2, 4]);
    expect(pos(c, 2)).toEqual([3, 5]);
    expect(pos(song('time: 12/8\n[A]\nC G'), 0)).toEqual([0, 6]);
  });

  test('Chord@beat works in each meter', () => {
    expect(pos(song('time: 3/4\n[A]\nC G@3.5'), 0)).toEqual([0, 5]);
    expect(pos(song('time: 7/4\n[A]\nC G@7'), 0)).toEqual([0, 12]);
    expect(song('time: 3/4\n[A]\nC G@4').errors[0]).toContain(
      'from 1 to 3.5 in 3/4',
    );
    expect(song('time: 6/8\n[A]\nC G@7').errors[0]).toContain(
      'from 1 to 6 in 6/8',
    );
  });

  test('a bar holds at most one chord on each step', () => {
    expect(song('time: 2/4\n[A]\nC D E F G').errors[0]).toContain(
      'at most 4 chords',
    );
  });

  test('refuses an unknown meter', () => {
    expect(song('time: 11/8\n[A]\nC').errors[0]).toContain(
      '"11/8" is not a meter',
    );
    expect(song('time: waltz\n[A]\nC').errors[0]).toContain(
      '"waltz" is not a meter',
    );
    expect(song('[Chorus 4/3]\nC').errors[0]).toContain('"4/3" is not a meter');
  });
});
