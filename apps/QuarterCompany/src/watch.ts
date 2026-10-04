// qc run --watch: serve the viewer while the run runs (REQ-QC-035).
//
// - GET /                  the viewer, with the turns so far.
// - GET /api/turns?after=N the turns after ord N, from the journal.
// - GET /api/live          a server-sent event stream of LiveEvent.
//
// The finished turns come from the journal, the same as `qc export`
// (REQ-QC-001). The live events are for display only. The server keeps the
// events of the current turn, so a page that opens during a turn shows the
// turn so far. The server listens on loopback only.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportHtml, exportTurnsAfter } from './export.ts';
import type { Live, LiveEvent } from './live.ts';
import type { Run } from './run.ts';

export const DEFAULT_WATCH_PORT = 4560;

export interface Watch {
  url: string;
  live: Live;
  close(): Promise<void>;
}

export async function startWatch(run: Run, port: number): Promise<Watch> {
  let turn: LiveEvent[] = [];
  const clients = new Set<ServerResponse>();
  const send = (res: ServerResponse, e: LiveEvent) =>
    res.write(`data: ${JSON.stringify(e)}\n\n`);

  const live: Live = (e) => {
    if (e.type === 'turn.begin') turn = [];
    turn.push(e);
    for (const res of clients) send(res, e);
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(exportHtml(run, { live: true }));
      return;
    }
    if (url.pathname === '/api/turns') {
      const after = Number(url.searchParams.get('after') ?? '-1');
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(
        JSON.stringify(
          exportTurnsAfter(run, Number.isFinite(after) ? after : -1),
        ),
      );
      return;
    }
    if (url.pathname === '/api/live') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      for (const e of turn) send(res, e);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found.');
  };

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      if (!res.headersSent)
        res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err instanceof Error ? err.message : String(err));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) =>
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(
              `Port ${port} is in use. Give another port with --port, or stop the other server.`,
            )
          : err,
      ),
    );
    server.listen(port, '127.0.0.1', resolve);
  });
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}/`,
    live,
    close: () =>
      new Promise<void>((resolve) => {
        for (const res of clients) res.end();
        server.close(() => resolve());
      }),
  };
}
