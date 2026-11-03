import type { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderAdminOnly } from './ui/AdminOnly';

/**
 * Sign-in and sessions: the session check on each request, the session
 * cookie, the `next` check, the admin check, the rate limits and the audit
 * rows. The routes for the pages are in `routes/login*`,
 * `routes/account/sessions.tsx` and `routes/account/passkeys.tsx`. The
 * WebAuthn part is in `passkeys.ts`.
 */

export const SESSION_COOKIE = 'crm_session';
export const SESSION_DAYS = 90;
export const LOGIN_TOKEN_MINUTES = 15;
/** A recovery session and its enrolment link last this long. */
export const RECOVERY_MINUTES = 15;

/**
 * The base URL of the site, from config. The sign-in email, the enrolment
 * link and the WebAuthn relying party use it. It never comes from the Host
 * header: a forged Host header must not put a different host into an email.
 */
export const PUBLIC_URL = (
  process.env.CRM_PUBLIC_URL || 'http://localhost:4100'
).replace(/\/+$/, '');

/** The paths that a signed-out visitor can open. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/login/code',
  '/login/verify',
  '/login/recover',
  '/favicon.ico',
  '/api/health',
  '/api/passkeys/sign-in-options',
  '/api/passkeys/sign-in',
]);

/** The only paths that a recovery session can open, with the public paths. */
const RECOVERY_PATHS = new Set([
  '/account/passkeys',
  '/api/passkeys/register-options',
  '/api/passkeys/register',
  '/logout',
]);

/** How a session started. Only a `passkey` session opens the admin pages. */
export type SessionMethod = 'email' | 'passkey' | 'recovery';

/** The signed-in person and their session, set by the hook in `registerAuth`. */
export interface Auth {
  sessionId: string;
  personId: string;
  email: string;
  method: SessionMethod;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
  interface FastifyContextConfig {
    /**
     * True for an admin route. The hook in `registerAuth` lets only the
     * admin (CRM_ADMIN_EMAIL) open it, in a session from a passkey sign-in.
     */
    admin?: boolean;
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

/** True if `auth` is the person for CRM_ADMIN_EMAIL. */
export const isAdmin = (auth: Auth) => {
  const admin = normalizeEmail(process.env.CRM_ADMIN_EMAIL);
  return admin !== '' && normalizeEmail(auth.email) === admin;
};

/** True if the person has one or more passkeys. */
export const hasPasskey = (db: Database, personId: string) =>
  db
    .query('SELECT 1 FROM passkey WHERE person_id = ? LIMIT 1;')
    .get(personId) !== null;

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

/** Set the session cookie to the raw `token`, for `seconds`. */
const setSessionCookie = (
  reply: FastifyReply,
  token: string,
  seconds: number,
) =>
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: seconds,
  });

/**
 * Start a session for `personId`: a session row with the token hash, and the
 * cookie with the raw token. `how` is the sign-in step. A link or a code
 * gives an `email` session. A recovery session lasts RECOVERY_MINUTES, and
 * the others last SESSION_DAYS. The new session replaces the current session
 * of the request, if there is one: this function deletes its row. Returns
 * the session id.
 */
export const startSession = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  personId: string,
  how: 'link' | 'code' | 'passkey' | 'recovery',
) => {
  const method: SessionMethod =
    how === 'link' || how === 'code' ? 'email' : how;
  const seconds =
    method === 'recovery' ? RECOVERY_MINUTES * 60 : SESSION_DAYS * 24 * 60 * 60;
  const token = newToken();
  const sessionId = crypto.randomUUID();
  db.query(
    'INSERT INTO session (id, person_id, token_hash, user_agent, expires_at, method) VALUES (?, ?, ?, ?, ?, ?);',
  ).run(
    sessionId,
    personId,
    hash(token),
    request.headers['user-agent'] ?? null,
    later(seconds * 1000),
    method,
  );
  setSessionCookie(reply, token, seconds);
  const replaced = request.auth?.sessionId;
  if (replaced) {
    db.query('DELETE FROM session WHERE id = ?;').run(replaced);
  }
  audit(db, personId, 'sign_in', 'session', sessionId, {
    method: how,
    ...(replaced ? { replaced } : {}),
  });
  return sessionId;
};

/**
 * Make the current session a `passkey` session. Call it after the person
 * adds their first passkey in this session. The WebAuthn registration with
 * user verification proves the authenticator, and this session was already
 * trusted to add the first passkey. So the person does not sign out and sign
 * in again. The session gets a new token (the old cookie stops working) and
 * lasts SESSION_DAYS from now. Adds a `session_upgrade` row to `audit_log`.
 */
export const upgradeSession = (
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const auth = request.auth;
  if (!auth || auth.method === 'passkey') return;
  const seconds = SESSION_DAYS * 24 * 60 * 60;
  const token = newToken();
  db.query(
    `UPDATE session SET token_hash = ?, method = 'passkey', expires_at = ?
     WHERE id = ?;`,
  ).run(hash(token), later(seconds * 1000), auth.sessionId);
  setSessionCookie(reply, token, seconds);
  audit(db, auth.personId, 'session_upgrade', 'session', auth.sessionId, {
    from: auth.method,
    to: 'passkey',
  });
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
      `SELECT session.id AS sessionId, person.id AS personId,
         person.email AS email, session.method AS method
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
 * 4. Sends a recovery session to `/account/passkeys` from each path that is
 *    not in RECOVERY_PATHS.
 * 5. On an admin route (`config: { admin: true }`), lets only the admin in a
 *    passkey session through. Each other session gets the 403 page of
 *    `ui/AdminOnly.tsx` at the same URL, with no redirect. For the admin, the
 *    page holds the passkey step: add the first passkey, or sign in with a
 *    passkey.
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

    const auth = findSession(db, request.cookies[SESSION_COOKIE]);
    request.auth = auth;
    const path = request.url.split('?')[0];
    const open = PUBLIC_PATHS.has(path) || path.startsWith('/static/');
    if (!auth) {
      if (open) {
        done();
      } else if (path.startsWith('/api/')) {
        reply.code(401).send({ error: 'Sign in first.' });
      } else {
        const next =
          request.method === 'GET' && request.url !== '/'
            ? `?next=${encodeURIComponent(request.url)}`
            : '';
        reply.redirect(`/login${next}`, 303);
      }
      return;
    }

    if (auth.method === 'recovery' && !open && !RECOVERY_PATHS.has(path)) {
      if (path.startsWith('/api/')) {
        reply
          .code(403)
          .send({ error: 'A recovery session can only add a passkey.' });
      } else {
        reply.redirect('/account/passkeys', 303);
      }
      return;
    }

    const admin = isAdmin(auth);
    if (
      request.routeOptions.config?.admin &&
      !(admin && auth.method === 'passkey')
    ) {
      const need = !admin
        ? 'admin'
        : hasPasskey(db, auth.personId)
          ? 'passkey-sign-in'
          : 'add-passkey';
      reply
        .code(403)
        .type('text/html; charset=utf-8')
        .send(renderAdminOnly(request, need));
      return;
    }
    done();
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
