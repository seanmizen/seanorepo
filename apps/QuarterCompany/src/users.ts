// Accounts and permissions. The truth is `/etc/passwd` and `/etc/group` on
// each host, so the IT administrator manages users by changing real files.
// See REQ-QC-004.
import type { ObjectStore } from './objects.ts';
import { type Node, normalize, parentOf, type Vfs } from './vfs.ts';

export interface Account {
  name: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
}

export interface Group {
  name: string;
  gid: number;
  members: string[];
}

export const NOLOGIN = '/sbin/nologin';
export const ADMIN_GROUP = 'wheel';

export const parsePasswd = (text: string): Account[] =>
  text
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [name, , uid, gid, gecos, home, shell] = l.split(':');
      return { name, uid: Number(uid), gid: Number(gid), gecos, home, shell };
    });

export const parseGroup = (text: string): Group[] =>
  text
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [name, , gid, members] = l.split(':');
      return {
        name,
        gid: Number(gid),
        members: members ? members.split(',').filter(Boolean) : [],
      };
    });

export const formatPasswd = (accounts: Account[]) =>
  `${accounts.map((a) => [a.name, 'x', a.uid, a.gid, a.gecos, a.home, a.shell].join(':')).join('\n')}\n`;

export const formatGroup = (groups: Group[]) =>
  `${groups.map((g) => [g.name, 'x', g.gid, g.members.join(',')].join(':')).join('\n')}\n`;

export class Directory {
  constructor(
    readonly accounts: Account[],
    readonly groups: Group[],
  ) {}

  static load(vfs: Vfs, objects: ObjectStore, host: string): Directory {
    const read = (path: string) => {
      const n = vfs.get(host, path);
      return n?.hash ? objects.get(n.hash) : '';
    };
    return new Directory(
      parsePasswd(read('/etc/passwd')),
      parseGroup(read('/etc/group')),
    );
  }

  account(name: string) {
    return this.accounts.find((a) => a.name === name);
  }

  group(name: string) {
    return this.groups.find((g) => g.name === name);
  }

  canLogin(name: string) {
    const a = this.account(name);
    return !!a && a.shell !== NOLOGIN;
  }

  primaryGroup(name: string): string {
    const a = this.account(name);
    return this.groups.find((g) => g.gid === a?.gid)?.name ?? name;
  }

  groupsOf(name: string): string[] {
    const set = new Set([this.primaryGroup(name)]);
    for (const g of this.groups) if (g.members.includes(name)) set.add(g.name);
    return [...set].sort();
  }

  isAdmin(name: string) {
    return name === 'root' || this.groupsOf(name).includes(ADMIN_GROUP);
  }
}

export type Access = 'r' | 'w' | 'x';
const SHIFT: Record<Access, number> = { r: 2, w: 1, x: 0 };

export function allowed(
  dir: Directory,
  user: string,
  node: Node,
  access: Access,
): boolean {
  if (user === 'root') return true;
  const bit = 1 << SHIFT[access];
  if (node.owner === user) return (node.mode & (bit << 6)) !== 0;
  if (dir.groupsOf(user).includes(node.group))
    return (node.mode & (bit << 3)) !== 0;
  return (node.mode & bit) !== 0;
}

export class AccessError extends Error {}

/**
 * Check that `user` can reach `path` (search permission on every ancestor)
 * and has `access` on the path itself, if it exists.
 */
export function check(
  vfs: Vfs,
  dir: Directory,
  host: string,
  user: string,
  path: string,
  access?: Access,
) {
  const p = normalize(path);
  const chain: string[] = [];
  for (let cur = parentOf(p); ; cur = parentOf(cur)) {
    chain.unshift(cur);
    if (cur === '/') break;
  }
  for (const ancestor of chain) {
    const n = vfs.get(host, ancestor);
    if (!n) throw new AccessError(`${ancestor}: No such file or directory`);
    if (!allowed(dir, user, n, 'x'))
      throw new AccessError(`${ancestor}: Permission denied`);
  }
  if (!access) return;
  const n = vfs.get(host, p);
  if (n && !allowed(dir, user, n, access))
    throw new AccessError(`${p}: Permission denied`);
}
