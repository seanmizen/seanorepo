#!/usr/bin/env node
// cli.mjs: image-to-ascii command line. Prints one image, or renders and
// plays an animation made from keyframes.
//
// Run `node src/cli.mjs --help` for the flags.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULTS, loadImage, NUMERIC, toAscii } from './convert.mjs';
import {
  EASINGS,
  frameCount,
  parseTrack,
  trackFromJson,
  valueAt,
} from './keyframes.mjs';
import { checkLayers, machineVars, stampLayers } from './text.mjs';

const HELP = `image-to-ascii IMAGE [flags]

Image settings (the asciiart.eu sliders, with the site's defaults):
  --width 100          --brightness 100     --contrast 100
  --saturation 100     --sepia 0            --hue 0
  --grayscale 0        --invert 0           --spaceDensity 1
  --sharpen            --sharpness 9        (sharpness needs --sharpen)
  --edges              --edgeIntensity 1    (edgeIntensity needs --edges)
  --threshold N        (0-255, off by default)
  --dithering none|FloydSteinberg|JJN|Stucki|Atkinson
  --charset normal|minimalist|normal2|alphabetic|alphanumeric|numerical|
            extended|math|arrow|grayscale|codepage437|blockelement
  --chars STRING       your own characters, darkest first. Overrides --charset.
  --reverse            flip the charset, for a dark terminal

Animation:
  --key name=F:V,F:V,...   keyframes for one numeric setting. Repeat the flag
                           for more settings. Example: --key contrast=0:100,20:250
  --sweep name=A:B         shorthand: from A at frame 0 to B at the last frame
  --frames N               default: the last keyframe plus one
  --ease linear|smooth     default: linear
  --pingpong               play forward, then back
  --clear-from N           blank the image from frame N. Text layers stay.
                           In a spec: "clearFrom": N
  --spec FILE.json         read all of the above from a file. Flags override it.

Text (in a --spec file only):
  "text": [{ "text": "{hostname}", "anchor": "bottom-left", "from": 20, "to": 60 }]
  Anchors: center, top-left, top-right, bottom-left, bottom-right.
  --var name=value         set a variable. {hostname} and {uptime} default to
                           this machine's values.

Output (an animation needs at least one):
  --out DIR                write frames as DIR/0000.txt, DIR/0001.txt, ...
  --play                   play the frames in this terminal
  --fps 30                 playback speed for --play
  --fit                    with --play, shrink the width to fit the terminal.
                           Skip playback if the terminal is too small.
  Any key during --play jumps to the last frame.
`;

const BOOLEAN_FLAGS = new Set([
  'sharpen',
  'edges',
  'reverse',
  'play',
  'pingpong',
  'fit',
  'help',
]);

const parseArgs = (argv) => {
  const args = { options: {}, keys: [], sweeps: [], vars: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.image = token;
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      if (name in DEFAULTS) args.options[name] = true;
      else args[name] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    if (name === 'key') args.keys.push(value);
    else if (name === 'var') {
      const at = value.indexOf('=');
      if (at < 1) throw new Error(`--var needs name=value, got "${value}"`);
      args.vars[value.slice(0, at)] = value.slice(at + 1);
    } else if (name === 'sweep') args.sweeps.push(value);
    else if (['frames', 'fps'].includes(name)) args[name] = Number(value);
    else if (name === 'clear-from') args.clearFrom = Number(value);
    else if (['out', 'ease', 'spec'].includes(name)) args[name] = value;
    else if (name in DEFAULTS || name === 'threshold') {
      args.options[name] = NUMERIC.has(name) ? Number(value) : value;
    } else throw new Error(`unknown flag --${name}. Run with --help.`);
  }
  return args;
};

// A spec file holds the same things as the flags. Paths in it are relative to
// the file.
const readSpec = (file) => {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const base = dirname(resolve(file));
  return {
    image: spec.image ? resolve(base, spec.image) : undefined,
    options: spec.options ?? {},
    tracks: Object.fromEntries(
      Object.entries(spec.keyframes ?? {}).map(([k, v]) => [
        k,
        trackFromJson(v),
      ]),
    ),
    text: spec.text ?? [],
    vars: spec.vars ?? {},
    clearFrom: spec.clearFrom,
    frames: spec.frames,
    fps: spec.fps,
    ease: spec.ease,
    pingpong: spec.pingpong,
    out: spec.out ? resolve(base, spec.out) : undefined,
  };
};

// `yarn ascii` runs from this workspace's folder. Yarn sets INIT_CWD to the
// folder the user ran it from, so paths on the command line resolve there.
const callerDir = process.env.INIT_CWD ?? process.cwd();
const fromCaller = (p) => (p === undefined ? p : resolve(callerDir, p));

