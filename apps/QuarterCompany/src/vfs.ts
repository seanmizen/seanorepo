// The virtual filesystem. It is a fold over `fs.*` journal events and nothing
// else, so playback can rebuild it at any turn. See REQ-QC-001.
//
// A view is copy-on-write (REQ-QC-025). `clone()` gives a layer over this
// view: reads go through to the base, and writes stay in the layer. Each
// layer keeps an index of the names in each folder, so a listing does not
// scan every path in the world. The base must not change while a layer
// over it is in use. The engine merges the layers of a turn only after all
// sessions end.
import { posix } from 'node:path';
import type { Meta, StateEvent } from './events.ts';

export interface Node extends Meta {
  kind: 'file' | 'dir';
  hash?: string;
  size?: number;
  mtime: number; // turn ord of the last change
}

const key = (host: string, path: string) => `${host}:${path}`;
const parentKey = (host: string, path: string) =>
  path === '/' ? undefined : key(host, posix.dirname(path));
const nameOf = (path: string) => posix.basename(path);

export function normalize(path: string, cwd = '/'): string {
  const abs = posix.isAbsolute(path) ? path : posix.join(cwd, path);
  const out = posix.normalize(abs);
  return out.length > 1 && out.endsWith('/') ? out.slice(0, -1) : out;
}

export const parentOf = (path: string) =>
  path === '/' ? '/' : posix.dirname(path);

export class Vfs {
  /** Nodes that this layer sets. Null marks a path that this layer removes. */
  private own = new Map<string, Node | null>();
  /** Per folder key: names that this layer adds (true) or removes (false). */
  private kids = new Map<string, Map<string, boolean>>();
  /** The last version of each removed path, by layer. Admins restore from here. */
  private graves = new Map<string, Node>();

  constructor(private readonly base?: Vfs) {}

  /** A copy-on-write layer over this view. */
  clone(): Vfs {
    return new Vfs(this);
  }

  private getKey(k: string): Node | undefined {
    const n = this.own.get(k);
    if (n !== undefined) return n ?? undefined;
    return this.base?.getKey(k);
  }

  get(host: string, path: string): Node | undefined {
    return this.getKey(key(host, path));
  }

  exists(host: string, path: string) {
    return this.getKey(key(host, path)) !== undefined;
  }

  private names(dirKey: string): Set<string> {
    const out = this.base ? this.base.names(dirKey) : new Set<string>();
    const delta = this.kids.get(dirKey);
    if (delta)
      for (const [name, present] of delta)
        if (present) out.add(name);
        else out.delete(name);
    return out;
  }

  private mark(host: string, path: string, present: boolean) {
    const pk = parentKey(host, path);
    if (!pk) return;
    let delta = this.kids.get(pk);
    if (!delta) {
      delta = new Map();
      this.kids.set(pk, delta);
    }
    // The bottom layer keeps only the names that exist.
    if (present || this.base) delta.set(nameOf(path), present);
    else delta.delete(nameOf(path));
  }

  private set(host: string, path: string, node: Node) {
    const k = key(host, path);
    const had = this.getKey(k) !== undefined;
    this.own.set(k, node);
    if (!had) this.mark(host, path, true);
  }

  private remove(host: string, path: string) {
    const k = key(host, path);
    if (this.base) this.own.set(k, null);
    else this.own.delete(k);
    this.mark(host, path, false);
  }

  /** Direct children of a directory, sorted by name. */
  children(host: string, dir: string): { name: string; node: Node }[] {
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const out: { name: string; node: Node }[] = [];
    for (const name of this.names(key(host, dir))) {
      const node = this.get(host, `${prefix}${name}`);
      if (node) out.push({ name, node });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /** Every key in this view. */
  private keys(): Set<string> {
    const out = this.base ? this.base.keys() : new Set<string>();
    for (const [k, n] of this.own)
      if (n) out.add(k);
      else out.delete(k);
    return out;
  }

  /** Every path on a host, sorted. Used by the projection. */
  entries(host: string): { path: string; node: Node }[] {
    const prefix = `${host}:`;
    const out: { path: string; node: Node }[] = [];
    for (const k of this.keys())
      if (k.startsWith(prefix))
        out.push({
          path: k.slice(prefix.length),
          node: this.getKey(k) as Node,
        });
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  hosts(): string[] {
    const set = new Set<string>();
    for (const k of this.keys()) set.add(k.slice(0, k.indexOf(':')));
    return [...set].sort();
  }

  graveOf(host: string, path: string): Node | undefined {
    return this.graves.get(key(host, path)) ?? this.base?.graveOf(host, path);
  }

  /** The path and every path below it, parents first. */
  private subtree(host: string, path: string): string[] {
    const out = [path];
    const node = this.get(host, path);
    if (node?.kind === 'dir')
      for (const { name } of this.children(host, path))
        out.push(
          ...this.subtree(host, path === '/' ? `/${name}` : `${path}/${name}`),
        );
    return out;
  }

  /**
   * Apply one event. Returns a reason string when the event cannot apply,
   * for example when another seat removed the path earlier in the same turn.
   */
  apply(e: StateEvent, ord: number): string | undefined {
    switch (e.type) {
      case 'fs.mkdir': {
        if (this.exists(e.host, e.path)) return 'path exists';
        this.set(e.host, e.path, {
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
        this.set(e.host, e.path, {
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
        this.graves.set(key(e.host, e.path), cur);
        this.remove(e.host, e.path);
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
        const moved = this.subtree(e.host, e.from).map(
          (p) => [p, this.get(e.host, p) as Node] as const,
        );
        for (const [p] of [...moved].reverse()) this.remove(e.host, p);
        for (const [p, node] of moved)
          this.set(
            e.host,
            e.to + p.slice(e.from.length),
            p === e.from ? { ...node, mtime: ord } : node,
          );
        return;
      }
      case 'fs.meta': {
        const cur = this.get(e.host, e.path);
        if (!cur) return 'path does not exist';
        this.set(e.host, e.path, {
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
