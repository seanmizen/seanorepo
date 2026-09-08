import type { FastifyReply } from 'fastify';
import type { z } from 'zod';

/**
 * Parse a query string against a shared filter schema, or answer 400.
 *
 * One place turns a schema failure into a message, so every endpoint rejects
 * the same way. Previously each controller had its own parser and its own
 * policy — one rejected out-of-range values, one accepted `"1e3"`, and one
 * silently clamped garbage to a default.
 *
 * Returns `null` when it has already replied, so the caller just returns.
 */
export async function parseQuery<T extends z.ZodType>(
  schema: T,
  reply: FastifyReply,
  query: unknown,
): Promise<z.infer<T> | null> {
  const result = schema.safeParse(query ?? {});
  if (result.success) return result.data;

  // The first issue is the useful one. A wall of them helps nobody, and the
  // path tells the caller which parameter to fix.
  const issue = result.error.issues[0];
  const field = issue.path.join('.') || 'query';
  await reply.status(400).send({ error: `${field}: ${issue.message}` });
  return null;
}
