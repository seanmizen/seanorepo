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

/** Parsed directories by file hashes. A provider host has thousands of accounts. */
const loaded = new Map<string, Directory>();

export class Directory {
  private index?: Map<string, Account>;
  private indexed = -1;

  constructor(
    readonly accounts: Account[],
    readonly groups: Group[],
  ) {}

  /**
   * Accounts on a host. The result is shared between callers by file hash,
   * so a caller must copy it before a change.
   */
  static load(vfs: Vfs, objects: ObjectStore, host: string): Directory {
    const passwd = vfs.get(host, '/etc/passwd')?.hash;
    const group = vfs.get(host, '/etc/group')?.hash;
    const cacheKey = `${passwd}:${group}`;
    const hit = loaded.get(cacheKey);
    if (hit) return hit;
    const dir = new Directory(
      parsePasswd(passwd ? objects.get(passwd) : ''),
      parseGroup(group ? objects.get(group) : ''),
    );
    if (loaded.size > 256) loaded.clear();
    loaded.set(cacheKey, dir);
    return dir;
  }

  account(name: string) {
    if (!this.index || this.indexed !== this.accounts.length) {
      this.index = new Map(this.accounts.map((a) => [a.name, a]));
      this.indexed = this.accounts.length;
    }
    return this.index.get(name);
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
