import type { UserRole } from '@shared/types';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthUser {
  id: number;
  email: string;
  role: UserRole;
}

/**
 * Verify the JWT cookie and attach the caller to the request.
 *
 * Session revocation checks land alongside the magic-link implementation in
 * SEAN-145. Until then no cookie is ever issued, so this correctly rejects
 * everyone — the admin scope in `controllers/index.ts` is closed by default.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = request.cookies.token;
  if (!token) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  try {
    const decoded = request.server.jwt.verify<AuthUser>(token);
    (request as FastifyRequest & { authUser?: AuthUser }).authUser = decoded;
  } catch {
    reply.clearCookie('token', { path: '/' });
    return reply.status(401).send({ error: 'Invalid or expired session' });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const user = (request as FastifyRequest & { authUser?: AuthUser }).authUser;
  if (user?.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}
