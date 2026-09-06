import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getAuthUser, requireRole } from '../middleware/auth';
import * as briefs from '../services/briefs';
import { findProfileByUserId } from '../services/designers';
import {
  AVAILABILITIES,
  BUDGET_BANDS,
  optionalEnum,
  requiredString,
  sqliteNow,
} from '../services/validation';
import { withValidation } from './helpers';

const readPitchFields = (body: unknown): briefs.PitchFields => {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    message: requiredString(b.message, 'Message', 4000),
    // The designer's own read of the budget, which may differ from the brief's.
    budgetBand: optionalEnum(b.budgetBand, 'Budget band', BUDGET_BANDS),
    availability: optionalEnum(b.availability, 'Availability', AVAILABILITIES),
  };
};

export async function pitchRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * The designer's side of post-a-project.
   *
   * An encapsulated scope with the role guard as an onRequest hook, so both
   * routes are protected by construction. A buyer gets a 403 here: pitching is
   * the designer's side of the marketplace, exactly as posting a brief is the
   * buyer's.
   */
  fastify.register(async (scope) => {
    scope.addHook('onRequest', requireRole('designer'));

    const profileOf = async (request: FastifyRequest) =>
      findProfileByUserId(getAuthUser(request)?.id as number);

    /**
     * Respond to a brief.
     *
     * The approval gate is the whole point of the designer review queue: an
     * unapproved studio is invisible in discovery, so letting one pitch would
     * route around the gate and put an unvetted studio in a buyer's inbox.
     */
    scope.post('/briefs/:id/pitches', async (request, reply) =>
      withValidation(reply, async () => {
        const profile = await profileOf(request);
        if (!profile) {
          return reply
            .status(403)
            .send({ error: 'Create a designer profile before pitching' });
        }
        if (profile.status !== 'approved') {
          return reply.status(403).send({
            error: 'Your profile must be approved before you can pitch',
          });
        }

        const id = Number((request.params as { id: string }).id);
        const brief = await briefs.findBrief(id);
        // A draft brief is not on the board, so it must read as missing.
        if (!brief || brief.status === 'draft') {
          return reply.status(404).send({ error: 'Brief not found' });
        }
        if (brief.status !== 'open') {
          return reply
            .status(409)
            .send({ error: 'This brief is no longer accepting pitches' });
        }
        // The soft deadline closes the listing without anyone touching it.
        if (brief.closesAt && brief.closesAt <= sqliteNow()) {
          return reply
            .status(409)
            .send({ error: 'This brief has passed its closing date' });
        }

        const fields = readPitchFields(request.body);

        if (await briefs.findPitch(brief.id, profile.id)) {
          return reply
            .status(409)
            .send({ error: 'You have already pitched for this brief' });
        }

        try {
          const pitch = await briefs.insertPitch(brief.id, profile.id, fields);
          return reply.status(201).send({ pitch });
        } catch (error) {
          // The check above loses a race between two concurrent submissions;
          // the UNIQUE constraint catches it. Answer the same 409 rather than
          // letting raw SQLite text out as a 500.
          if (briefs.isDuplicatePitchError(error)) {
            return reply
              .status(409)
              .send({ error: 'You have already pitched for this brief' });
          }
          throw error;
        }
      }),
    );

    /** The caller's own pitches, and only ever their own. */
    scope.get('/me/pitches', async (request, reply) => {
      const profile = await profileOf(request);
      if (!profile) {
        return reply.status(404).send({ error: 'No profile yet' });
      }
      return { pitches: await briefs.listPitchesByDesigner(profile.id) };
    });
  });
}
