// API layer
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { routes as databaseRoutes } from './db';
import { routes as userRoutes } from './users';

/**
 * encapsulates the routes
 */
const routes = async (
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) => {
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ hello: 'world' });
  });

  fastify.register(databaseRoutes, { prefix: '/db' });
  fastify.register(userRoutes, { prefix: '/users' });
};

export { routes };
