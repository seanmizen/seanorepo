import { afterAll, describe, expect, test } from 'bun:test';
import { CameraError, WifiSource } from './sources.ts';
import { packet } from './testing.ts';

// A fake camera: the JSON-RPC endpoint and a live view stream.
const calls: string[] = [];
const frame = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const camera = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/liveview') {
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
      startLiveview: [`http://localhost:${camera.port}/liveview`],
      setShootMode: [0],
      startMovieRec: [0],
      stopMovieRec: [''],
      actTakePicture: [['http://camera/pict.jpg']],
    };
    if (method === 'stopLiveview') {
      return Response.json({ error: [40401, 'Camera Not Ready'], id: 1 });
    }
    return Response.json({ result: results[method] ?? [0], id: 1 });
  },
});
afterAll(() => camera.stop(true));

const base = `http://localhost:${camera.port}/sony`;
describe('WifiSource', () => {
  test('starts live view, records, takes a photo', async () => {
    const src = new WifiSource(['http://127.0.0.1:1/sony', base]);
    const frames: Uint8Array[] = [];
    await src.start((f) => frames.push(f));
    await Bun.sleep(50);
    expect(frames.map((f) => [...f])).toEqual([[...frame]]);

    await src.record(true);
    await src.record(false);
    expect(await src.photo()).toBe('http://camera/pict.jpg');
    await src.stop();

    expect(calls).toEqual([
      'getVersions',
      'startRecMode',
      'startLiveview',
      'setShootMode',
      'startMovieRec',
      'stopMovieRec',
      'setShootMode',
      'actTakePicture',
      'stopLiveview',
    ]);
  });

  test('reports a camera error with its message', async () => {
    const src = new WifiSource([base]);
    await expect(src.call('stopLiveview')).rejects.toThrow(
      new CameraError('Camera refused stopLiveview: Camera Not Ready (40401)'),
    );
  });

  test('says how to connect when no camera answers', async () => {
    const src = new WifiSource(['http://127.0.0.1:1/sony']);
    await expect(src.call('getEvent')).rejects.toThrow(/Smart Remote/);
  });
});
