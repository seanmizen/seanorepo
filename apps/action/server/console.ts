// Where: apps/action/server/console.ts
// When: server/index.ts imports it at start. server/console.test.ts tests it.
// Why: the server half of the console framework (game/src/console/). It has
// the same command grammar (game/src/console/parse.zig, with the shared
// cases in parse_cases.json), the same cvar types, limits and text forms
// (cvar.zig), and it reads the server cvars from
// game/src/server_cvars.json: the one definition that the client embeds.
//
// The server cvars come from, in order: the defaults, the server config
// file (a script, one command a line), the SV_<NAME> environment variables
// (SV_MATCH_SECONDS sets match_seconds), and rcon at run time. An empty
// environment variable counts as unset.

import { existsSync, readFileSync } from 'node:fs';

export type CvarType = 'bool' | 'int' | 'float' | 'string';
export type CvarValue = boolean | number | string;
export type CvarFlag = 'saved' | 'server' | 'cheat' | 'read_only' | 'protected';

export interface CvarDef {
  name: string;
  type: CvarType;
  default: CvarValue;
  min?: number;
  max?: number;
  flags: CvarFlag[];
  description: string;
  reader: string;
}

/** The longest string value, in UTF-8 bytes (cvar.zig max_string). */
export const MAX_STRING = 200;
/** Tokens of one command after this many are dropped (parse.zig). */
const MAX_TOKENS = 32;

// ---- The grammar (parse.zig) ------------------------------------------------

export interface ScriptCommand {
  text: string;
  /** The line number, from 1. */
  line: number;
}

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\r';

function trimSpace(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isSpace(s[a])) a++;
  while (b > a && isSpace(s[b - 1])) b--;
  return s.slice(a, b);
}

/** Split a script into commands: lines, ";" outside quotes, and "//"
 * comments outside quotes. Empty commands are skipped. */
export function splitCommands(src: string): ScriptCommand[] {
  const out: ScriptCommand[] = [];
  let pos = 0;
  let line = 1;
  while (pos < src.length) {
    const start = pos;
    const cmdLine = line;
    let end = src.length;
    let next = src.length;
    let quoted = false;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === '\n') {
        end = i;
        next = i + 1;
        line++;
        break;
      }
      if (c === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (c === ';') {
        end = i;
        next = i + 1;
        break;
      }
      if (c === '/' && src[i + 1] === '/') {
        end = i;
        const nl = src.indexOf('\n', i);
        if (nl >= 0) {
          next = nl + 1;
          line++;
        }
        break;
      }
    }
    pos = next;
    const text = trimSpace(src.slice(start, end));
    if (text) out.push({ text, line: cmdLine });
  }
  return out;
}

/** The tokens of one command. A token in double quotes can hold spaces. */
export function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cmd.length && out.length < MAX_TOKENS) {
    const c = cmd[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const s = i + 1;
      let e = cmd.indexOf('"', s);
      if (e < 0) e = cmd.length;
      out.push(cmd.slice(s, e));
      i = e + 1;
    } else {
      let e = i;
      while (e < cmd.length && !isSpace(cmd[e]) && cmd[e] !== '"') e++;
      out.push(cmd.slice(i, e));
      i = e;
    }
  }
  return out;
}

// ---- Values (cvar.zig) ------------------------------------------------------

const YES = ['1', 'true', 'on', 'yes'];
const NO = ['0', 'false', 'off', 'no'];
const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const encoder = new TextEncoder();

export interface Parsed {
  value: CvarValue;
  /** The value was out of the limits and is now at a limit. */
  clamped: boolean;
}

/** Read `text` as a value of the type of `def`, in its limits. Null when
 * the text is not of the type. */
export function parseValue(def: CvarDef, text: string): Parsed | null {
  switch (def.type) {
    case 'bool': {
      const t = text.toLowerCase();
      if (YES.includes(t)) return { value: true, clamped: false };
      if (NO.includes(t)) return { value: false, clamped: false };
      return null;
    }
    case 'int':
      if (!INT_RE.test(text)) return null;
      return checkValue(def, Number.parseInt(text, 10));
    case 'float':
      if (!FLOAT_RE.test(text)) return null;
      return checkValue(def, Number(text));
    case 'string':
      return checkValue(def, text);
  }
}

/** Check a value against the type and the limits of `def`. A number out of
 * the limits is clamped. A long string is cut. */
export function checkValue(def: CvarDef, v: CvarValue): Parsed | null {
  switch (def.type) {
    case 'bool':
      return typeof v === 'boolean' ? { value: v, clamped: false } : null;
    case 'int':
    case 'float': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      if (def.type === 'int' && !Number.isInteger(v)) return null;
      let x = v;
      if (def.min !== undefined)
        x = Math.max(x, def.type === 'int' ? Math.ceil(def.min) : def.min);
      if (def.max !== undefined)
        x = Math.min(x, def.type === 'int' ? Math.floor(def.max) : def.max);
      return { value: x, clamped: x !== v };
    }
    case 'string': {
      if (typeof v !== 'string') return null;
      for (const ch of v) {
        const c = ch.codePointAt(0) ?? 0;
        if (c < 0x20 || c === 0x7f || ch === '"') return null;
      }
      if (encoder.encode(v).length <= MAX_STRING)
        return { value: v, clamped: false };
      // Cut on a code point boundary.
      let out = '';
      let bytes = 0;
      for (const ch of v) {
        const n = encoder.encode(ch).length;
        if (bytes + n > MAX_STRING) break;
        out += ch;
        bytes += n;
      }
      return { value: out, clamped: true };
    }
  }
}

