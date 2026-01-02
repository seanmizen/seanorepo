import type { FastifyReply, FastifyRequest } from 'fastify';
import * as sessionService from '../services/session';

export interface AuthUser {
  id: number;
  email: string;
  role: string;
}

/**
 * Auth middleware - verifies JWT token from cookie and checks session validity
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const token = request.cookies.token;

    if (!token) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    // Verify JWT signature
    const decoded = request.server.jwt.verify<AuthUser>(token);

    // Check if session is still valid (not revoked)
    const session = await sessionService.validateSession(token);
    if (!session) {
      // Session was revoked or expired
      reply.clearCookie('token', { path: '/' });
      return reply
        .status(401)
        .send({ error: 'Session expired or revoked. Please log in again.' });
    }

    // Attach user to request
    (request as { authUser?: AuthUser }).authUser = decoded;
  } catch (_error) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

/**
 * Admin-only middleware - requires admin role
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  await requireAuth(request, reply);

  // If reply was already sent by requireAuth, stop here
  if (reply.sent) {
    return;
  }

  const user = (request as { authUser?: AuthUser }).authUser;
  if (user?.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}
