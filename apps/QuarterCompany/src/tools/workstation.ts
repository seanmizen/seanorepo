// qc-workstation: files on the seat's company host. See REQ-QC-004.
import { z } from 'zod';
import type { Session } from '../session.ts';
import { labelOf } from '../time.ts';
import { AccessError, allowed, check } from '../users.ts';
import { modeString, type Node, parentOf } from '../vfs.ts';
import { readingMinutes, tool, writingMinutes } from './def.ts';

const FILE_MODE = 0o640;
const DIR_MODE = 0o750;

const sudo = z
  .boolean()
  .optional()
  .describe('Run as root. Only members of the wheel group can use sudo.');
const path = z
  .string()
  .min(1)
  .describe('Absolute path, or a path relative to your home folder.');

const lsLine = (s: Session, name: string, n: Node) =>
  [
    modeString(n),
    n.owner.padEnd(8),
    n.group.padEnd(10),
    String(n.size ?? 0).padStart(7),
    labelOf(n.mtime, s.scenario.calendar).padEnd(16),
    n.kind === 'dir' ? `${name}/` : name,
  ].join(' ');

function need(s: Session, as: string, p: string, access: 'r' | 'w' | 'x') {
  check(s.vfs, s.dir(), s.host, as, p, access);
}

/** Search and write permission on the folder that holds `p`. */
function needParentWrite(s: Session, as: string, p: string) {
  const parent = parentOf(p);
  const n = s.vfs.get(s.host, parent);
  if (!n) throw new AccessError(`${parent}: No such file or directory`);
  if (n.kind !== 'dir') throw new AccessError(`${parent}: Not a directory`);
  check(s.vfs, s.dir(), s.host, as, parent, 'x');
  if (!allowed(s.dir(), as, n, 'w'))
    throw new AccessError(`${parent}: Permission denied`);
}

function existing(s: Session, p: string): Node {
  const n = s.vfs.get(s.host, p);
  if (!n) throw new AccessError(`${p}: No such file or directory`);
  return n;
}

function writeText(s: Session, as: string, p: string, text: string) {
  const cur = s.vfs.get(s.host, p);
  if (cur?.kind === 'dir') throw new AccessError(`${p}: Is a directory`);
  if (cur) need(s, as, p, 'w');
  else needParentWrite(s, as, p);
  const meta = cur
    ? { owner: cur.owner, group: cur.group, mode: cur.mode }
    : {
        owner: as,
        group: as === 'root' ? 'root' : s.dir().primaryGroup(as),
        mode: FILE_MODE,
      };
  s.ops.write(s.seat.id, s.host, p, text, meta);
}

