// Where: apps/autosam/public/song-format.js
// When: the page (app.js) imports it in the browser. The server
// (server/store.ts) imports the same file.
// Why: one parser for the song file. The server refuses a file that this
// parser refuses, so the page can play every song that the server keeps.
//
// A song file is plain text. The settings come first, one "name: value" on
// each line. The chord chart follows:
//
//   title: Somewhere Only We Know
//   artist: Keane
//   key: A
//   tempo: 86
//   suggest: -2, -4
//
//   [Intro]
//   A | A/G# Asus4/G# A/G# | Bm7 | Esus4 E Esus4
//
// Settings:
//   title    required. At most 120 characters.
//   artist   optional.
//   slug     optional. The address of the song: /<slug>. Without it, the
//            slug comes from the title (slugify).
//   key      required. A note and an optional "m": A, Bb, F#m.
//   tempo    optional. Beats a minute, 30 to 240. The default is 90.
//   suggest  optional. At most two transpositions in semitones: -2, -4.
//   notes    optional. One line of text under the chart.
//
// The chart: "[Name]" starts a section. "|" divides bars. Each bar is 4/4.
// Two chords in a bar land on beats 1 and 3. Three land on 1, 2&, 4. Four
// get one beat each. "Chord@beat" puts a chord on a given beat.

export const LIMITS = {
  textChars: 32000,
  bars: 1000,
  titleChars: 120,
  notesChars: 600,
  slugChars: 80,
  suggestions: 2,
  maxShift: 24,
  minTempo: 30,
  maxTempo: 240,
};

/**
 * @typedef {{root: number, minor: boolean}} Key
 * @typedef {{sym: string, root: number, q: string, iv: number[], bass: number | null}} Chord
 * @typedef {{pos: number, chord: Chord}} Change
 * @typedef {{sec: number, changes: Change[], startChord: Chord | null}} Bar
 * @typedef {{name: string, start: number, end: number}} Section
 * @typedef {{title: string, artist: string, slug: string, key: Key | null, keyText: string, tempo: number, suggest: number[], notes: string}} Meta
 * @typedef {{meta: Meta, slug: string, sections: Section[], bars: Bar[], errors: string[]}} Song
 */

export const DEFAULT_TEMPO = 90;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// These names are routes or files of the site, so no song can use them.
export const RESERVED_SLUGS = new Set([
  'api',
  'app',
  'archive',
  'favicon',
  'index',
  'new',
  'song-format',
]);
export const SETTINGS = [
  'title',
  'artist',
  'slug',
  'key',
  'tempo',
  'suggest',
  'notes',
];

export const QUALITIES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 2, 4, 7],
  madd9: [0, 2, 3, 7],
  '6add9': [0, 2, 4, 7, 9],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  sus2: [0, 2, 7],
  '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  5: [0, 7],
};

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_POS = { 1: [0], 2: [0, 4], 3: [0, 3, 6], 4: [0, 2, 4, 6] };
const SETTING_RE = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/;

const mod = (n) => ((n % 12) + 12) % 12;
const accidental = (a) =>
  a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0;

/** Make a safe address from a title: "Café & Bar!" -> "cafe-and-bar". */
export function slugify(title) {
  const slug = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slugChars)
    .replace(/-+$/, '');
  return slug || 'song';
}

