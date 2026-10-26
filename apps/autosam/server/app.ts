// Where: apps/autosam/server/app.ts
// Why: the HTTP routes of autosam. index.ts gives the handler to Bun.serve.
// The tests call the handler directly.
//
// Pages:
//   GET /                the library
//   GET /<slug>          one song. 404 when no song has the slug.
//   GET /<file>          a file of public/ (app.js, song-format.js)
//
// API (JSON):
//   GET    /api/health                  {ok, songs, editing}
//   GET    /api/songs                   {songs, archived}
//   GET    /api/songs/<slug>            {slug, title, text, version}
//   POST   /api/songs                   {text} -> 201 {slug, version}
//   PUT    /api/songs/<slug>            {text, version?} -> {slug, version}
//   DELETE /api/songs/<slug>            archive -> {id}
//   POST   /api/archive/<id>/restore    -> {slug}
//   POST   /api/auth/check              -> 204 when the edit key is right
//
// The routes that write need "Authorization: Bearer <AUTOSAM_EDIT_KEY>".
// Without a key of 12 characters or more on the server, they answer 503 and
// the songs are read-only. After 10 wrong keys in 10 minutes, a client gets
// 429 until the window ends. Errors are {error, details?}.

import { createHash, timingSafeEqual } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SLUG_RE } from '../public/song-format.js';
import { type Store, StoreError } from './store';

export const MIN_KEY_CHARS = 12;
export const MAX_BODY_BYTES = 64 * 1024;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 10 * 60 * 1000;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...SECURITY_HEADERS, 'cache-control': 'no-store' },
  });
}

const fail = (status: number, error: string, details?: string[]) =>
  json(details?.length ? { error, details } : { error }, status);

const sha = (s: string) => createHash('sha256').update(s).digest();

type Options = {
  store: Store;
  publicDir: string;
  editKey?: string;
  now?: () => number;
};

export async function createHandler({
  store,
  publicDir,
  editKey = '',
  now = Date.now,
}: Options) {
  // Only the files that are in public/ at start can be served.
  const files = new Set(
    (await readdir(publicDir)).filter((n) => /^[a-z0-9-]+\.[a-z]+$/.test(n)),
  );
  const editing = editKey.length >= MIN_KEY_CHARS;
  const failures = new Map<string, number[]>();

  function authorize(req: Request): Response | null {
    if (!editing)
      return fail(
        503,
        'Editing is off on this server. The owner must set AUTOSAM_EDIT_KEY.',
      );
    // The Cloudflare tunnel sets cf-connecting-ip. A request from the LAN
    // has no such header, and shares one counter.
    const client = req.headers.get('cf-connecting-ip') ?? 'direct';
    const t = now();
    const recent = (failures.get(client) ?? []).filter(
      (at) => t - at < FAIL_WINDOW_MS,
    );
    if (recent.length >= FAIL_LIMIT)
      return fail(429, 'Too many wrong edit keys. Try again in 10 minutes.');
    const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
    // Compare digests: equal lengths, and the time does not show the key.
    if (!m || !timingSafeEqual(sha(m[1]), sha(editKey))) {
      recent.push(t);
      failures.set(client, recent);
      return fail(
        401,
        m ? 'The edit key is wrong.' : 'Saving needs the edit key.',
      );
    }
    failures.delete(client);
    return null;
  }

  async function readBody(
    req: Request,
  ): Promise<{ text: string; version?: string } | Response> {
    const length = Number(req.headers.get('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return fail(413, 'The request is too large.');
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES)
      return fail(413, 'The request is too large.');
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'The request body must be JSON.');
    }
    const b = body as { text?: unknown; version?: unknown };
    if (typeof b?.text !== 'string')
      return fail(400, 'The request body must have a "text" string.');
    if (b.version !== undefined && typeof b.version !== 'string')
      return fail(400, '"version" must be a string.');
    return { text: b.text, version: b.version as string | undefined };
  }

  async function page(title: string | null, status = 200) {
    const html = await Bun.file(join(publicDir, 'index.html')).text();
    const name = title ? `${escapeHtml(title)} · autosam` : 'autosam';
    return new Response(
      html.replace('<title>autosam</title>', `<title>${name}</title>`),
      {
        status,
        headers: {
          ...SECURITY_HEADERS,
          'content-type': TYPES['.html'],
          'cache-control': 'no-cache',
        },
      },
    );
  }

  async function api(req: Request, path: string): Promise<Response> {
    const method = req.method;
    if (path === '/api/health' && method === 'GET') {
      const { songs } = await store.list();
      return json({ ok: true, songs: songs.length, editing });
    }
    if (path === '/api/auth/check' && method === 'POST')
      return authorize(req) ?? new Response(null, { status: 204 });
    if (path === '/api/songs') {
      if (method === 'GET') return json(await store.list());
      if (method === 'POST') {
        const denied = authorize(req);
        if (denied) return denied;
        const body = await readBody(req);
        if (body instanceof Response) return body;
        return json(await store.create(body.text), 201);
      }
      return fail(405, 'Use GET or POST.');
    }
    const song = /^\/api\/songs\/([^/]+)$/.exec(path);
    if (song) {
      const slug = decodeURIComponent(song[1]);
      if (!SLUG_RE.test(slug))
        return fail(404, `There is no song at /${slug}.`);
      if (method === 'GET') {
        const found = await store.get(slug);
        return found ? json(found) : fail(404, `There is no song at /${slug}.`);
      }
      if (method === 'PUT' || method === 'DELETE') {
        const denied = authorize(req);
        if (denied) return denied;
        if (method === 'DELETE') return json(await store.archive(slug));
        const body = await readBody(req);
        if (body instanceof Response) return body;
        return json(await store.update(slug, body.text, body.version));
      }
      return fail(405, 'Use GET, PUT or DELETE.');
    }
    const restore = /^\/api\/archive\/([^/]+)\/restore$/.exec(path);
    if (restore && method === 'POST') {
      const denied = authorize(req);
      if (denied) return denied;
      return json(await store.restore(decodeURIComponent(restore[1])));
    }
    return fail(404, 'There is no such API route.');
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) return await api(req, path);
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return fail(405, 'Use GET.');
      if (path === '/') return await page(null);
      const name = path.slice(1);
      if (files.has(name) && name !== 'index.html') {
        const type = TYPES[name.slice(name.lastIndexOf('.'))];
        return new Response(Bun.file(join(publicDir, name)), {
          headers: {
            ...SECURITY_HEADERS,
            'cache-control': 'no-cache',
            ...(type ? { 'content-type': type } : {}),
          },
        });
      }
      const slug = name.replace(/\/$/, '');
      if (SLUG_RE.test(slug)) {
        const found = await store.get(slug);
        return await page(found?.title ?? null, found ? 200 : 404);
      }
      return await page(null, 404);
    } catch (e) {
      if (e instanceof StoreError) return fail(e.status, e.message, e.details);
      if (e instanceof URIError) return fail(400, 'The address is not valid.');
      console.error('autosam:', e);
      return fail(500, 'The server had an error. Try again.');
    }
  };
}
