// direct DB access controller

import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { dbService, userService } from '../services';

/**
 * I don't have to tell you this is unsafe
 */
const executeQuery = async (request: FastifyRequest, reply: FastifyReply) => {
  const sql = request.body as string;
  try {
    const rows = await dbService.executeQuery(sql);
    reply.send(rows);
  } catch (err) {
    reply.status(500).send(err);
  }
};

const testDbConnection = async (
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  const result = await dbService.testDbConnection();
  reply.send(result);
};

const getUsers = async (request: FastifyRequest, reply: FastifyReply) => {
  const limit = request.body as number;
  const users = await userService.getUsers(limit);
  reply.send(users);
};

const seedDatabase = async () => {
  await dbService.seedDatabase();
};
const resetDatabase = async () => {
  await dbService.resetDatabase();
};

const routes = async (
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) => {
  fastify.post('/', executeQuery);
  fastify.get('/test', testDbConnection);
  fastify.get('/', getUsers);
  fastify.post('/seed', seedDatabase);
  fastify.post('/reset', resetDatabase);
};

export { routes };
