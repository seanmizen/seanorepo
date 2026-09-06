import type { FastifyReply } from 'fastify';
import { ValidationError } from '../services/validation';

/**
 * Turns a ValidationError into a 400; anything else keeps bubbling.
 *
 * Lives in the controller layer, not in `services/validation.ts`, so the
 * validators stay free of any knowledge of HTTP.
 */
export async function withValidation<T>(
  reply: FastifyReply,
  run: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ValidationError) {
      await reply.status(400).send({ error: error.message });
      return undefined;
    }
    throw error;
  }
}
