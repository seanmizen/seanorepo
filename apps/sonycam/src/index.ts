import { readFileSync } from 'node:fs';
import Fastify, { type FastifyError } from 'fastify';
import {
  CameraError,
  createSource,
  type Source,
  type SourceKind,
} from './sources.ts';
import { Broadcaster } from './streams.ts';

const PORT = Number(process.env.PORT ?? 4070);
// Loopback by default. WSL forwards localhost, so OBS on Windows reaches it.
const HOST = process.env.HOST ?? '127.0.0.1';
const BOUNDARY = 'sonycamframe';

const page = (name: string) =>
  readFileSync(new URL(`./public/${name}`, import.meta.url), 'utf8');

const app = Fastify({ logger: { level: 'info' } });
const broadcaster = new Broadcaster();
let source: Source | null = null;
let recording = false;

app.setErrorHandler((err: FastifyError, _req, reply) => {
  const status = err instanceof CameraError ? 502 : (err.statusCode ?? 500);
  reply.status(status).send({ error: err.message });
});

app.get('/', (_req, reply) => reply.type('text/html').send(page('index.html')));
// Full-window live view for an OBS Browser Source.
app.get('/view', (_req, reply) =>
  reply.type('text/html').send(page('view.html')),
);

app.get('/api/status', () => ({
  source: source?.kind ?? null,
  recording,
  frames: broadcaster.frames,
  clients: broadcaster.clientCount,
  canRecord: Boolean(source?.record),
}));

app.post<{ Body: { kind: SourceKind } }>('/api/source', async (req) => {
  const { kind } = req.body;
  if (kind !== 'wifi' && kind !== 'usb') {
    throw Object.assign(new Error('kind must be "wifi" or "usb"'), {
      statusCode: 400,
    });
  }
  await source?.stop();
  source = null;
  recording = false;
  const next = createSource(kind);
  await next.start((jpeg) => broadcaster.publish(jpeg));
  source = next;
  return { source: kind };
});

app.delete('/api/source', async () => {
  await source?.stop();
  source = null;
  recording = false;
  return { source: null };
});

app.post<{ Body: { on: boolean } }>('/api/record', async (req, reply) => {
  if (!source?.record) {
    return reply
      .status(409)
      .send({ error: 'Recording needs the Wi-Fi source.' });
  }
  await source.record(req.body.on);
  recording = req.body.on;
  return { recording };
});

app.post('/api/photo', async (_req, reply) => {
  if (!source?.photo) {
    return reply.status(409).send({ error: 'Photos need the Wi-Fi source.' });
  }
  return { url: await source.photo() };
});

app.get('/api/frame.jpg', (_req, reply) => {
  if (!broadcaster.latest) {
    return reply.status(404).send({ error: 'No frame yet.' });
  }
  return reply.type('image/jpeg').send(Buffer.from(broadcaster.latest));
});

app.get('/api/live.mjpeg', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store',
    Connection: 'close',
  });
  const unsubscribe = broadcaster.subscribe((jpeg) => {
    // Drop frames for a slow client rather than queue them.
    if (res.writableNeedDrain) return;
    res.write(
      `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
    );
    res.write(jpeg);
    res.write('\r\n');
  });
  req.raw.on('close', unsubscribe);
});

const shutdown = async () => {
  await source?.stop().catch(() => undefined);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: PORT, host: HOST });
