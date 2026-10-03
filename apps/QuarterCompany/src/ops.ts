// A buffer of events against one view of the filesystem. Each event applies
// to the view at once, so the author reads its own writes. The engine merges
// the buffers of all seats at the end of the turn. See REQ-QC-008.
import type { EventBody, Meta, StateEvent } from './events.ts';
import type { ObjectStore } from './objects.ts';
import { parentOf, type Vfs } from './vfs.ts';

export interface Op {
  actor: string;
  body: EventBody;
}

export class Ops {
  list: Op[] = [];

  constructor(
    readonly vfs: Vfs,
    readonly objects: ObjectStore,
    readonly ord: number,
  ) {}

  emit(actor: string, body: EventBody) {
    if (body.type.startsWith('fs.') && body.type !== 'fs.conflict') {
      const reason = this.vfs.apply(body as StateEvent, this.ord);
      if (reason)
        throw new Error(`${(body as { path?: string }).path ?? ''}: ${reason}`);
    }
    this.list.push({ actor, body });
  }

  mkdir(actor: string, host: string, path: string, meta: Meta) {
    this.emit(actor, { type: 'fs.mkdir', host, path, ...meta });
  }

  /** Create every missing folder on the way to `path`, with the same metadata. */
  mkdirp(actor: string, host: string, path: string, meta: Meta) {
    if (path === '/' || this.vfs.exists(host, path)) return;
    this.mkdirp(actor, host, parentOf(path), meta);
    this.mkdir(actor, host, path, meta);
  }

  write(actor: string, host: string, path: string, text: string, meta: Meta) {
    const hash = this.objects.put(text);
    this.emit(actor, {
      type: 'fs.write',
      host,
      path,
      hash,
      size: Buffer.byteLength(text),
      ...meta,
    });
  }

  read(host: string, path: string): string | undefined {
    const n = this.vfs.get(host, path);
    return n?.kind === 'file' && n.hash ? this.objects.get(n.hash) : undefined;
  }

  /** Append a line to a root-owned log file, creating it if needed. */
  log(host: string, path: string, line: string) {
    this.mkdirp('syslog', host, parentOf(path), {
      owner: 'root',
      group: 'root',
      mode: 0o755,
    });
    const prev = this.read(host, path) ?? '';
    this.write('syslog', host, path, `${prev}${line}\n`, {
      owner: 'root',
      group: 'wheel',
      mode: 0o640,
    });
  }
}