/** "A" -> {root: 9, minor: false}. "F#m" -> {root: 6, minor: true}. */
export function parseKey(text) {
  const m = /^([A-G])([#b♯♭]?)(m?)$/.exec(text);
  if (!m) return null;
  return { root: mod(LETTER[m[1]] + accidental(m[2])), minor: m[3] === 'm' };
}

export function parseChord(token) {
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(token);
  if (!m || !Object.hasOwn(QUALITIES, m[3])) return null;
  return {
    sym: token,
    root: mod(LETTER[m[1]] + accidental(m[2])),
    q: m[3],
    iv: QUALITIES[m[3]],
    bass: m[4] ? mod(LETTER[m[4]] + accidental(m[5])) : null,
  };
}

function readSetting(meta, name, value, at, errors) {
  switch (name) {
    case 'title':
      if (!value) errors.push(`${at}: the title is empty.`);
      else if (value.length > LIMITS.titleChars)
        errors.push(
          `${at}: the title is too long. The limit is ${LIMITS.titleChars} characters.`,
        );
      meta.title = value;
      return;
    case 'artist':
      if (value.length > LIMITS.titleChars)
        errors.push(
          `${at}: the artist is too long. The limit is ${LIMITS.titleChars} characters.`,
        );
      meta.artist = value;
      return;
    case 'slug':
      if (!value) return;
      if (value.length > LIMITS.slugChars || !SLUG_RE.test(value))
        errors.push(
          `${at}: the slug can use a-z, 0-9 and single hyphens, for example "my-song".`,
        );
      meta.slug = value;
      return;
    case 'key': {
      const key = parseKey(value);
      if (!key)
        errors.push(
          `${at}: "${value}" is not a key. Write a note and an optional m, for example A, Bb or F#m.`,
        );
      meta.key = key;
      meta.keyText = value;
      return;
    }
    case 'tempo': {
      const bpm = /^\d{1,3}$/.test(value) ? Number(value) : Number.NaN;
      if (!(bpm >= LIMITS.minTempo && bpm <= LIMITS.maxTempo))
        errors.push(
          `${at}: the tempo must be a whole number from ${LIMITS.minTempo} to ${LIMITS.maxTempo}.`,
        );
      else meta.tempo = bpm;
      return;
    }
    case 'suggest': {
      const parts = value.split(/[\s,]+/).filter(Boolean);
      if (parts.length > LIMITS.suggestions) {
        errors.push(
          `${at}: give at most ${LIMITS.suggestions} suggested transpositions.`,
        );
        return;
      }
      for (const p of parts) {
        const n = /^[+−-]?\d{1,2}$/.test(p)
          ? Number(p.replace('−', '-'))
          : Number.NaN;
        if (!Number.isInteger(n) || n === 0 || Math.abs(n) > LIMITS.maxShift) {
          errors.push(
            `${at}: "${p}" is not a transposition. Use semitones from -${LIMITS.maxShift} to ${LIMITS.maxShift}, not 0.`,
          );
          return;
        }
        if (meta.suggest.includes(n)) {
          errors.push(`${at}: "${p}" is in the list two times.`);
          return;
        }
        meta.suggest.push(n);
      }
      return;
    }
    case 'notes':
      if (value.length > LIMITS.notesChars)
        errors.push(
          `${at}: the notes are too long. The limit is ${LIMITS.notesChars} characters.`,
        );
      meta.notes = value;
      return;
    default:
      errors.push(
        `${at}: "${name}" is not a setting. The settings are: ${SETTINGS.join(', ')}.`,
      );
  }
}

function readBar(barStr, at, errors) {
  const toks = barStr.split(/\s+/);
  if (toks.length > 8) {
    errors.push(`${at}: a bar can hold at most 8 chords.`);
    return null;
  }
  const base =
    DEFAULT_POS[toks.length] ||
    toks.map((_, i) => Math.round((i * 8) / toks.length));
  const changes = [];
  toks.forEach((t, i) => {
    const [name, beat] = t.split('@');
    const chord = parseChord(name);
    if (!chord) {
      errors.push(`${at}: "${name}" is not a chord that autosam can read.`);
      return;
    }
    let pos = base[i];
    if (beat !== undefined) {
      const b = Number.parseFloat(beat);
      if (!(b >= 1 && b < 5)) {
        errors.push(`${at}: "@${beat}" needs a beat from 1 to 4.5.`);
        return;
      }
      pos = Math.round((b - 1) * 2);
    }
    changes.push({ pos, chord });
  });
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].pos <= changes[i - 1].pos) {
      errors.push(
        `${at}: two chords in "${barStr}" land on the same beat. Give the later one a later @beat.`,
      );
      break;
    }
  }
  return changes;
}

/**
 * Parse a song file. The song is good only when errors is empty.
 * @param {unknown} text
 * @returns {Song}
 */
export function parseSong(text) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Meta} */
  const meta = {
    title: '',
    artist: '',
    slug: '',
    key: null,
    keyText: '',
    tempo: DEFAULT_TEMPO,
    suggest: [],
    notes: '',
  };
  /** @type {Section[]} */
  const sections = [];
  /** @type {Bar[]} */
  const bars = [];
  /** @type {Song} */
  const result = { meta, slug: '', sections, bars, errors };
  if (typeof text !== 'string') {
    errors.push('The song must be text.');
    return result;
  }
  if (text.length > LIMITS.textChars) {
    errors.push(
      `The song is too long: ${text.length} characters. The limit is ${LIMITS.textChars}.`,
    );
    return result;
  }

  const seen = new Set();
  let inSettings = true;
  let pendingName = 'Song';
  const lines = text.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    const at = `Line ${li + 1}`;
    if (!line) continue;
    const setting = SETTING_RE.exec(line);
    if (setting) {
      const name = setting[1].trim().toLowerCase();
      if (!inSettings) {
        errors.push(
          `${at}: put settings such as "${name}:" at the top, before the chart.`,
        );
        continue;
      }
      if (seen.has(name)) {
        errors.push(`${at}: "${name}" is set two times.`);
        continue;
      }
      seen.add(name);
      readSetting(meta, name, setting[2].trim(), at, errors);
      continue;
    }
    inSettings = false;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      pendingName = head[1].trim().slice(0, LIMITS.titleChars);
      continue;
    }
    for (const barStr of line
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (bars.length >= LIMITS.bars) {
        errors.push(
          `${at}: the chart is too long. The limit is ${LIMITS.bars} bars.`,
        );
        break;
      }
      const changes = readBar(barStr, at, errors);
      if (!changes) continue;
      if (pendingName !== null) {
        sections.push({
          name: pendingName,
          start: bars.length,
          end: bars.length,
        });
        pendingName = null;
      }
      bars.push({ sec: sections.length - 1, changes, startChord: null });
      sections[sections.length - 1].end = bars.length - 1;
    }
  }

  if (!seen.has('title'))
    errors.push('The song needs a title, for example "title: My Song".');
  if (!seen.has('key'))
    errors.push('The song needs a key, for example "key: A".');
  if (!bars.length) errors.push('The chart has no bars yet.');

  result.slug = meta.slug || slugify(meta.title);
  if (RESERVED_SLUGS.has(result.slug))
    errors.push(
      `The address /${result.slug} belongs to the site. Add a different "slug:" setting.`,
    );

  // The chord that sounds at beat 1 of each bar. A bar can start in the
  // middle of the chord of the bar before.
  let carry = null;
  for (const b of bars) {
    b.startChord =
      b.changes[0] && b.changes[0].pos === 0 ? b.changes[0].chord : carry;
    if (b.changes.length) carry = b.changes[b.changes.length - 1].chord;
  }
  return result;
}