export const WORKSTATION_TOOLS = [
  tool({
    name: 'whoami',
    server: 'workstation',
    description:
      'Show your user name, your groups, your host, the time, and the minutes that you have left in this turn.',
    input: z.object({}),
    minutes: () => 0,
    run: (s) =>
      [
        `user: ${s.user} (${s.seat.id})`,
        `groups: ${s.dir().groupsOf(s.user).join(' ')}`,
        `host: ${s.seat.company.host}`,
        `home: ${s.home}`,
        `time: ${s.clock} (turn ${s.label})`,
        `minutes left: ${s.minutesLeft}`,
      ].join('\n'),
  }),
  tool({
    name: 'ls',
    server: 'workstation',
    description:
      'List a folder. The output shows mode, owner, group, size in bytes, the turn of the last change, and name.',
    input: z.object({ path: path.default('.'), sudo }),
    minutes: () => 1,
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      const n = existing(s, p);
      need(s, as, p, 'r');
      if (n.kind === 'file') return lsLine(s, p, n);
      const kids = s.vfs.children(s.host, p);
      return kids.length
        ? kids.map((k) => lsLine(s, k.name, k.node)).join('\n')
        : '(empty folder)';
    },
  }),
  tool({
    name: 'read_file',
    server: 'workstation',
    description: 'Read a text file.',
    input: z.object({ path, sudo }),
    minutes: (s, a) =>
      readingMinutes(s.vfs.get(s.host, s.resolve(a.path))?.size ?? 0),
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      const n = existing(s, p);
      if (n.kind === 'dir') throw new AccessError(`${p}: Is a directory`);
      need(s, as, p, 'r');
      return s.ops.read(s.host, p) ?? '';
    },
  }),
  tool({
    name: 'write_file',
    server: 'workstation',
    description:
      'Write a text file. If the file exists, this replaces all of its content. A new file gets mode 640, with you as the owner.',
    input: z.object({ path, content: z.string(), sudo }),
    minutes: (_s, a) => writingMinutes(a.content),
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      writeText(s, as, p, a.content);
      return `Wrote ${Buffer.byteLength(a.content)} bytes to ${p}.`;
    },
  }),
  tool({
    name: 'append_file',
    server: 'workstation',
    description:
      'Add text to the end of a file. If the file does not exist, this makes it.',
    input: z.object({ path, content: z.string(), sudo }),
    minutes: (_s, a) => writingMinutes(a.content),
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      const cur = s.vfs.get(s.host, p);
      if (cur) need(s, as, p, 'r');
      writeText(s, as, p, (s.ops.read(s.host, p) ?? '') + a.content);
      return `Added ${Buffer.byteLength(a.content)} bytes to ${p}.`;
    },
  }),
  tool({
    name: 'mkdir',
    server: 'workstation',
    description:
      'Make a folder. A new folder gets mode 750, with you as the owner.',
    input: z.object({ path, sudo }),
    minutes: () => 1,
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      if (s.vfs.exists(s.host, p)) throw new AccessError(`${p}: File exists`);
      needParentWrite(s, as, p);
      s.ops.mkdir(s.seat.id, s.host, p, {
        owner: as,
        group: as === 'root' ? 'root' : s.dir().primaryGroup(as),
        mode: DIR_MODE,
      });
      return `Made folder ${p}.`;
    },
  }),
  tool({
    name: 'mv',
    server: 'workstation',
    description: 'Move or rename a file or a folder.',
    input: z.object({ from: path, to: path, sudo }),
    minutes: () => 1,
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const from = s.resolve(a.from);
      let to = s.resolve(a.to);
      existing(s, from);
      if (s.vfs.get(s.host, to)?.kind === 'dir')
        to = `${to === '/' ? '' : to}/${from.split('/').pop()}`;
      if (s.vfs.exists(s.host, to)) throw new AccessError(`${to}: File exists`);
      needParentWrite(s, as, from);
      needParentWrite(s, as, to);
      s.ops.emit(s.seat.id, { type: 'fs.mv', host: s.host, from, to });
      return `Moved ${from} to ${to}.`;
    },
  }),
  tool({
    name: 'rm',
    server: 'workstation',
    description: 'Remove a file or an empty folder.',
    input: z.object({ path, sudo }),
    minutes: () => 1,
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      const n = existing(s, p);
      if (n.kind === 'dir' && s.vfs.children(s.host, p).length)
        throw new AccessError(`${p}: Directory not empty`);
      needParentWrite(s, as, p);
      s.ops.emit(s.seat.id, { type: 'fs.rm', host: s.host, path: p });
      return `Removed ${p}.`;
    },
  }),
  tool({
    name: 'chmod',
    server: 'workstation',
    description:
      'Change the mode of a file or folder. Give the mode in octal, for example "640". Only the owner or root can do this.',
    input: z.object({ path, mode: z.string().regex(/^[0-7]{3,4}$/), sudo }),
    minutes: () => 1,
    run: (s, a) => {
      const as = s.actingUser(a.sudo);
      const p = s.resolve(a.path);
      const n = existing(s, p);
      check(s.vfs, s.dir(), s.host, as, p);
      if (as !== 'root' && n.owner !== as)
        throw new AccessError(`${p}: Operation not permitted`);
      const mode = Number.parseInt(a.mode, 8);
      s.ops.emit(s.seat.id, { type: 'fs.meta', host: s.host, path: p, mode });
      return `Mode of ${p} is now ${a.mode}.`;
    },
  }),
  tool({
    name: 'end_turn',
    server: 'workstation',
    description:
      'Stop work for this turn. Write a short note for your next turn: you remember nothing else. Set wake to "on_mail" to sleep until new mail comes. Set wake to "next_turn" to work again in the next turn.',
    input: z.object({
      note: z.string().describe('What you did, and what to do next.'),
      wake: z.enum(['next_turn', 'on_mail']).default('next_turn'),
    }),
    minutes: () => 0,
    run: (s, a) => {
      s.endTurn(a.note, a.wake);
      return 'Turn ended.';
    },
  }),
];
