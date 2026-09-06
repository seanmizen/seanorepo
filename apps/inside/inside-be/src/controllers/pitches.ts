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
     * Start a bid on a brief, or pick up the one already in progress.
     *
     * Deliberately idempotent. "Start creating a bid" and "continue the bid
     * you had in draft" are the same button to the designer, so they are the
     * same call here: if a draft exists it comes back, rather than the UI
     * having to know which state it is in and pick an endpoint. A bid that has
     * already been sent is the one case that refuses, because re-sending is a
     * different act from drafting.
     *
     * The approval gate is the whole point of the designer review queue: an
     * unapproved studio is invisible in discovery, so letting one bid would
     * route around the gate and put an unvetted studio in a buyer's inbox.
     */
    scope.post('/briefs/:id/pitches', async (request, reply) =>
      withValidation(reply, async () => {
        const profile = await profileOf(request);
        if (!profile) {
          return reply
            .status(403)
            .send({ error: 'Create a designer profile before bidding' });
        }
        if (profile.status !== 'approved') {
          return reply.status(403).send({
            error: 'Your profile must be approved before you can bid',
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
            .send({ error: 'This brief is no longer accepting bids' });
        }
        // The soft deadline closes the listing without anyone touching it.
        if (brief.closesAt && brief.closesAt <= sqliteNow()) {
          return reply
            .status(409)
            .send({ error: 'This brief has passed its closing date' });
        }

        const existing = await briefs.findPitch(brief.id, profile.id);
        if (existing && existing.status !== 'draft') {
          return reply
            .status(409)
            .send({ error: 'You have already bid for this brief' });
        }
        if (existing) {
          // Continue where they left off.
          return reply.send({ pitch: existing });
        }

        const fields = readPitchFields(request.body);

        try {
          const pitch = await briefs.insertPitch(brief.id, profile.id, fields);
          return reply.status(201).send({ pitch });
        } catch (error) {
          // The check above loses a race between two concurrent starts; the
          // UNIQUE constraint catches it. Answer the same 409 rather than
          // letting raw SQLite text out as a 500.
          if (briefs.isDuplicatePitchError(error)) {
            return reply
              .status(409)
              .send({ error: 'You have already bid for this brief' });
          }
          throw error;
        }
      }),
    );

    /** Resolve a bid only if it belongs to the caller. */
    const ownedPitch = async (request: FastifyRequest, pitchId: number) => {
      const profile = await profileOf(request);
      if (!profile) return null;
      const pitch = await briefs.findPitchById(pitchId);
      // Same 404 for "missing" and "someone else's", so ids are not probeable.
      return pitch && pitch.designerProfileId === profile.id ? pitch : null;
    };

    /** Edit a bid while it is still a draft. */
    scope.put('/me/pitches/:id', async (request, reply) =>
      withValidation(reply, async () => {
        const pitchId = Number((request.params as { id: string }).id);
        const pitch = await ownedPitch(request, pitchId);
        if (!pitch) return reply.status(404).send({ error: 'Not found' });
        if (pitch.status !== 'draft') {
          return reply
            .status(409)
            .send({ error: 'A bid can only be edited while it is a draft' });
        }
        const fields = readPitchFields(request.body);
        return { pitch: await briefs.updatePitch(pitchId, fields) };
      }),
    );

    /** Send it. Draft -> submitted, once. */
    scope.post('/me/pitches/:id/submit', async (request, reply) => {
      const pitchId = Number((request.params as { id: string }).id);
      const pitch = await ownedPitch(request, pitchId);
      if (!pitch) return reply.status(404).send({ error: 'Not found' });
      if (pitch.status !== 'draft') {
        return reply
          .status(409)
          .send({ error: 'This bid has already been sent' });
      }

      // The brief can close while a draft sits unsent, so the same gate that
      // guards starting a bid has to guard sending one.
      const brief = await briefs.findBrief(pitch.briefId);
      if (!brief || brief.status !== 'open') {
        return reply
          .status(409)
          .send({ error: 'This brief is no longer accepting bids' });
      }
      if (brief.closesAt && brief.closesAt <= sqliteNow()) {
        return reply
          .status(409)
          .send({ error: 'This brief has passed its closing date' });
      }

      return { pitch: await briefs.submitPitch(pitchId) };
    });

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
