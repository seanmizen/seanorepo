import type { FastifyInstance } from 'fastify';
import { getAuthUser, requireRole } from '../middleware/auth';
import * as designers from '../services/designers';
import { uniqueSlug } from '../services/slugs';
import {
  AVAILABILITIES,
  BUDGET_BANDS,
  optionalEnum,
  optionalString,
  optionalUrl,
  optionalYear,
  PROJECT_TYPES,
  requiredString,
  ValidationError,
} from '../services/validation';
import { withValidation } from './helpers';

const readProfileFields = (body: unknown) => {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    studioName: requiredString(b.studioName, 'Studio name', 120),
    headline: optionalString(b.headline, 'Headline', 200),
    bio: optionalString(b.bio, 'Bio', 4000),
    location: optionalString(b.location, 'Location', 120),
    websiteUrl: optionalUrl(b.websiteUrl, 'Website'),
    instagramUrl: optionalUrl(b.instagramUrl, 'Instagram'),
    budgetBand: optionalEnum(b.budgetBand, 'Budget band', BUDGET_BANDS),
    // Drives the "who can start soon" discovery filter.
    availability: optionalEnum(b.availability, 'Availability', AVAILABILITIES),
  };
};

const readProjectFields = (body: unknown) => {
  const b = (body ?? {}) as Record<string, unknown>;
  const status = optionalEnum(b.status, 'Status', ['draft', 'published']);
  return {
    title: requiredString(b.title, 'Title', 160),
    summary: optionalString(b.summary, 'Summary', 300),
    description: optionalString(b.description, 'Description', 6000),
    location: optionalString(b.location, 'Location', 120),
    projectType: optionalEnum(b.projectType, 'Project type', PROJECT_TYPES),
    budgetBand: optionalEnum(b.budgetBand, 'Budget band', BUDGET_BANDS),
    completedYear: optionalYear(b.completedYear, 'Completed year'),
    status: status ?? 'draft',
  };
};