/** The text form of a value: 1 or 0, an int, a float with at most 4
 * decimals, or the string. */
export function formatValue(v: CvarValue): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    const r = Math.round(v * 10000) / 10000;
    return r === 0 ? '0' : String(r);
  }
  return v;
}

// ---- Definitions (schema.zig) -----------------------------------------------

const FLAGS: CvarFlag[] = [
  'saved',
  'server',
  'cheat',
  'read_only',
  'protected',
];
const NAME_RE = /^[a-z0-9_]{1,48}$/;

/** Read and check the definitions of a cvar file. Each one also gets the
 * flags in `add`. Throws on a bad definition. */
export function loadDefs(json: unknown, add: CvarFlag[] = []): CvarDef[] {
  const file = json as { cvars?: unknown };
  if (!file || !Array.isArray(file.cvars)) throw new Error('no "cvars" list');
  return file.cvars.map((raw: Record<string, unknown>) => {
    const name = String(raw.name);
    const bad = (why: string) => new Error(`cvar ${name}: ${why}`);
    if (!NAME_RE.test(name)) throw bad('bad name');
    const type = raw.type as CvarType;
    if (!['bool', 'int', 'float', 'string'].includes(type))
      throw bad('bad type');
    const flags = [...((raw.flags as CvarFlag[] | undefined) ?? []), ...add];
    for (const f of flags) if (!FLAGS.includes(f)) throw bad(`bad flag ${f}`);
    const def: CvarDef = {
      name,
      type,
      default: raw.default as CvarValue,
      min: raw.min as number | undefined,
      max: raw.max as number | undefined,
      flags: [...new Set(flags)],
      description: String(raw.description ?? ''),
      reader: String(raw.reader ?? ''),
    };
    const p = checkValue(def, def.default);
    if (!p || p.clamped)
      throw bad('the default is not of the type or not in the limits');
    if (def.min !== undefined && def.max !== undefined && def.min > def.max)
      throw bad('min is more than max');
    if (def.flags.includes('protected') && type !== 'string')
      throw bad('only a string can be protected');
    if (!def.description || !def.reader)
      throw bad('no description or no reader');
    return def;
  });
}

/** Read a cvar file. The cvars of the server cvar file are server cvars. */
export function readDefs(path: string): CvarDef[] {
  return loadDefs(JSON.parse(readFileSync(path, 'utf8')), ['server']);
}

// ---- The cvars --------------------------------------------------------------

export type SetResult =
  | { ok: true; clamped: boolean; text: string }
  | { ok: false; error: string };

export class Cvars {
  private readonly byName = new Map<string, CvarDef>();
  private readonly values = new Map<string, CvarValue>();
  private readonly listeners: ((def: CvarDef, text: string) => void)[] = [];

  constructor(readonly defs: CvarDef[]) {
    for (const d of defs) {
      this.byName.set(d.name, d);
      this.values.set(d.name, d.default);
    }
  }

  def(name: string): CvarDef | undefined {
    return this.byName.get(name.toLowerCase());
  }

  get(name: string): CvarValue {
    const d = this.def(name);
    if (!d) throw new Error(`no cvar ${name}`);
    return this.values.get(d.name) ?? d.default;
  }

  number(name: string): number {
    const v = this.get(name);
    return typeof v === 'number' ? v : v ? 1 : 0;
  }

  string(name: string): string {
    return String(this.get(name));
  }

  /** The text form. A protected value shows as "(hidden)". */
  text(name: string): string {
    const d = this.def(name);
    if (!d) return '';
    const v = this.get(name);
    if (d.flags.includes('protected')) return v === '' ? '' : '(hidden)';
    return formatValue(v);
  }

  set(name: string, text: string): SetResult {
    const d = this.def(name);
    if (!d) return { ok: false, error: `no cvar "${name}"` };
    const p = parseValue(d, text);
    if (!p)
      return {
        ok: false,
        error: `${d.name}: "${text}" is not ${typeText(d.type)}`,
      };
    this.store(d, p.value);
    return { ok: true, clamped: p.clamped, text: this.text(d.name) };
  }

  reset(name: string): boolean {
    const d = this.def(name);
    if (!d) return false;
    this.store(d, d.default);
    return true;
  }

  private store(d: CvarDef, v: CvarValue): void {
    if (this.values.get(d.name) === v) return;
    this.values.set(d.name, v);
    const text = formatValue(v);
    for (const fn of this.listeners) fn(d, text);
  }

  /** Called on each change with the new text form. */
  onChange(fn: (def: CvarDef, text: string) => void): void {
    this.listeners.push(fn);
  }

