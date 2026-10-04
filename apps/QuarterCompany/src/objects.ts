// Content-addressed object store. Every file version and every model call
// payload goes here once, by SHA-256. Objects are never removed, so a delete
// in the world never destroys content. See REQ-QC-002.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

/** Objects to keep in memory. Objects never change, so a cache is safe. */
const CACHE_LIMIT = 50_000;

export class ObjectStore {
  /** Recent objects by hash. A large population reads the same mail often. */
  private cache = new Map<string, string>();

  constructor(readonly root: string) {}

  private remember(hash: string, content: string) {
    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(hash, content);
  }

  pathOf(hash: string) {
    return join(this.root, hash.slice(0, 2), hash.slice(2));
  }

  put(content: string): string {
    const hash = sha256(content);
    if (this.cache.has(hash)) return hash;
    const path = this.pathOf(hash);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    this.remember(hash, content);
    return hash;
  }

  putJson(value: unknown): string {
    return this.put(JSON.stringify(value));
  }

  get(hash: string): string {
    const hit = this.cache.get(hash);
    if (hit !== undefined) return hit;
    const content = readFileSync(this.pathOf(hash), 'utf8');
    this.remember(hash, content);
    return content;
  }
}
