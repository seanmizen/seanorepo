import type { UserRole } from '@shared/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isSessionValid } from '../services/session';

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
}

type AuthedRequest = FastifyRequest & { authUser?: AuthUser };

/**
 * Resolve the caller, replying with a 401 and returning null if they can't be.
 *
 * Guards compose on the return value rather than `reply.sent`. A Fastify v5
 * async hook must also RETURN the reply to halt the lifecycle — merely
 * awaiting `reply.send()` lets the handler run and send a second time, which
 * throws ERR_HTTP_HEADERS_SENT.
 */
async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  { allowAnonymous = false }: { allowAnonymous?: boolean } = {},
): Promise<AuthUser | null> {
  const token = request.cookies.token;
  if (!token) {
    // No credentials at all is a legitimate state on this site — buyers browse
    // signed-out. Callers that need a user say so by not passing allowAnonymous.
    if (!allowAnonymous) {
      await reply.status(401).send({ error: 'Authentication required' });
    }
    return null;
  }

  let decoded: AuthUser;
  try {
    decoded = request.server.jwt.verify<AuthUser>(token);
  } catch {
    reply.clearCookie('token', { path: '/' });
    await reply.status(401).send({ error: 'Invalid or expired session' });
    return null;
  }

  // The signature proves the token is ours; the session lookup proves it has
  // not been revoked. Without the second check, logout would be cosmetic.
  if (!(await isSessionValid(token))) {
    reply.clearCookie('token', { path: '/' });
    await reply
      .status(401)
      .send({ error: 'Session expired or revoked. Please sign in again.' });
    return null;
  }

  (request as AuthedRequest).authUser = decoded;
  return decoded;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const user = await authenticate(request, reply);
  // Returning the reply halts the lifecycle; returning undefined continues it.
  return user ? undefined : reply;
}

/** Attach to an encapsulated scope so child routes are protected structurally. */
export function requireRole(...roles: UserRole[]) {
  return async function guard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    const user = await authenticate(request, reply);
    if (!user) return reply; // authenticate already replied 401

    if (!roles.includes(user.role)) {
      await reply.status(403).send({ error: 'Insufficient permissions' });
      return reply;
    }
    return undefined;
  };
}

export const requireAdmin = requireRole('admin');

/**
 * Populate `authUser` when the caller has a valid session, without demanding
 * one. Credentials that are present but bad are still rejected — that is a
 * real error worth surfacing, unlike simply being signed out.
 *
 * Used by the boot-time "who am I" check, which every anonymous visitor makes.
 * Answering 401 there would log a console error on every anonymous page load.
 */
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  const token = request.cookies.token;
  await authenticate(request, reply, { allowAnonymous: true });
  // authenticate only replies when a token was present and failed.
  return token && !getAuthUser(request) ? reply : undefined;
}

export const getAuthUser = (request: FastifyRequest): AuthUser | undefined =>
  (request as AuthedRequest).authUser;
