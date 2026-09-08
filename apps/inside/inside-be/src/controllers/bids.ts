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

const readBidFields = (body: unknown): briefs.BidFields => {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    message: requiredString(b.message, 'Message', 4000),
    // The designer's own read of the budget, which may differ from the brief's.
    budgetBand: optionalEnum(b.budgetBand, 'Budget band', BUDGET_BANDS),
    availability: optionalEnum(b.availability, 'Availability', AVAILABILITIES),
  };
};

export async function bidRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * The designer's side of post-a-project.
   *
   * An encapsulated scope with the role guard as an onRequest hook, so both
   * routes are protected by construction. A buyer gets a 403 here: bidding is
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
    scope.post('/briefs/:id/bids', async (request, reply) =>
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
        // An unpublished brief is not on the board, so it must read as missing
        // rather than as closed — the latter would confirm it exists.
        if (!brief || brief.publishedAt === null) {
          return reply.status(404).send({ error: 'Brief not found' });
        }
        if (!briefs.acceptsBids(brief)) {
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

        const existing = await briefs.findBid(brief.id, profile.id);
        if (existing && existing.status !== 'draft') {
          return reply
            .status(409)
            .send({ error: 'You have already bid for this brief' });
        }
        if (existing) {
          // Continue where they left off.
          return reply.send({ bid: existing });
        }

        const fields = readBidFields(request.body);

        try {
          const bid = await briefs.insertBid(brief.id, profile.id, fields);
          return reply.status(201).send({ bid });
        } catch (error) {
          // The check above loses a race between two concurrent starts. The
          // UNIQUE constraint catches it. Answer the same 409 rather than
          // letting raw SQLite text out as a 500.
          if (briefs.isDuplicateBidError(error)) {
            return reply
              .status(409)
              .send({ error: 'You have already bid for this brief' });
          }
          throw error;
        }
      }),
    );

    /** Resolve a bid only if it belongs to the caller. */
    const ownedBid = async (request: FastifyRequest, bidId: number) => {
      const profile = await profileOf(request);
      if (!profile) return null;
      const bid = await briefs.findBidById(bidId);
      // Same 404 for "missing" and "someone else's", so ids are not probeable.
      return bid && bid.designerProfileId === profile.id ? bid : null;
    };

    /** Edit a bid while it is still a draft. */
    scope.put('/me/bids/:id', async (request, reply) =>
      withValidation(reply, async () => {
        const bidId = Number((request.params as { id: string }).id);
        const bid = await ownedBid(request, bidId);
        if (!bid) return reply.status(404).send({ error: 'Not found' });
        if (bid.status !== 'draft') {
          return reply
            .status(409)
            .send({ error: 'A bid can only be edited while it is a draft' });
        }
        const fields = readBidFields(request.body);
        return { bid: await briefs.updateBid(bidId, fields) };
      }),
    );

    /** Send it. Draft -> submitted, once. */
    scope.post('/me/bids/:id/submit', async (request, reply) => {
      const bidId = Number((request.params as { id: string }).id);
      const bid = await ownedBid(request, bidId);
      if (!bid) return reply.status(404).send({ error: 'Not found' });
      if (bid.status !== 'draft') {
        return reply
          .status(409)
          .send({ error: 'This bid has already been sent' });
      }

      // The brief can close while a draft sits unsent, so the same gate that
      // guards starting a bid has to guard sending one.
      const brief = await briefs.findBrief(bid.briefId);
      if (!brief || !briefs.acceptsBids(brief)) {
        return reply
          .status(409)
          .send({ error: 'This brief is no longer accepting bids' });
      }
      if (brief.closesAt && brief.closesAt <= sqliteNow()) {
        return reply
          .status(409)
          .send({ error: 'This brief has passed its closing date' });
      }

      return { bid: await briefs.submitBid(bidId) };
    });

    /** The caller's own bids, and only ever their own. */
    scope.get('/me/bids', async (request, reply) => {
      const profile = await profileOf(request);
      if (!profile) {
        return reply.status(404).send({ error: 'No profile yet' });
      }
      return { bids: await briefs.listBidsByDesigner(profile.id) };
    });
  });
}
