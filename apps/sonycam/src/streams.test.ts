import { describe, expect, test } from 'bun:test';
import { Broadcaster, JpegSplitter, LiveviewParser } from './streams.ts';
import { packet } from './testing.ts';

const jpeg = (...body: number[]) =>
  new Uint8Array([0xff, 0xd8, ...body, 0xff, 0xd9]);

const collect = <T extends { push(c: Uint8Array): void }>(
  make: (on: (f: Uint8Array) => void) => T,
) => {
  const frames: number[][] = [];
  const parser = make((f) => frames.push([...f]));
  return { frames, parser };
};

describe('LiveviewParser', () => {
  test('emits JPEG payloads and skips frame-info packets', () => {
    const { frames, parser } = collect((on) => new LiveviewParser(on));
    parser.push(packet(0x01, jpeg(1, 2), 3));
    parser.push(packet(0x02, new Uint8Array([9, 9, 9])));
    parser.push(packet(0x01, jpeg(3)));
    expect(frames).toEqual([[...jpeg(1, 2)], [...jpeg(3)]]);
  });

  test('handles packets split across chunks', () => {
    const { frames, parser } = collect((on) => new LiveviewParser(on));
    const all = new Uint8Array([
      ...packet(0x01, jpeg(1)),
      ...packet(0x01, jpeg(2), 4),
    ]);
    for (let i = 0; i < all.length; i += 7) parser.push(all.slice(i, i + 7));
    expect(frames).toEqual([[...jpeg(1)], [...jpeg(2)]]);
  });

  test('resyncs after garbage bytes', () => {
    const { frames, parser } = collect((on) => new LiveviewParser(on));
    parser.push(new Uint8Array([1, 2, 0xff, 3]));
    parser.push(packet(0x01, jpeg(5)));
    expect(frames).toEqual([[...jpeg(5)]]);
  });
});

describe('JpegSplitter', () => {
  test('splits back-to-back frames across chunk boundaries', () => {
    const { frames, parser } = collect((on) => new JpegSplitter(on));
    const all = new Uint8Array([7, ...jpeg(1, 2), ...jpeg(3), 0]);
    for (let i = 0; i < all.length; i++) parser.push(all.slice(i, i + 1));
    expect(frames).toEqual([[...jpeg(1, 2)], [...jpeg(3)]]);
  });
});

describe('Broadcaster', () => {
  test('sends the latest frame to a new subscriber, then live frames', () => {
    const b = new Broadcaster();
    b.publish(jpeg(1));
    const got: number[][] = [];
    const off = b.subscribe((f) => got.push([...f]));
    b.publish(jpeg(2));
    off();
    b.publish(jpeg(3));
    expect(got).toEqual([[...jpeg(1)], [...jpeg(2)]]);
    expect(b.clientCount).toBe(0);
  });
});
