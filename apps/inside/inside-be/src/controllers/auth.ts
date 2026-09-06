import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getAuthUser, optionalAuth } from '../middleware/auth';
import {
  createMagicToken,
  isSignupRole,
  isValidEmail,
  type SignupRole,
  verifyMagicToken,
} from '../services/auth';
import { sendMagicLinkEmail } from '../services/email';
import {
  createSession,
  revokeSession,
  SESSION_TTL_SECONDS,
} from '../services/session';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:4060';
const BYPASS_EMAIL =
  process.env.DANGEROUS_BYPASS_EMAIL_MAGIC_LINK === 'true' &&
  process.env.NODE_ENV !== 'production';

/**
 * Where to send the user after verifying.
 *
 * Only same-site relative paths are allowed. Without this an attacker can send
 * `?returnTo=https://evil.example` and turn our verified-login redirect into a
 * credible phishing hop. `//evil.example` is a protocol-relative URL, so the
 * leading-slash check alone is not enough.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  return value;
}

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Matches the session row's TTL exactly — see services/session.ts.
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Request a magic link.
   *
   * Always answers the same way whether or not the address is known, so this
   * cannot be used to enumerate who has an account.
   */
  fastify.post('/magic-link', async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: unknown;
      role?: unknown;
      returnTo?: unknown;
    };

    if (typeof body.email !== 'string' || !isValidEmail(body.email)) {
      return reply.status(400).send({ error: 'A valid email is required' });
    }

    // `admin` is not offered here — it comes only from the ADMIN_EMAILS
    // whitelist, so the signup payload cannot be used to escalate.
    const role: SignupRole = isSignupRole(body.role) ? body.role : 'buyer';
    const returnTo = safeReturnTo(body.returnTo);

    const { token } = await createMagicToken(body.email, role);
    const link = `${FRONTEND_URL}/verify?token=${token}&returnTo=${encodeURIComponent(returnTo)}`;

    if (BYPASS_EMAIL) {
      fastify.log.warn(
        '⚠️  DANGEROUS_BYPASS_EMAIL_MAGIC_LINK is on — returning the link in the response instead of emailing it.',
      );
      return reply.send({ sent: true, devLink: link });
    }

    try {
      await sendMagicLinkEmail(body.email, link);
    } catch (error) {
      fastify.log.error({ error }, 'Failed to send magic link email');
      return reply.status(502).send({
        error: 'Could not send the sign-in email. Try again shortly.',
      });
    }

    return reply.send({ sent: true });
  });

  /** Consume the token, start a session, set the cookie. */
  fastify.get('/verify', async (request, reply) => {
    const query = request.query as { token?: string; returnTo?: string };

    if (!query.token) {
      return reply.status(400).send({ error: 'Token is required' });
    }

    const user = await verifyMagicToken(query.token);
    if (!user) {
      return reply
        .status(401)
        .send({ error: 'This sign-in link is invalid, used, or expired' });
    }

    const jwt = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      // A per-login nonce. Without it, two sign-ins for the same user within
      // the same second produce byte-identical JWTs (same payload, same `iat`),
      // so the UNIQUE token_hash rejects the second session — which a user
      // hits by double-clicking their link or signing in on a second device.
      jti: randomUUID(),
    });
    await createSession(user.id, jwt);
    setSessionCookie(reply, jwt);

    return reply.send({ user, returnTo: safeReturnTo(query.returnTo) });
  });

  /**
   * Who am I? Answers 200 with `user: null` when signed out, because every
   * anonymous visitor calls this on page load and that is not an error.
   * A cookie that is present but invalid or revoked still 401s.
   */
  fastify.get('/me', { onRequest: optionalAuth }, async (request) => ({
    user: getAuthUser(request) ?? null,
  }));

  /** Revokes server-side, so the cookie is dead even if it is replayed. */
  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies.token;
    if (token) await revokeSession(token);
    reply.clearCookie('token', { path: '/' });
    return reply.send({ ok: true });
  });
}
