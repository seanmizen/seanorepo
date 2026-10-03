// qc-admin: user and group management for the wheel group. Every change is
// an edit of /etc/passwd or /etc/group. See REQ-QC-004.
import { z } from 'zod';
import type { Session } from '../session.ts';
import {
  AccessError,
  check,
  Directory,
  formatGroup,
  formatPasswd,
  NOLOGIN,
} from '../users.ts';
import { tool } from './def.ts';
import { ensureMailbox } from './mail.ts';

const username = z
  .string()
  .regex(
    /^[a-z][a-z0-9_-]{0,31}$/,
    'Use lower case letters, digits, "_" and "-".',
  );
const ETC = { owner: 'root', group: 'root', mode: 0o644 };

function requireAdmin(s: Session) {
  if (!s.dir().isAdmin(s.user))
    throw new AccessError('You are not in the wheel group.');
}

function save(s: Session, dir: Directory) {
  s.ops.write(
    s.seat.id,
    s.host,
    '/etc/passwd',
    formatPasswd(dir.accounts),
    ETC,
  );
  s.ops.write(s.seat.id, s.host, '/etc/group', formatGroup(dir.groups), ETC);
}

const copy = (d: Directory) =>
  new Directory(
    d.accounts.map((a) => ({ ...a })),
    d.groups.map((g) => ({ ...g, members: [...g.members] })),
  );

export const ADMIN_TOOLS = [
  tool({
    name: 'useradd',
    server: 'admin',
    description:
      'Make a user account. This adds the user to /etc/passwd, makes a private group, a home folder (mode 700) and a mailbox. The groups must exist.',
    input: z.object({
      username,
      full_name: z.string(),
      groups: z
        .array(z.string())
        .default([])
        .describe('Extra groups, for example ["sales"].'),
    }),
    minutes: () => 3,
    run: (s, a) => {
      requireAdmin(s);
      const d = copy(s.dir());
      if (d.account(a.username))
        throw new AccessError(`useradd: user '${a.username}' already exists`);
      if (d.group(a.username))
        throw new AccessError(`useradd: group '${a.username}' already exists`);
      const missing = a.groups.find((g) => !d.group(g));
      if (missing)
        throw new AccessError(`useradd: group '${missing}' does not exist`);
      const uid =
        Math.max(
          1000,
          ...d.accounts.map((x) => x.uid),
          ...d.groups.map((g) => (g.gid < 2000 ? g.gid : 0)),
        ) + 1;
      const home = `/home/${a.username}`;
      d.accounts.push({
        name: a.username,
        uid,
        gid: uid,
        gecos: a.full_name,
        home,
        shell: '/bin/sh',
      });
      d.groups.push({ name: a.username, gid: uid, members: [] });
      for (const g of a.groups) d.group(g)?.members.push(a.username);
      save(s, d);
      if (!s.vfs.exists(s.host, home))
        s.ops.mkdir(s.seat.id, s.host, home, {
          owner: a.username,
          group: a.username,
          mode: 0o700,
        });
      ensureMailbox(s.ops, s.host, a.username, a.username);
      return `Made user ${a.username} (uid ${uid}) with home ${home}. Groups: ${[a.username, ...a.groups].join(' ')}.`;
    },
  }),
  tool({
    name: 'usermod',
    server: 'admin',
    description:
      'Change a user account. Add or remove groups. Lock the account to stop the user logging in, or unlock it. There is no way to delete an account: lock it.',
    input: z.object({
      username,
      add_groups: z.array(z.string()).default([]),
      remove_groups: z.array(z.string()).default([]),
      lock: z.boolean().optional(),
    }),
    minutes: () => 2,
    run: (s, a) => {
      requireAdmin(s);
      const d = copy(s.dir());
      const acct = d.account(a.username);
      if (!acct)
        throw new AccessError(`usermod: user '${a.username}' does not exist`);
      for (const g of a.add_groups) {
        const grp = d.group(g);
        if (!grp) throw new AccessError(`usermod: group '${g}' does not exist`);
        if (!grp.members.includes(a.username)) grp.members.push(a.username);
      }
      for (const g of a.remove_groups) {
        const grp = d.group(g);
        if (grp) grp.members = grp.members.filter((m) => m !== a.username);
      }
      if (a.lock !== undefined) acct.shell = a.lock ? NOLOGIN : '/bin/sh';
      save(s, d);
      const now = new Directory(d.accounts, d.groups);
      return `User ${a.username}: groups ${now.groupsOf(a.username).join(' ')}; ${acct.shell === NOLOGIN ? 'locked' : 'can log in'}.`;
    },
  }),
  tool({
    name: 'groupadd',
    server: 'admin',
    description: 'Make a group.',
    input: z.object({ name: username }),
    minutes: () => 2,
    run: (s, a) => {
      requireAdmin(s);
      const d = copy(s.dir());
      if (d.group(a.name))
        throw new AccessError(`groupadd: group '${a.name}' already exists`);
      const gid = Math.max(2000, ...d.groups.map((g) => g.gid)) + 1;
      d.groups.push({ name: a.name, gid, members: [] });
      save(s, d);
      return `Made group ${a.name} (gid ${gid}).`;
    },
  }),
  tool({
    name: 'chown',
    server: 'admin',
    description: 'Change the owner or the group of a file or folder.',
    input: z.object({
      path: z.string(),
      owner: z.string().optional(),
      group: z.string().optional(),
    }),
    minutes: () => 1,
    run: (s, a) => {
      requireAdmin(s);
      const p = s.resolve(a.path);
      check(s.vfs, s.dir(), s.host, 'root', p);
      if (!s.vfs.exists(s.host, p))
        throw new AccessError(`${p}: No such file or directory`);
      if (!a.owner && !a.group)
        throw new AccessError('Give an owner, a group, or both.');
      if (a.owner && !s.dir().account(a.owner))
        throw new AccessError(`chown: invalid user: '${a.owner}'`);
      if (a.group && !s.dir().group(a.group))
        throw new AccessError(`chown: invalid group: '${a.group}'`);
      s.ops.emit(s.seat.id, {
        type: 'fs.meta',
        host: s.host,
        path: p,
        owner: a.owner,
        group: a.group,
      });
      const n = s.vfs.get(s.host, p);
      return `${p} is now owned by ${n?.owner}:${n?.group}.`;
    },
  }),
  tool({
    name: 'restore',
    server: 'admin',
    description:
      'Restore a removed file or folder from backup. The path must be free.',
    input: z.object({ path: z.string() }),
    minutes: () => 5,
    run: (s, a) => {
      requireAdmin(s);
      const p = s.resolve(a.path);
      const old = s.vfs.graveOf(s.host, p);
      if (!old) throw new AccessError(`No backup of ${p} exists.`);
      if (s.vfs.exists(s.host, p))
        throw new AccessError(`${p}: File exists. Move it away first.`);
      const meta = { owner: old.owner, group: old.group, mode: old.mode };
      if (old.kind === 'dir') s.ops.mkdir(s.seat.id, s.host, p, meta);
      else
        s.ops.emit(s.seat.id, {
          type: 'fs.write',
          host: s.host,
          path: p,
          hash: old.hash as string,
          size: old.size ?? 0,
          ...meta,
        });
      return `Restored ${p}.`;
    },
  }),
];
