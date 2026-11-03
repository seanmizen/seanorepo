import type { Database } from 'bun:sqlite';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { handleMcp } from '../../mcp';
import {
  findConnection,
  MCP_PATH,
  MCP_URL,
  wwwAuthenticate,
} from '../../oauth';

/** The Fastify request as a web `Request`, for the SDK transport. */
const webRequest = (request: FastifyRequest) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  return new Request(MCP_URL, { method: request.method, headers });
};

/**
 * `/api/mcp`: the MCP server, over Streamable HTTP (`mcp.ts`). Each request
 * needs a bearer token of a connection (`findConnection` in `oauth.ts`):
 *
 * - No token, or a token that does not work: 401, with the
 *   `WWW-Authenticate` header that starts the OAuth sign-in of a client.
 * - A token of a person who is not the admin: 403. The check runs on each
 *   request, as on each admin route.
 * - The server is stateless, so it takes only POST. GET and DELETE get 405.
 */
export const mcpRoute = (app: FastifyInstance, db: Database) => {
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: MCP_PATH,
    handler: async (request, reply) => {
      const connection = findConnection(db, request.headers.authorization);
      if (!connection) {
        return reply
          .code(401)
          .header(
            'www-authenticate',
            wwwAuthenticate(
              request.headers.authorization ? 'invalid_token' : undefined,
            ),
          )
          .send({
            error: 'invalid_token',
            error_description:
              'Send a bearer token from /account/connections, or sign in with OAuth.',
          });
      }
      if (!connection.admin) {
        return reply.code(403).send({
          error: 'forbidden',
          error_description: 'Only the admin can use the MCP server.',
        });
      }
      if (request.method !== 'POST') {
        return reply.code(405).header('allow', 'POST').send({
          error: 'method_not_allowed',
          error_description: 'The MCP server takes only POST.',
        });
      }
      const response = await handleMcp(
        db,
        `mcp:${connection.name}`,
        webRequest(request),
        request.body,
      );
      reply.code(response.status);
      response.headers.forEach((value, name) => {
        reply.header(name, value);
      });
      return reply.send(response.body);
    },
  });
};
