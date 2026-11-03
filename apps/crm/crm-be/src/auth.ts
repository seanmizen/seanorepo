import type { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Sign-in and sessions: the session check on each request, the session
 * cookie, the `next` check, the rate limits and the audit rows. The routes
 * for the pages are in `routes/login*` and `routes/account/sessions.tsx`.
 */

export const SESSION_COOKIE = 'crm_session';
export const SESSION_DAYS = 90;
export const LOGIN_TOKEN_MINUTES = 15;

/** The paths that a signed-out visitor can open. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/login/code',
  '/login/verify',
  '/api/health',
]);

/** The signed-in person and their session, set by the hook in `registerAuth`. */
export interface Auth {
  sessionId: string;
  personId: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

/** The SHA-256 hash of a token or a code, as hex. The database stores only this. */
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** A new random token: 32 bytes, base64url. */
export const newToken = () => randomBytes(32).toString('base64url');

export const now = () => new Date().toISOString();

const later = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Lower case, no spaces at the ends. Each email lookup uses this form. */
export const normalizeEmail = (email: unknown) =>
  typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * Return `next` if it is a path on this site, else `/`. This stops a sign-in
 * link that sends the person to a different host (an open redirect).
 */
export const safeNext = (next: unknown): string => {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/';
  // `//host` and `/\host` are other hosts to a browser.
  if (next.startsWith('//') || next.includes('\\')) return '/';
  // The URL parser ignores tabs and newlines, so `/\t/host` becomes `//host`.
  const base = 'http://crm.invalid';
  const url = new URL(next, base);
  if (url.origin !== base) return '/';
  const path = `${url.pathname}${url.search}${url.hash}`;
  // `/.//host` parses to the path `//host`.
  return path.startsWith('//') ? '/' : path;
};

/** Add one row to `audit_log`. */
export const audit = (
  db: Database,
  actor: string,
  action: string,
  entity: string,
  entityId: string | null,
  detail?: Record<string, unknown>,
) => {
  db.query(
    'INSERT INTO audit_log (id, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?);',
  ).run(
    crypto.randomUUID(),
    actor,
    action,
    entity,
    entityId,
    detail ? JSON.stringify(detail) : null,
  );
};

/**
 * Make the person for CRM_ADMIN_EMAIL if it is missing. There is no signup
 * page, so this is how the first person gets into the database.
 */
export const ensureAdmin = (db: Database, adminEmail: string | undefined) => {
  const email = normalizeEmail(adminEmail);
  if (!email) return;
  const found = db
    .query('SELECT id FROM person WHERE lower(email) = ?;')
    .get(email);
  if (found) return;
  db.query('INSERT INTO person (id, email, name) VALUES (?, ?, ?);').run(
    crypto.randomUUID(),
    email,
    email,
  );
};

/**
 * Start a session for `personId`: a session row with the token hash, and the
 * cookie with the raw token. Returns the session id.
 */
export const startSession = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  personId: string,
  method: 'link' | 'code',
) => {
  const token = newToken();
  const sessionId = crypto.randomUUID();
  db.query(
    'INSERT INTO session (id, person_id, token_hash, user_agent, expires_at) VALUES (?, ?, ?, ?, ?);',
  ).run(
    sessionId,
    personId,
    hash(token),
    request.headers['user-agent'] ?? null,
    later(SESSION_DAYS * 24 * 60 * 60 * 1000),
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  audit(db, personId, 'sign_in', 'session', sessionId, { method });
  return sessionId;
};

/** End the current session: delete its row and clear the cookie. */
export const endSession = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  if (request.auth) {
    db.query('DELETE FROM session WHERE id = ?;').run(request.auth.sessionId);
    audit(
      db,
      request.auth.personId,
      'sign_out',
      'session',
      request.auth.sessionId,
    );
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
};

/** Find the session for a raw cookie token, and mark it as seen now. */
const findSession = (db: Database, token: string | undefined): Auth | null => {
  if (!token) return null;
  const row = db
    .query<Auth, [string, string]>(
      `SELECT session.id AS sessionId, person.id AS personId, person.email AS email
       FROM session JOIN person ON person.id = session.person_id
       WHERE session.token_hash = ? AND session.expires_at > ?;`,
    )
    .get(hash(token), now());
  if (!row) return null;
  db.query('UPDATE session SET last_seen_at = ? WHERE id = ?;').run(
    now(),
    row.sessionId,
  );
  return row;
};

/**
 * A fixed-window rate limit in memory. `hit(key)` counts one attempt and
 * returns false when the key has more than `max` attempts in the window.
 */
export const rateLimiter = (max: number, windowMs: number) => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string) => {
    const time = Date.now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= time) hits.delete(k);
    }
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= max;
  };
};

/**
 * The limits for the login endpoint and the code endpoint. Each one counts by
 * email and by IP. An unknown email counts the same as a known one, so a
 * limit tells nothing about which emails have an account.
 */
export const makeLoginLimits = () => {
  const window = LOGIN_TOKEN_MINUTES * 60 * 1000;
  const byEmail = rateLimiter(5, window);
  const byIp = rateLimiter(20, window);
  return (endpoint: 'login' | 'code', email: string, ip: string) => {
    const emailOk = byEmail(`${endpoint}:${email}`);
    const ipOk = byIp(`${endpoint}:${ip}`);
    return emailOk && ipOk;
  };
};

export type LoginLimits = ReturnType<typeof makeLoginLimits>;

/**
 * Register the auth hook. On each request it:
 * 1. Refuses a POST whose `Origin` header is a different host (CSRF). The
 *    `SameSite=Lax` cookie is the first guard. This is the second.
 * 2. Finds the session from the cookie and sets `request.auth`.
 * 3. Sends a signed-out visitor to `/login?next=<path>`. The public paths and
 *    `/static/` are open to everyone.
 */
export const registerAuth = (app: FastifyInstance, db: Database) => {
  app.decorateRequest('auth', null);
  // A callback hook, not an async one: a hook that sends a reply does not
  // call `done`, so the route handler never runs. (Under Bun, `reply.sent`
  // can still be false when an async hook returns.)
  app.addHook('onRequest', (request, reply, done) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin !== undefined && !sameHost(origin, request.host)) {
        reply.code(403).type('text/plain').send('Forbidden: origin.');
        return;
      }
    }

    request.auth = findSession(db, request.cookies[SESSION_COOKIE]);
    const path = request.url.split('?')[0];
    if (request.auth || PUBLIC_PATHS.has(path) || path.startsWith('/static/')) {
      done();
      return;
    }
    if (path.startsWith('/api/')) {
      reply.code(401).send({ error: 'Sign in first.' });
      return;
    }
    const next =
      request.method === 'GET' && request.url !== '/'
        ? `?next=${encodeURIComponent(request.url)}`
        : '';
    reply.redirect(`/login${next}`, 303);
  });
};

/** True if the `Origin` header names the host of this request. */
const sameHost = (origin: string, host: string) => {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};
