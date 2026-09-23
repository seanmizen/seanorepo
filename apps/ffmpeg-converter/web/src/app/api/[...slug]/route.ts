// Passes /api/* to the Go service. The browser talks to one origin only.

import type { NextRequest } from 'next/server';

const BACKEND = (process.env.BACKEND_URL ?? 'http://localhost:9876').replace(
  /\/$/,
  '',
);

export const dynamic = 'force-dynamic';

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await ctx.params;
  const target = `${BACKEND}/${slug.join('/')}${new URL(req.url).search}`;

  const headers = new Headers(req.headers);
  for (const h of ['host', 'connection', 'accept-encoding']) headers.delete(h);

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (e) {
    console.error(`[api] ${req.method} ${target}:`, e);
    return Response.json(
      { error: 'the conversion service is not available' },
      { status: 503 },
    );
  }
  const out = new Headers(res.headers);
  for (const h of ['transfer-encoding', 'connection', 'content-encoding']) {
    out.delete(h);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export const GET = handle;
export const POST = handle;