  /** [name, value] for each cvar that a client may see (not protected). */
  publicPairs(): [string, string][] {
    return this.defs
      .filter((d) => !d.flags.includes('protected'))
      .map((d) => [d.name, formatValue(this.get(d.name))]);
  }
}

function typeText(t: CvarType): string {
  switch (t) {
    case 'bool':
      return '1 or 0';
    case 'int':
      return 'a whole number';
    case 'float':
      return 'a number';
    case 'string':
      return 'a text with no double quote';
  }
}

// ---- The server commands ----------------------------------------------------

export type Out = (line: string) => void;

export interface ServerCommand {
  name: string;
  args: string;
  description: string;
  run: (args: string[], out: Out) => void;
}

/** The commands of the server: the config file and rcon run them. */
export class ServerConsole {
  private readonly commands: ServerCommand[];
  /** True while a config file runs: a set with no clamp shows nothing. */
  private quiet = false;

  constructor(
    readonly cvars: Cvars,
    extra: ServerCommand[] = [],
  ) {
    this.commands = [
      {
        name: 'help',
        args: '',
        description: 'List the server commands.',
        run: (_a, out) => {
          for (const c of this.commands)
            out(`${c.name} ${c.args} - ${c.description}`);
          out('<cvar> shows a cvar, <cvar> <value> sets it.');
        },
      },
      {
        name: 'cvarlist',
        args: '[text]',
        description:
          'List the server cvars, or the cvars with the text in the name.',
        run: (a, out) => {
          for (const d of this.cvars.defs) {
            if (a[1] && !d.name.includes(a[1].toLowerCase())) continue;
            out(`${d.name} = ${this.cvars.text(d.name)} - ${d.description}`);
          }
        },
      },
      {
        name: 'set',
        args: '<cvar> <value>',
        description: 'Set a server cvar. The players get the new value.',
        run: (a, out) => {
          if (a.length < 3) return out('usage: set <cvar> <value>');
          this.setAndReport(a[1], a[2], out);
        },
      },
      {
        name: 'reset',
        args: '<cvar>',
        description: 'Put a server cvar back to its default.',
        run: (a, out) => {
          if (a.length < 2) return out('usage: reset <cvar>');
          if (!this.cvars.reset(a[1])) return out(`reset: no cvar "${a[1]}"`);
          out(`${a[1]} = ${this.cvars.text(a[1])}`);
        },
      },
      {
        name: 'echo',
        args: '<text>',
        description: 'Show the text.',
        run: (a, out) => out(a.slice(1).join(' ')),
      },
      ...extra,
    ];
  }

  private setAndReport(name: string, text: string, out: Out): void {
    const r = this.cvars.set(name, text);
    if (!r.ok) {
      out(r.error);
      return;
    }
    const d = this.cvars.def(name);
    if (r.clamped)
      out(`${d?.name} = ${r.text} ("${text}" is out of the limits)`);
    else if (!this.quiet) out(`${d?.name} = ${r.text}`);
  }

  /** Run the commands of `src`. `where` names a script for the messages
   * ("server.cfg:3: ..."), and then a set with no clamp shows nothing. */
  exec(src: string, out: Out, where = ''): void {
    this.quiet = where !== '';
    try {
      this.run(src, out, where);
    } finally {
      this.quiet = false;
    }
  }

  private run(src: string, out: Out, where: string): void {
    for (const c of splitCommands(src)) {
      const say: Out = where ? (l) => out(`${where}:${c.line}: ${l}`) : out;
      const args = tokenize(c.text);
      if (args.length === 0) continue;
      const name = args[0].toLowerCase();
      const cmd = this.commands.find((x) => x.name === name);
      if (cmd) {
        cmd.run(args, say);
      } else if (this.cvars.def(name)) {
        if (args.length === 1) {
          const d = this.cvars.def(name);
          say(`${d?.name} = ${this.cvars.text(name)} - ${d?.description}`);
        } else this.setAndReport(name, args[1], say);
      } else say(`unknown command or cvar "${args[0]}". Type: help`);
    }
  }
}

/** Run the server config file, if it exists. Only the errors, the clamps
 * and the echo lines go to `out`. */
export function runConfigFile(
  con: ServerConsole,
  path: string,
  out: Out,
): boolean {
  if (!existsSync(path)) return false;
  con.exec(readFileSync(path, 'utf8'), out, path.split('/').pop() ?? path);
  return true;
}

/** Set each server cvar that has an SV_<NAME> environment variable. An
 * empty variable counts as unset. */
export function applyEnv(
  cvars: Cvars,
  env: Record<string, string | undefined>,
  out: Out,
): void {
  for (const d of cvars.defs) {
    const key = `SV_${d.name.toUpperCase()}`;
    const v = env[key];
    if (v === undefined || v === '') continue;
    const r = cvars.set(d.name, v);
    if (!r.ok) out(`${key}: ${r.error}`);
    else if (r.clamped)
      out(`${key}: "${v}" is out of the limits, ${d.name} = ${r.text}`);
  }
}