export async function designerRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Public profile. Approved only, and a non-approved slug 404s rather than
   * 403s — otherwise the response tells a stranger the profile exists and is
   * merely unapproved, which leaks the pipeline.
   */
  fastify.get('/designers/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const profile = await designers.findApprovedProfileBySlug(slug);
    if (!profile) {
      return reply.status(404).send({ error: 'Designer not found' });
    }
    const projects = await designers.listProjects(profile.id, {
      publishedOnly: true,
    });
    return { profile, projects };
  });

  /**
   * Everything a signed-in designer manages about themselves.
   *
   * An encapsulated scope with the role guard as an onRequest hook, so every
   * route below is protected by construction. Ownership is resolved from the
   * session — never from a path or body parameter — so one designer cannot
   * address another's rows at all.
   */
  fastify.register(
    async (me) => {
      me.addHook('onRequest', requireRole('designer'));

      const profileOf = async (request: Parameters<typeof getAuthUser>[0]) =>
        designers.findProfileByUserId(getAuthUser(request)?.id as number);

      me.get('/profile', async (request, reply) => {
        const profile = await profileOf(request);
        if (!profile) {
          return reply.status(404).send({ error: 'No profile yet' });
        }
        return { profile };
      });

      me.post('/profile', async (request, reply) =>
        withValidation(reply, async () => {
          if (await profileOf(request)) {
            return reply
              .status(409)
              .send({ error: 'You already have a profile' });
          }
          const fields = readProfileFields(request.body);
          const slug = await uniqueSlug('designer_profiles', fields.studioName);
          const profile = await designers.insertProfile(
            getAuthUser(request)?.id as number,
            slug,
            fields,
          );
          return reply.status(201).send({ profile });
        }),
      );

      /**
       * Edits to an approved profile stay live rather than dropping it back to
       * pending. Re-reviewing every typo would build an admin queue nobody can
       * keep up with, and the approval gate exists to vet who is listed, not to
       * proofread. The slug is deliberately NOT regenerated here: once a
       * profile is public its URL is shared and indexed, so it must be stable.
       */
      me.put('/profile', async (request, reply) =>
        withValidation(reply, async () => {
          const existing = await profileOf(request);
          if (!existing) {
            return reply.status(404).send({ error: 'No profile yet' });
          }
          const profile = await designers.updateProfile(
            existing.id,
            readProfileFields(request.body),
          );
          return { profile };
        }),
      );

      me.post('/profile/submit', async (request, reply) => {
        const existing = await profileOf(request);
        if (!existing) {
          return reply.status(404).send({ error: 'No profile yet' });
        }
        if (existing.status === 'pending') {
          return reply
            .status(409)
            .send({ error: 'Your profile is already awaiting review' });
        }
        if (existing.status === 'approved') {
          return reply
            .status(409)
            .send({ error: 'Your profile is already approved' });
        }
        return { profile: await designers.submitProfileForReview(existing.id) };
      });

      me.get('/projects', async (request, reply) => {
        const profile = await profileOf(request);
        if (!profile) {
          return reply.status(404).send({ error: 'No profile yet' });
        }
        return { projects: await designers.listProjects(profile.id) };
      });

      me.post('/projects', async (request, reply) =>
        withValidation(reply, async () => {
          const profile = await profileOf(request);
          if (!profile) {
            return reply.status(404).send({ error: 'No profile yet' });
          }
          const fields = readProjectFields(request.body);
          const slug = await uniqueSlug('projects', fields.title);
          const project = await designers.insertProject(
            profile.id,
            slug,
            fields,
          );
          return reply.status(201).send({ project });
        }),
      );

      /** Resolves a project only if it belongs to the caller. */
      const ownedProject = async (
        request: Parameters<typeof getAuthUser>[0],
        id: number,
      ) => {
        const profile = await profileOf(request);
        if (!profile) return null;
        const project = await designers.findProject(id);
        // Same 404 for "missing" and "someone else's", so ids are not probeable.
        return project && project.designerProfileId === profile.id
          ? project
          : null;
      };

      me.get('/projects/:id', async (request, reply) => {
        const id = Number((request.params as { id: string }).id);
        const project = await ownedProject(request, id);
        if (!project) return reply.status(404).send({ error: 'Not found' });
        return {
          project,
          images: await designers.listProjectImages(project.id),
        };
      });

      me.put('/projects/:id', async (request, reply) =>
        withValidation(reply, async () => {
          const id = Number((request.params as { id: string }).id);
          const project = await ownedProject(request, id);
          if (!project) return reply.status(404).send({ error: 'Not found' });

          const body = (request.body ?? {}) as Record<string, unknown>;
          const displayOrder =
            body.displayOrder === undefined
              ? project.displayOrder
              : Number(body.displayOrder);
          if (!Number.isInteger(displayOrder) || displayOrder < 0) {
            throw new ValidationError('Display order must be a whole number');
          }

          return {
            project: await designers.updateProject(id, {
              ...readProjectFields(body),
              displayOrder,
            }),
          };
        }),
      );

      me.delete('/projects/:id', async (request, reply) => {
        const id = Number((request.params as { id: string }).id);
        const project = await ownedProject(request, id);
        if (!project) return reply.status(404).send({ error: 'Not found' });
        await designers.deleteProject(id);
        return reply.status(204).send();
      });

      /** Replaces the image list; array order becomes display order. */
      me.put('/projects/:id/images', async (request, reply) =>
        withValidation(reply, async () => {
          const id = Number((request.params as { id: string }).id);
          const project = await ownedProject(request, id);
          if (!project) return reply.status(404).send({ error: 'Not found' });

          const body = (request.body ?? {}) as { images?: unknown };
          if (!Array.isArray(body.images)) {
            throw new ValidationError('images must be an array');
          }

          const seen = new Set<number>();
          const images = body.images.map((entry, index) => {
            const e = (entry ?? {}) as Record<string, unknown>;
            const imageId = Number(e.imageId);
            if (!Number.isInteger(imageId) || imageId <= 0) {
              throw new ValidationError(
                `images[${index}].imageId must be an image id`,
              );
            }
            if (seen.has(imageId)) {
              throw new ValidationError(
                'The same image cannot appear twice in one project',
              );
            }
            seen.add(imageId);
            return {
              imageId,
              caption: optionalString(e.caption, 'Caption', 300),
            };
          });

          try {
            return { images: await designers.setProjectImages(id, images) };
          } catch {
            // The only realistic failure is an image id that does not exist,
            // which the foreign key rejects.
            throw new ValidationError('One or more images could not be found');
          }
        }),
      );
    },
    { prefix: '/me' },
  );
}
