import type { Database } from 'bun:sqlite';
import type { FastifyInstance } from 'fastify';
import { endSession } from '../auth';

/** `POST /logout`. Ends this session, then goes to `/login`. */
export const logoutRoute = (app: FastifyInstance, db: Database) => {
  app.post('/logout', async (request, reply) => {
    endSession(db, request, reply);
    return reply.redirect('/login', 303);
  });
};
