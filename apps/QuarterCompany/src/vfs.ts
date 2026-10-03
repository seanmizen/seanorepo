// The virtual filesystem. It is a fold over `fs.*` journal events and nothing
// else, so playback can rebuild it at any turn. See REQ-QC-001.
import { posix } from 'node:path';
import type { Meta, StateEvent } from './events.ts';

export interface Node extends Meta {
  kind: 'file' | 'dir';
  hash?: string;
  size?: number;
  mtime: number; // turn ord of the last change
}

const key = (host: string, path: string) => `${host}:${path}`;

export function normalize(path: string, cwd = '/'): string {
  const abs = posix.isAbsolute(path) ? path : posix.join(cwd, path);
  const out = posix.normalize(abs);
  return out.length > 1 && out.endsWith('/') ? out.slice(0, -1) : out;
}

export const parentOf = (path: string) =>
  path === '/' ? '/' : posix.dirname(path);

export class Vfs {
  nodes = new Map<string, Node>();
  /** The last version of each removed path. Admins restore from here. */
  graveyard = new Map<string, Node>();

  clone(): Vfs {
    const v = new Vfs();
    v.nodes = new Map(this.nodes);
    v.graveyard = new Map(this.graveyard);
    return v;
  }

  get(host: string, path: string): Node | undefined {
    return this.nodes.get(key(host, path));
  }

  exists(host: string, path: string) {
    return this.nodes.has(key(host, path));
  }

  /** Direct children of a directory, sorted by name. */
  children(host: string, dir: string): { name: string; node: Node }[] {
    const prefix = key(host, dir === '/' ? '/' : `${dir}/`);
    const out: { name: string; node: Node }[] = [];
    for (const [k, node] of this.nodes) {
      if (!k.startsWith(prefix) || k === prefix) continue;
      const rest = k.slice(prefix.length);
      if (rest.length > 0 && !rest.includes('/'))
        out.push({ name: rest, node });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /** Every path on a host, sorted. Used by the projection. */
  entries(host: string): { path: string; node: Node }[] {
    const prefix = `${host}:`;
    const out: { path: string; node: Node }[] = [];
    for (const [k, node] of this.nodes)
      if (k.startsWith(prefix))
        out.push({ path: k.slice(prefix.length), node });
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  hosts(): string[] {
    const set = new Set<string>();
    for (const k of this.nodes.keys()) set.add(k.slice(0, k.indexOf(':')));
    return [...set].sort();
  }

  graveOf(host: string, path: string) {
    return this.graveyard.get(key(host, path));
  }

  /**
   * Apply one event. Returns a reason string when the event cannot apply,
   * for example when another seat removed the path earlier in the same turn.
   */
  apply(e: StateEvent, ord: number): string | undefined {
    switch (e.type) {
      case 'fs.mkdir': {
        if (this.exists(e.host, e.path)) return 'path exists';
        this.nodes.set(key(e.host, e.path), {
          kind: 'dir',
          owner: e.owner,
          group: e.group,
          mode: e.mode,
          mtime: ord,
        });
        return;
      }
      case 'fs.write': {
        const cur = this.get(e.host, e.path);
        if (cur?.kind === 'dir') return 'path is a directory';
        if (!this.exists(e.host, parentOf(e.path)))
          return 'parent directory does not exist';
        this.nodes.set(key(e.host, e.path), {
          kind: 'file',
          hash: e.hash,
          size: e.size,
          owner: e.owner,
          group: e.group,
          mode: e.mode,
          mtime: ord,
        });
        return;
      }
      case 'fs.rm': {
        const cur = this.get(e.host, e.path);
        if (!cur) return 'path does not exist';
        if (cur.kind === 'dir' && this.children(e.host, e.path).length > 0)
          return 'directory is not empty';
        this.graveyard.set(key(e.host, e.path), cur);
        this.nodes.delete(key(e.host, e.path));
        return;
      }
      case 'fs.mv': {
        const cur = this.get(e.host, e.from);
        if (!cur) return 'source does not exist';
        if (this.exists(e.host, e.to)) return 'destination exists';
        if (!this.exists(e.host, parentOf(e.to)))
          return 'destination directory does not exist';
        if (e.to.startsWith(`${e.from}/`))
          return 'cannot move a directory into itself';
        const from = key(e.host, e.from);
        const moved: [string, Node][] = [];
        for (const [k, node] of this.nodes) {
          if (k === from || k.startsWith(`${from}/`)) moved.push([k, node]);
        }
        for (const [k] of moved) this.nodes.delete(k);
        for (const [k, node] of moved) {
          this.nodes.set(
            key(e.host, e.to) + k.slice(from.length),
            k === from ? { ...node, mtime: ord } : node,
          );
        }
        return;
      }
      case 'fs.meta': {
        const cur = this.get(e.host, e.path);
        if (!cur) return 'path does not exist';
        this.nodes.set(key(e.host, e.path), {
          ...cur,
          owner: e.owner ?? cur.owner,
          group: e.group ?? cur.group,
          mode: e.mode ?? cur.mode,
          mtime: ord,
        });
        return;
      }
      default:
        return;
    }
  }
}

export const modeString = (node: Node) => {
  const bits = 'rwxrwxrwx';
  let s = node.kind === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += node.mode & (1 << (8 - i)) ? bits[i] : '-';
  return s;
};
