import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

/**
 * The one error envelope. REQ-NET-005.
 *
 * Extracted from `index.ts` so it can be tested against a route that throws
 * without adding a route that throws to the real app.
 */
export interface ErrorEnvelope {
  error: string;
  requestId: string;
}

/**
 * What a 500 says to the client.
 *
 * Deliberately says nothing. Before this handler existed, an unrecognised
 * exception reached Fastify's default, which replies with `err.message` — and
 * the messages in question are SQLite constraint text, `sharp` decode
 * failures, and filesystem paths. The request id is what makes that
 * acceptable: the caller gets a reference, and the real error is in the log.
 */
export const GENERIC_5XX = 'Something went wrong at our end.';

/**
 * A 4xx keeps its message; a 5xx never does.
 *
 * The split is about authorship. Messages below 500 were written by us for the
 * caller to read — "Your studio needs a name", "That brief is no longer
 * accepting bids". A 500 message was written by a library, about our internals,
 * for us.
 */
export const errorHandler = (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply => {
  const status = error.statusCode ?? 500;

  if (status >= 500) {
    request.log.error(
      { err: error, reqId: request.id },
      'unhandled error serving request',
    );
    return reply
      .status(status)
      .send({ error: GENERIC_5XX, requestId: String(request.id) });
  }

  return reply
    .status(status)
    .send({ error: error.message, requestId: String(request.id) });
};

/**
 * An unmatched route, in the app's shape rather than Fastify's.
 *
 * Fastify's default answers `{ statusCode, error, message }`, which is a second
 * error shape a client would have to know about — and the client only learns it
 * exists by hitting a typo'd URL in production.
 */
export const notFoundHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply =>
  reply.status(404).send({ error: 'Not found', requestId: String(request.id) });