// Plays the frames once. Any key jumps to the last frame. The cursor and the
// terminal mode come back however playback ends.
const play = async (frames, fps) => {
  const delay = 1000 / fps;
  const stdin = process.stdin;
  let skip = false;
  const restore = () => {
    process.stdout.write('\x1b[?25h');
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      restore();
      process.exit(130);
    });
  }
  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', () => {
      skip = true;
    });
  }
  process.stdout.write('\x1b[?25l\x1b[2J');
  for (let i = 0; i < frames.length; i++) {
    if (skip) i = frames.length - 1;
    process.stdout.write(`\x1b[H${frames[i]}\n`);
    if (i < frames.length - 1) await new Promise((r) => setTimeout(r, delay));
  }
  restore();
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  args.image = fromCaller(args.image);
  args.spec = fromCaller(args.spec);
  args.out = fromCaller(args.out);
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const spec = args.spec
    ? readSpec(args.spec)
    : { options: {}, tracks: {}, text: [], vars: {} };
  checkLayers(spec.text);
  const vars = { ...machineVars(), ...spec.vars, ...args.vars };

  const image = args.image ?? spec.image;
  if (!image) throw new Error('no image. Pass IMAGE, or "image" in --spec.');
  const options = { ...spec.options, ...args.options };
  const tracks = { ...spec.tracks };
  for (const text of args.keys) {
    const [name, rest] = text.split('=');
    tracks[name] = parseTrack(rest);
  }
  const frames = args.frames ?? spec.frames;
  for (const text of args.sweeps) {
    const [name, range] = text.split('=');
    const [from, to] = range.split(':').map(Number);
    const last = (frames ?? 60) - 1;
    tracks[name] = [
      [0, from],
      [last, to],
    ];
  }
  for (const name of Object.keys(tracks)) {
    if (!NUMERIC.has(name)) {
      throw new Error(
        `"${name}" is not a numeric setting, so it cannot have keyframes`,
      );
    }
  }

  const loaded = await loadImage(image);
  if (args.fit && args.play) {
    if (!process.stdout.isTTY) return;
    // Rows are 0.55 * width / aspect. Keep one row free for the prompt.
    const byRows = Math.floor(
      ((process.stdout.rows - 1) / 0.55) * loaded.aspect,
    );
    const width = Math.min(
      options.width ?? DEFAULTS.width,
      process.stdout.columns,
      byRows,
    );
    if (width < 20) return; // too small to be worth showing
    options.width = width;
  }
  const layered = (ascii, f) => stampLayers(ascii, spec.text, f, vars);
  if (Object.keys(tracks).length === 0 && !args.play) {
    process.stdout.write(`${layered(await toAscii(loaded, options), 0)}\n`);
    return;
  }

  const easeName = args.ease ?? spec.ease ?? 'linear';
  const ease = EASINGS[easeName];
  if (!ease)
    throw new Error(`unknown ease "${easeName}": use linear or smooth`);
  const lastText = Math.max(
    0,
    ...spec.text.map((t) => Math.max(t.from ?? 0, t.to ?? 0) + 1),
  );
  const count =
    frames ??
    Math.max(Object.keys(tracks).length ? frameCount(tracks) : 1, lastText);
  const clearFrom = args.clearFrom ?? spec.clearFrom;
  const rendered = [];
  for (let f = 0; f < count; f++) {
    const frameOptions = { ...options };
    for (const [name, track] of Object.entries(tracks)) {
      frameOptions[name] = valueAt(track, f, ease);
    }
    let ascii = await toAscii(loaded, frameOptions);
    // From clearFrom on, the image is blank and only the text layers show.
    if (clearFrom !== undefined && f >= clearFrom) {
      ascii = ascii.replace(/[^\n]/g, ' ');
    }
    rendered.push(layered(ascii, f));
  }
  if (args.pingpong ?? spec.pingpong) {
    rendered.push(...rendered.slice(1, -1).reverse());
  }

  const out = args.out ?? spec.out;
  if (!out && !args.play) {
    throw new Error('an animation needs --out DIR, --play, or both');
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    rendered.forEach((frame, i) => {
      writeFileSync(
        join(out, `${String(i).padStart(4, '0')}.txt`),
        `${frame}\n`,
      );
    });
    process.stderr.write(`wrote ${rendered.length} frames to ${out}\n`);
  }
  if (args.play) await play(rendered, args.fps ?? spec.fps ?? 30);
};

main().catch((err) => {
  process.stderr.write(`image-to-ascii: ${err.message}\n`);
  process.exit(1);
});
