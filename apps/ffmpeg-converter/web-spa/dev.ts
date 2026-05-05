// Tiny Bun dev server for the ffmpeg-converter frontend.
//
// What it does:
//   1. Serves static files from ./ (index.html, src/*, public/*).
//      `.ts` requests are transpiled on the fly via Bun.Transpiler.
//   2. Proxies /api/* → the Go backend on localhost:9876. Same-origin,
//      no CORS dance, no auth.
//   3. If the backend is offline, /api/* falls through to an in-memory mock
//      so the frontend still renders and the queue shows friendly "mock"
//      results. Leaves a console warning so it's obvious.
//
// Run:
//     bun run dev.ts
//
// Env:
//     PORT         — default 4040
//     BACKEND_URL  — default http://localhost:9876

/// <reference types="bun-types" />

const PORT = Number(Bun.env.PORT ?? 4040);
const BACKEND = (Bun.env.BACKEND_URL ?? 'http://localhost:9876').replace(
  /\/$/,
  '',
);
const ROOT = new URL('.', import.meta.url).pathname;

console.log(`ffmpeg-converter web dev server`);
console.log(`  serving:  ${ROOT}`);
console.log(`  backend:  ${BACKEND}`);
console.log(`  port:     ${PORT}`);

const transpiler = new Bun.Transpiler({ loader: 'ts' });

async function resolveFile(
  abs: string,
): Promise<{ file: ReturnType<typeof Bun.file>; path: string } | null> {
  const file = Bun.file(abs);
  if (await file.exists()) return { file, path: abs };

  // Extensionless module import → try .ts fallback (e.g. ./billing → ./billing.ts).
  if (!/\.\w+$/.test(abs)) {
    const tsFile = Bun.file(abs + '.ts');
    if (await tsFile.exists()) return { file: tsFile, path: abs + '.ts' };
  }
  return null;
}

async function serveStatic(pathname: string): Promise<Response> {
  // Default document.
  const rel = pathname === '/' ? '/index.html' : pathname;
  // Block path traversal.
  if (rel.includes('..')) return new Response('nope', { status: 400 });

  const abs = ROOT.replace(/\/$/, '') + rel;
  const resolved = await resolveFile(abs);

  if (!resolved) {
    // SPA fallback: serve index.html for unmatched routes so the client
    // router can handle /plans, /compare, /faq, etc.
    const indexFile = Bun.file(ROOT.replace(/\/$/, '') + '/index.html');
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    return new Response('not found: ' + rel, { status: 404 });
  }

  // Transpile .ts on the fly so browsers get plain JS.
  if (resolved.path.endsWith('.ts')) {
    const src = await resolved.file.text();
    const out = transpiler.transformSync(src);
    return new Response(out, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  // Bun.file sets a reasonable content-type for most extensions.
  return new Response(resolved.file, {
    headers: { 'cache-control': 'no-store' },
  });
}

// In-memory mock: minimal responses that keep the frontend alive when the
// Go backend is offline. Does NOT run ffmpeg — just echoes a fake job.
function mockApi(req: Request, url: URL): Response {
  const path = url.pathname.replace(/^\/api/, '');
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
      output: '/jobs/' + id + '/output',
      local_path: '(mock — no file produced; start the Go backend)',
    });
  }
  if (path.startsWith('/jobs/')) {
    return new Response('# mock output — backend offline', {
      headers: { 'content-type': 'text/plain' },
    });
  }
  return new Response('mock: no handler for ' + path, { status: 404 });
}

async function proxyToBackend(req: Request, url: URL): Promise<Response> {
  const backendPath = url.pathname.replace(/^\/api/, '');
  const target = BACKEND + backendPath + url.search;
  try {
    // Forward the full request — method, headers, body.
    const init: RequestInit = {
      method: req.method,
      headers: req.headers,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body;
      // @ts-expect-error — Bun fetch supports duplex streams
      init.duplex = 'half';
    }
    const res = await fetch(target, init);
    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    });
  } catch (e) {
    console.warn(
      `[proxy] ${req.method} ${target} failed — falling back to mock: ${(e as Error).message}`,
    );
    return mockApi(req, url);
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      return proxyToBackend(req, url);
    }
    return serveStatic(url.pathname);
  },
});

console.log(`\n  → open http://localhost:${PORT}\n`);
