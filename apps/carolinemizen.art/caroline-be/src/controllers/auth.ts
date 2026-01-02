import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as authService from '../services/auth';
import * as emailService from '../services/email';
import * as sessionService from '../services/session';

interface MagicLinkBody {
  email: string;
}

interface VerifyQuery {
  token: string;
}

export async function authRoutes(fastify: FastifyInstance) {
  /**
   * POST /auth/magic-link
   * Send a magic link email for passwordless login
   * If DANGEROUS_BYPASS_EMAIL_MAGIC_LINK is enabled, skip email and authenticate directly
   */
  fastify.post<{ Body: MagicLinkBody }>(
    '/magic-link',
    async (
      request: FastifyRequest<{ Body: MagicLinkBody }>,
      reply: FastifyReply,
    ) => {
      const { email } = request.body;

      if (!email || !email.includes('@')) {
        return reply.status(400).send({ error: 'Valid email is required' });
      }

      try {
        // Generate magic token
        const { token } = await authService.createMagicToken(email);

        // DANGEROUS: Bypass email in development
        if (process.env.DANGEROUS_BYPASS_EMAIL_MAGIC_LINK === 'true') {
          console.warn(
            '⚠️  DANGEROUS_BYPASS_EMAIL_MAGIC_LINK is enabled - skipping email, authenticating directly',
          );

          // Verify the token immediately (marks it as used)
          const user = await authService.verifyMagicToken(token);

          if (!user) {
            return reply.status(500).send({ error: 'Failed to authenticate' });
          }

          // Generate JWT
          const jwtToken = fastify.jwt.sign({
            id: user.id,
            email: user.email,
            role: user.role,
          });

          // Create session in database
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          await sessionService.createSession(user.id, jwtToken, expiresAt);

          // Set cookie
          reply.setCookie('token', jwtToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60, // 7 days
          });

          return reply.send({
            message: 'Authenticated successfully (email bypassed)',
            user: {
              id: user.id,
              email: user.email,
              role: user.role,
            },
          });
        }

        // Normal flow: Send email
        await emailService.sendMagicLinkEmail({ to: email, token });

        return reply.send({
          message: 'Magic link sent to your email. Please check your inbox.',
        });
      } catch (error) {
        console.error('Error sending magic link:', error);
        return reply.status(500).send({
          error: 'Failed to send magic link. Please try again.',
        });
      }
    },
  );

  /**
   * GET /auth/verify?token=xxx
   * Verify magic link token and set JWT cookie
   */
  fastify.get<{ Querystring: VerifyQuery }>(
    '/verify',
    async (
      request: FastifyRequest<{ Querystring: VerifyQuery }>,
      reply: FastifyReply,
    ) => {
      const { token } = request.query;

      if (!token) {
        return reply.status(400).send({ error: 'Token is required' });
      }

      try {
        const user = await authService.verifyMagicToken(token);

        if (!user) {
          return reply.status(401).send({
            error: 'Invalid or expired token',
          });
        }

        // Generate JWT
        const jwtToken = fastify.jwt.sign({
          id: user.id,
          email: user.email,
          role: user.role,
        });

        // Create session in database
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await sessionService.createSession(user.id, jwtToken, expiresAt);

        // Set cookie
        reply.setCookie('token', jwtToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return reply.send({
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
          },
        });
      } catch (error) {
        console.error('Error verifying magic token:', error);
        return reply.status(500).send({
          error: 'Failed to verify token. Please try again.',
        });
      }
    },
  );

  /**
   * POST /auth/logout
   * Revoke session and clear JWT cookie
   */
  fastify.post(
    '/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.cookies.token;

      // Revoke session if token exists
      if (token) {
        try {
          await sessionService.revokeSession(token);
        } catch (error) {
          console.error('Error revoking session:', error);
          // Continue with logout even if revocation fails
        }
      }

      reply.clearCookie('token', { path: '/' });
      return reply.send({ message: 'Logged out successfully' });
    },
  );

  /**
   * GET /auth/me
   * Get current authenticated user (checks session validity)
   */
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = request.cookies.token;

      if (!token) {
        return reply.status(401).send({ error: 'Not authenticated' });
      }

      // Verify JWT signature
      const decoded = fastify.jwt.verify<{
        id: number;
        email: string;
        role: string;
      }>(token);

      // Check if session is still valid (not revoked)
      const session = await sessionService.validateSession(token);
      if (!session) {
        // Session was revoked or expired
        reply.clearCookie('token', { path: '/' });
        return reply.status(401).send({ error: 'Session expired or revoked' });
      }

      return reply.send({
        user: {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
        },
      });
    } catch (_error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });
}
