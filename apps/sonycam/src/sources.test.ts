import { afterAll, describe, expect, test } from 'bun:test';
import { CameraError, WifiSource } from './sources.ts';
import { packet } from './testing.ts';

const frame = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);

// A fake camera: the JSON-RPC endpoint and a live view stream. `modes` is
// what getSupportedShootMode returns; a single-mode camera refuses
// setShootMode, as the A6000 does.
const fakeCamera = (modes: string[]) => {
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname === '/liveview') {
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(packet(0x01, frame, 2));
            },
          }),
        );
      }
      const { method } = (await req.json()) as { method: string };
      calls.push(method);
      const results: Record<string, unknown[]> = {
        getVersions: [['1.0']],
        startRecMode: [0],
        getSupportedShootMode: [modes],
        startLiveview: [`http://localhost:${server.port}/liveview`],
        startMovieRec: [0],
        stopMovieRec: [''],
        actTakePicture: [['http://camera/pict.jpg']],
      };
      if (
        method === 'stopLiveview' ||
        (method === 'setShootMode' && modes.length < 2)
      ) {
        return Response.json({ error: [500, 'Set operation failed.'], id: 1 });
      }
      return Response.json({ result: results[method] ?? [0], id: 1 });
    },
  });
  return { calls, server, base: `http://localhost:${server.port}/sony` };
};

const both = fakeCamera(['still', 'movie']);
const stillsOnly = fakeCamera(['still']);
afterAll(() => {
  both.server.stop(true);
  stillsOnly.server.stop(true);
});

describe('WifiSource', () => {
  test('starts live view, records, takes a photo', async () => {
    const src = new WifiSource(['http://127.0.0.1:1/sony', both.base]);
    const frames: Uint8Array[] = [];
    await src.start((f) => frames.push(f));
    await Bun.sleep(50);
    expect(frames.map((f) => [...f])).toEqual([[...frame]]);
    expect(src.canRecord).toBe(true);

    await src.record(true);
    await src.record(false);
    expect(await src.photo()).toBe('http://camera/pict.jpg');
    await src.stop();

    expect(both.calls).toEqual([
      'getVersions',
      'startRecMode',
      'getSupportedShootMode',
      'startLiveview',
      'setShootMode',
      'startMovieRec',
      'stopMovieRec',
      'setShootMode',
      'actTakePicture',
      'stopLiveview',
    ]);
  });

  test('a stills-only camera (A6000) takes photos but cannot record', async () => {
    const src = new WifiSource([stillsOnly.base]);
    await src.start(() => undefined);
    expect(src.canRecord).toBe(false);
    expect(src.canPhoto).toBe(true);
    expect(await src.photo()).toBe('http://camera/pict.jpg');
    await expect(src.record(true)).rejects.toThrow(/does not support movie/);
    await src.stop();
    expect(stillsOnly.calls).not.toContain('setShootMode');
  });

  test('reports a camera error with its message', async () => {
    const src = new WifiSource([both.base]);
    await expect(src.call('stopLiveview')).rejects.toThrow(
      new CameraError(
        'Camera refused stopLiveview: Set operation failed. (500)',
      ),
    );
  });

  test('says how to connect when no camera answers', async () => {
    const src = new WifiSource(['http://127.0.0.1:1/sony']);
    await expect(src.call('getEvent')).rejects.toThrow(/Smart Remote/);
  });
});
