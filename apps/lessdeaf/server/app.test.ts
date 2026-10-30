import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from './app';
import { createStore } from './store';

const KEY = 'test-lessdeaf-key-123';
const ID = '2026-10-30T19-04-12-ab12';
const METADATA = {
  startedAt: '2026-10-30T19:04:12Z',
  device: { sampleRate: 48000, channels: 1 },
};

let dir: string;
let handle: (req: Request) => Promise<Response>;
let clock = 0;

async function setup(key = KEY) {
  const store = createStore(join(dir, 'data'));
  await store.init();
  handle = createHandler({ store, key, now: () => clock });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lessdeaf-app-'));
  clock = 0;
  await setup();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function call(
  method: string,
  path: string,
  body?: BodyInit | object,
  key: string | null = KEY,
) {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  const isRaw = body instanceof Uint8Array || typeof body === 'string';
  if (body !== undefined && !isRaw)
    headers['content-type'] = 'application/json';
  return handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : isRaw
            ? (body as BodyInit)
            : JSON.stringify(body),
    }),
  );
}

const pcm = (...samples: number[]) =>
  new Uint8Array(new Int16Array(samples).buffer);

describe('auth', () => {
  test('health needs no key and reports the state', async () => {
    const res = await call('GET', '/api/health', undefined, null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sessions: 0, uploads: true });
  });

  test('a missing or wrong key gets 401', async () => {
    expect((await call('GET', '/api/sessions', undefined, null)).status).toBe(
      401,
    );
    expect(
      (await call('GET', '/api/sessions', undefined, 'wrong-key-wrong-key'))
        .status,
    ).toBe(401);
  });

  test('ten wrong keys lock the client for ten minutes', async () => {
    for (let i = 0; i < 10; i++)
      await call('GET', '/api/sessions', undefined, 'wrong');
    expect((await call('GET', '/api/sessions')).status).toBe(429);
    clock += 10 * 60 * 1000;
    expect((await call('GET', '/api/sessions')).status).toBe(200);
  });

  test('a short server key turns the routes off', async () => {
    await setup('short');
    expect(
      (await call('GET', '/api/sessions', undefined, 'short')).status,
    ).toBe(503);
  });

  test('routes outside /api/sessions are 404', async () => {
    expect((await call('GET', '/nothing')).status).toBe(404);
  });
});

describe('sessions', () => {
  test('metadata, audio chunks and finish make a WAV file', async () => {
    expect((await call('PUT', `/api/sessions/${ID}`, METADATA)).status).toBe(
      200,
    );
    expect(
      (await call('PUT', `/api/sessions/${ID}/audio/0`, pcm(1, 2))).status,
    ).toBe(204);
    expect(
      (await call('PUT', `/api/sessions/${ID}/audio/1`, pcm(3))).status,
    ).toBe(204);
    // A retry of chunk 1 replaces it.
    expect(
      (await call('PUT', `/api/sessions/${ID}/audio/1`, pcm(3))).status,
    ).toBe(204);

    const finished = await call('POST', `/api/sessions/${ID}/audio/finish`, {
      parts: 2,
    });
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({
      id: ID,
      hasAudio: true,
      pendingParts: 0,
    });

    const wav = new Uint8Array(
      await (await call('GET', `/api/sessions/${ID}/audio`)).arrayBuffer(),
    );
    expect(wav.byteLength).toBe(44 + 6);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(6);
    expect(Array.from(new Int16Array(wav.buffer.slice(44)))).toEqual([1, 2, 3]);

    // A retry of finish after a lost response is safe.
    expect(
      (await call('POST', `/api/sessions/${ID}/audio/finish`, { parts: 2 }))
        .status,
    ).toBe(200);
  });

  test('finish names the missing chunks', async () => {
    await call('PUT', `/api/sessions/${ID}`, METADATA);
    await call('PUT', `/api/sessions/${ID}/audio/0`, pcm(1));
    await call('PUT', `/api/sessions/${ID}/audio/2`, pcm(1));
    const res = await call('POST', `/api/sessions/${ID}/audio/finish`, {
      parts: 4,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ details: ['1', '3'] });
  });

  test('finish needs the sample rate in the metadata', async () => {
    await call('PUT', `/api/sessions/${ID}`, { startedAt: 'x' });
    await call('PUT', `/api/sessions/${ID}/audio/0`, pcm(1));
    expect(
      (await call('POST', `/api/sessions/${ID}/audio/finish`, { parts: 1 }))
        .status,
    ).toBe(422);
  });

  test('a chunk before the metadata is 404, an odd length is 400', async () => {
    expect(
      (await call('PUT', `/api/sessions/${ID}/audio/0`, pcm(1))).status,
    ).toBe(404);
    await call('PUT', `/api/sessions/${ID}`, METADATA);
    expect(
      (await call('PUT', `/api/sessions/${ID}/audio/0`, new Uint8Array(3)))
        .status,
    ).toBe(400);
  });

  test('transcripts are stored per pipeline and listed', async () => {
    await call('PUT', `/api/sessions/${ID}`, METADATA);
    const transcript = { pipeline: 'p1', segments: [] };
    expect(
      (
        await call(
          'PUT',
          `/api/sessions/${ID}/transcripts/fluidaudio+lseend`,
          transcript,
        )
      ).status,
    ).toBe(204);
    const got = await call(
      'GET',
      `/api/sessions/${ID}/transcripts/fluidaudio+lseend`,
    );
    expect(await got.json()).toEqual(transcript);

    const list = await (await call('GET', '/api/sessions')).json();
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0]).toMatchObject({
      id: ID,
      hasAudio: false,
      transcripts: ['fluidaudio+lseend'],
    });
  });

  test('bad IDs and pipeline names are refused', async () => {
    expect((await call('PUT', '/api/sessions/..', METADATA)).status).toBe(404);
    expect((await call('PUT', '/api/sessions/a.b', METADATA)).status).toBe(400);
    await call('PUT', `/api/sessions/${ID}`, METADATA);
    expect(
      (await call('PUT', `/api/sessions/${ID}/transcripts/.hidden`, {})).status,
    ).toBe(400);
  });

  test('delete removes the session', async () => {
    await call('PUT', `/api/sessions/${ID}`, METADATA);
    expect((await call('DELETE', `/api/sessions/${ID}`)).status).toBe(204);
    expect((await call('GET', `/api/sessions/${ID}`)).status).toBe(404);
  });
});
