// Where: apps/lessdeaf/server/app.ts
// Why: the HTTP routes of the lessdeaf backend. index.ts gives the handler to
// Bun.serve. The tests call the handler directly.
//
// API:
//   GET    /api/health                                 {ok, sessions, uploads}
//   GET    /api/sessions                               {sessions: [summary]}
//   GET    /api/sessions/<id>                          summary
//   PUT    /api/sessions/<id>                          session.json (JSON) -> {id}
//   DELETE /api/sessions/<id>                          -> 204
//   PUT    /api/sessions/<id>/audio/<seq>              raw PCM chunk -> 204
//   POST   /api/sessions/<id>/audio/finish             {parts} -> summary
//   GET    /api/sessions/<id>/audio                    audio.wav
//   PUT    /api/sessions/<id>/transcripts/<pipeline>   JSON -> 204
//   GET    /api/sessions/<id>/transcripts/<pipeline>   JSON
//
// Every route except /api/health needs "Authorization: Bearer <LESSDEAF_KEY>".
// The audio holds the voices of other people, so reads need the key too.
// Without a key of 16 characters or more on the server, the routes answer
// 503. After 10 wrong keys in 10 minutes, a client gets 429 until the window
// ends. Errors are {error, details?}.

import { createHash, timingSafeEqual } from 'node:crypto';
import { type Store, StoreError } from './store';

export const MIN_KEY_CHARS = 16;
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_PARTS = 1_000_000;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const fail = (status: number, error: string, details?: string[]) =>
  json(
    details?.length ? { error, details: details.slice(0, 100) } : { error },
    status,
  );

const sha = (s: string) => createHash('sha256').update(s).digest();

type Options = {
  store: Store;
  key?: string;
  now?: () => number;
};

async function readBody(req: Request, limit: number) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > limit)
    throw new StoreError(413, `The body is larger than ${limit} bytes.`);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > limit)
    throw new StoreError(413, `The body is larger than ${limit} bytes.`);
  return body;
}

async function readJson(req: Request) {
  const text = new TextDecoder().decode(await readBody(req, MAX_JSON_BYTES));
  try {
    return { text, value: JSON.parse(text) as unknown };
  } catch {
    throw new StoreError(400, 'The body is not valid JSON.');
  }
}

export function createHandler({ store, key = '', now = Date.now }: Options) {
  const enabled = key.length >= MIN_KEY_CHARS;
  const failures = new Map<string, number[]>();

  function authorize(req: Request): Response | null {
    if (!enabled)
      return fail(
        503,
        'Uploads are off on this server. The owner must set LESSDEAF_KEY.',
      );
    // The Cloudflare tunnel sets cf-connecting-ip. A request from the LAN
    // has no such header, and shares one counter.
    const client = req.headers.get('cf-connecting-ip') ?? 'direct';
    const t = now();
    const recent = (failures.get(client) ?? []).filter(
      (at) => t - at < FAIL_WINDOW_MS,
    );
    if (recent.length >= FAIL_LIMIT)
      return fail(429, 'Too many wrong keys. Try again in 10 minutes.');
    const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
    // Compare digests: equal lengths, and the time does not show the key.
    if (!m || !timingSafeEqual(sha(m[1]), sha(key))) {
      recent.push(t);
      failures.set(client, recent);
      return fail(401, 'The key is missing or wrong.');
    }
    return null;
  }

  async function route(req: Request, parts: string[]): Promise<Response> {
    const method = req.method;
    const [, , id, sub, name] = parts;

    if (parts.length === 2 && method === 'GET')
      return json({ sessions: await store.listSessions() });

    if (parts.length === 3) {
      if (method === 'GET') return json(await store.summary(id));
      if (method === 'PUT') {
        const { value } = await readJson(req);
        if (typeof value !== 'object' || value === null || Array.isArray(value))
          return fail(400, 'session.json must be a JSON object.');
        await store.putMetadata(id, value as Record<string, unknown>);
        return json({ id });
      }
      if (method === 'DELETE') {
        await store.deleteSession(id);
        return new Response(null, { status: 204 });
      }
    }

    if (sub === 'audio') {
      if (parts.length === 4 && method === 'GET') {
        const file = store.audioFile(id);
        if (!(await file.exists()))
          return fail(404, 'The session has no finished audio.');
        return new Response(file, {
          headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
        });
      }
      if (parts.length === 5 && name === 'finish' && method === 'POST') {
        const { value } = await readJson(req);
        const count = Number((value as { parts?: unknown } | null)?.parts);
        if (!Number.isInteger(count) || count < 0 || count > MAX_PARTS)
          return fail(400, 'The body must be {"parts": <number of chunks>}.');
        await store.finishAudio(id, count);
        return json(await store.summary(id));
      }
      if (parts.length === 5 && method === 'PUT') {
        if (!/^\d{1,7}$/.test(name) || Number(name) >= MAX_PARTS)
          return fail(400, 'The chunk number is not valid.');
        await store.putPart(
          id,
          Number(name),
          await readBody(req, MAX_CHUNK_BYTES),
        );
        return new Response(null, { status: 204 });
      }
    }

    if (sub === 'transcripts' && parts.length === 5) {
      if (method === 'PUT') {
        const { text } = await readJson(req);
        await store.putTranscript(id, name, text);
        return new Response(null, { status: 204 });
      }
      if (method === 'GET') {
        const file = store.transcriptFile(id, name);
        if (!(await file.exists()))
          return fail(404, 'The session has no such transcript.');
        return new Response(file, {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
        });
      }
    }

    return fail(404, 'No such route.');
  }

  return async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === '/api/health' && req.method === 'GET')
      return json({
        ok: true,
        sessions: await store.count(),
        uploads: enabled,
      });

    const parts = path.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'sessions')
      return fail(404, 'No such route.');

    const denied = authorize(req);
    if (denied) return denied;

    try {
      return await route(req, parts);
    } catch (error) {
      if (error instanceof StoreError)
        return fail(error.status, error.message, error.details);
      console.error('lessdeaf:', error);
      return fail(500, 'The server failed. See the server log.');
    }
  };
}
