// Catch-all /api/* proxy to the Go backend (default :9876).
//
// What it does:
//   1. Forwards the incoming request to ${BACKEND_URL}/<path>?<query>,
//      preserving method, headers, and body. Same-origin from the browser's
//      perspective — no CORS dance.
//   2. If the backend is unreachable (ECONNREFUSED / fetch throws), falls
//      through to an in-memory mock so the frontend still renders. Mirrors
//      the legacy web-spa/dev.ts behaviour. Logs a warning so it's obvious.
//
// Env:
//   BACKEND_URL — default http://localhost:9876

import type { NextRequest } from 'next/server';

const BACKEND = (process.env.BACKEND_URL ?? 'http://localhost:9876').replace(
  /\/$/,
  '',
);

// Don't try to statically analyse this route — it's a runtime proxy.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await ctx.params;
  const path = `/${(slug ?? []).join('/')}`;
  const url = new URL(req.url);
  const target = `${BACKEND}${path}${url.search}`;

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers: filterRequestHeaders(req.headers),
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }

  try {
    const res = await fetch(target, init);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: filterResponseHeaders(res.headers),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[api-proxy] ${req.method} ${target} failed — falling back to mock: ${msg}`,
    );
    return mockApi(req, path);
  }
}

// Strip hop-by-hop headers and the `host` header (which would point at our
// own port). `accept-encoding` is dropped so we don't deal with double-
// decoding compressed bodies.
function filterRequestHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete('host');
  out.delete('connection');
  out.delete('accept-encoding');
  out.delete('content-length');
  return out;
}

function filterResponseHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  out.delete('transfer-encoding');
  out.delete('connection');
  out.delete('content-encoding');
  out.delete('content-length');
  return out;
}

// In-memory mock: minimal responses that keep the frontend alive when the
// Go backend is offline. Does NOT run ffmpeg — just echoes a fake job.
// Mirrors the shape of the responses from the real Go service.
function mockApi(req: NextRequest, path: string): Response {
  if (path === '/health') {
    return Response.json({
      status: 'ok (mock)',
      ops: 50,
      service: 'ffmpeg-converter-mock',
    });
  }
  if (path === '/ops') {
    return Response.json([]);
  }
  if (path === '/convert' && req.method === 'POST') {
    const id = crypto.randomUUID();
    return Response.json({
      job_id: id,
      status: 'done (mock)',
      op: 'mock',
      output: `/jobs/${id}/output`,
      local_path: '(mock — no file produced; start the Go backend)',
    });
  }
  if (path.startsWith('/jobs/')) {
    return new Response('# mock output — backend offline', {
      headers: { 'content-type': 'text/plain' },
    });
  }
  return new Response(`mock: no handler for ${path}`, { status: 404 });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
  handle as OPTIONS,
};
