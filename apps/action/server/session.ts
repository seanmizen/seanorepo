// Where: apps/action/server/session.ts
// When: server/index.ts imports it at start. session.test.ts and
// lobby.test.ts test it (yarn workspace action test).
// Why: the server half of the session layer (game/src/session/). The
// server says who it is, and it tells the clients before a planned stop:
//
//   instance  a new random id at each start of the process
//   build     the build of the code: public/build-version.txt, which
//             build.sh and the dockerfile write (scripts/build-version.sh).
//             No file: "dev".
//   protocol  the version of the messages: game/src/protocol_version.txt,
//             the one number that the client embeds too
//   started   the start time, ISO 8601 (UTC)
//
// GET /api/version gives these fields as JSON. The welcome message, the
// first message on each WebSocket, has the same fields. Before a planned
// stop (SIGTERM or SIGINT) each client gets {t:"bye", reason}, then the
// close. The client compares the fields when it connects again
// (game/src/session/ident.zig).
//
// This file has no action game code.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Ident {
  instance: string;
  build: string;
  protocol: number;
  started: string;
}

/** The file in the public directory that holds the build version. */
export const BUILD_FILE = 'build-version.txt';
/** The build version of a checkout with no build file. */
export const DEV_BUILD = 'dev';
/** The header of each static file and each /api response. */
export const BUILD_HEADER = 'x-build-version';
/** The reason in the bye message before a planned stop. */
export const STOP_REASON = 'The server stops for a restart or an update.';
/** The close code after a bye: "going away". */
export const BYE_CODE = 1001;

/** The characters of a build version. game/build.zig checks the same. */
const BUILD_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/;

/** The build version from the build file in `publicDir`, or DEV_BUILD
 * when there is no file. A bad value stops the start. */
export function readBuild(publicDir: string): string {
  const file = join(publicDir, BUILD_FILE);
  if (!existsSync(file)) return DEV_BUILD;
  const text = readFileSync(file, 'utf8').trim();
  if (!BUILD_PATTERN.test(text))
    throw new Error(`${file}: the build version "${text}" is not valid`);
  return text;
}

/** The protocol version: one whole number of 1 or more in the file. */
export function readProtocol(file: string): number {
  const text = readFileSync(file, 'utf8').trim();
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < 1)
    throw new Error(`${file}: the protocol version "${text}" is not valid`);
  return n;
}

/** The identity of this start of the server. */
export function newIdent(build: string, protocol: number, now: Date): Ident {
  return {
    instance: randomBytes(8).toString('hex'),
    build,
    protocol,
    started: now.toISOString(),
  };
}

/** The answer to GET /api/version. A cache must not keep it. */
export function versionResponse(ident: Ident): Response {
  return Response.json(ident, {
    headers: { 'cache-control': 'no-store', [BUILD_HEADER]: ident.build },
  });
}

/** The welcome message: the first message on a new WebSocket. */
export function welcome(ident: Ident, extra: object): string {
  return JSON.stringify({ t: 'welcome', ...extra, ...ident });
}

interface Closable {
  send(text: string): unknown;
  close(code?: number, reason?: string): void;
}

/** Tell a client why the server closes the connection, then close it. */
export function bye(ws: Closable, reason: string): void {
  ws.send(JSON.stringify({ t: 'bye', reason }));
  ws.close(BYE_CODE, reason);
}

/** After the byes, the process waits at most this long for the clients to
 * close. */
export const STOP_WAIT_MS = 1000;

/** On SIGTERM (docker stop, a deploy) or SIGINT (Ctrl+C): a bye to each
 * client, then `stop` (stop the listener). The process exits with code 0
 * when no client stays open, or after STOP_WAIT_MS. Docker sends SIGTERM to
 * the server process, and a process with no handler ignores it there. The
 * result tells if a stop started. */
export function stopOnSignal(
  clients: () => Closable[],
  stop: () => void,
  log: (line: string) => void,
): { stopping: () => boolean } {
  let stopping = false;
  const run = (signal: string) => {
    if (stopping) return;
    stopping = true;
    const list = clients();
    log(`${signal}: a bye to ${list.length} clients, then stop`);
    for (const ws of list) bye(ws, STOP_REASON);
    stop();
    const end = Date.now() + STOP_WAIT_MS;
    const check = () => {
      if (clients().length === 0 || Date.now() >= end) process.exit(0);
      else setTimeout(check, 20);
    };
    check();
  };
  process.on('SIGTERM', () => run('SIGTERM'));
  process.on('SIGINT', () => run('SIGINT'));
  return { stopping: () => stopping };
}
