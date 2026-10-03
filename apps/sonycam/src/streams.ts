// Frame extraction for the two camera sources.
//
// Wi-Fi: the Sony Camera Remote API live view stream. Each packet is an
// 8-byte common header, a 128-byte payload header, then the payload and
// padding. Payload type 0x01 is a JPEG frame; 0x02 is frame info (skipped).
//
// USB: `gphoto2 --capture-movie --stdout` writes JPEG frames back to back,
// with no framing. A frame runs from SOI (FF D8) to EOI (FF D9).

const COMMON_HEADER = 8;
const PAYLOAD_HEADER = 128;
const START_CODE = [0x24, 0x35, 0x68, 0x79];
const TYPE_JPEG = 0x01;

type FrameHandler = (jpeg: Uint8Array) => void;

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

export class LiveviewParser {
  private buf: Uint8Array = new Uint8Array(0);

  constructor(private readonly onFrame: FrameHandler) {}

  push(chunk: Uint8Array): void {
    this.buf = concat(this.buf, chunk);
    for (;;) {
      if (this.buf.length < COMMON_HEADER + PAYLOAD_HEADER) return;
      if (!this.headerValid()) {
        // Lost sync: drop one byte and look for the next packet.
        this.buf = this.buf.subarray(1);
        continue;
      }
      const b = this.buf;
      const size = (b[12] << 16) | (b[13] << 8) | b[14];
      const padding = b[15];
      const total = COMMON_HEADER + PAYLOAD_HEADER + size + padding;
      if (b.length < total) return;
      if (b[1] === TYPE_JPEG) {
        const start = COMMON_HEADER + PAYLOAD_HEADER;
        this.onFrame(b.slice(start, start + size));
      }
      this.buf = b.subarray(total);
    }
  }

  private headerValid(): boolean {
    const b = this.buf;
    if (b[0] !== 0xff) return false;
    return START_CODE.every((v, i) => b[COMMON_HEADER + i] === v);
  }
}

export class JpegSplitter {
  private buf: Uint8Array = new Uint8Array(0);

  constructor(private readonly onFrame: FrameHandler) {}

  push(chunk: Uint8Array): void {
    this.buf = concat(this.buf, chunk);
    for (;;) {
      const soi = this.find(0xd8, 0);
      if (soi < 0) {
        // Keep a trailing FF: it can be the first byte of the next SOI.
        const last = this.buf[this.buf.length - 1];
        this.buf = last === 0xff ? this.buf.slice(-1) : new Uint8Array(0);
        return;
      }
      const eoi = this.find(0xd9, soi + 2);
      if (eoi < 0) {
        this.buf = this.buf.subarray(soi);
        return;
      }
      this.onFrame(this.buf.slice(soi, eoi + 2));
      this.buf = this.buf.subarray(eoi + 2);
    }
  }

  private find(marker: number, from: number): number {
    const b = this.buf;
    for (let i = from; i < b.length - 1; i++) {
      if (b[i] === 0xff && b[i + 1] === marker) return i;
    }
    return -1;
  }
}

// Fans the latest frame out to every connected MJPEG client.
export class Broadcaster {
  private readonly clients = new Set<FrameHandler>();
  latest: Uint8Array | null = null;
  frames = 0;

  publish(jpeg: Uint8Array): void {
    this.latest = jpeg;
    this.frames++;
    for (const client of this.clients) client(jpeg);
  }

  subscribe(client: FrameHandler): () => void {
    this.clients.add(client);
    if (this.latest) client(this.latest);
    return () => this.clients.delete(client);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
