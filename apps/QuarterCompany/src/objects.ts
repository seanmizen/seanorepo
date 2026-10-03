// Content-addressed object store. Every file version and every model call
// payload goes here once, by SHA-256. Objects are never removed, so a delete
// in the world never destroys content. See REQ-QC-002.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export class ObjectStore {
  constructor(readonly root: string) {}

  pathOf(hash: string) {
    return join(this.root, hash.slice(0, 2), hash.slice(2));
  }

  put(content: string): string {
    const hash = sha256(content);
    const path = this.pathOf(hash);
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    return hash;
  }

  putJson(value: unknown): string {
    return this.put(JSON.stringify(value));
  }

  get(hash: string): string {
    return readFileSync(this.pathOf(hash), 'utf8');
  }
}
