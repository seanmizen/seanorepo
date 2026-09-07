import sharp from 'sharp';
import { insertBid, insertBrief } from './briefs';
import { openDbConnection } from './db';
import { insertProfile, insertProject, setProjectImages } from './designers';
import { isProduction } from './dev-mode';
import { addImage } from './image-library';
import { runMigrations } from './migrations';
import { BRIEFS, BUYERS, DESIGNERS, type SeedProject } from './seed-data';
import { chooseSlug, recordSlug } from './slugs';

export class RefusedInProductionError extends Error {}

/**
 * A recognisable placeholder image.
 *
 * Generated rather than committed, so the repository carries no binaries and
 * every seeded image goes through the real `services/images.ts` pipeline —
 * which means variants, srcset and the storage provider are all exercised by
 * seeding rather than only by tests.
 */
async function placeholder(colour: string): Promise<Buffer> {
  return sharp({
    create: { width: 1600, height: 1067, channels: 3, background: colour },
  })
    .jpeg({ quality: 70 })
    .toBuffer();
}

/**
 * Find-or-create, so seeding twice does not duplicate an account.
 *
 * Reports whether it created the row, so the summary counts what actually
 * happened rather than what was asked for.
 */
async function upsertUser(
  email: string,
  role: 'buyer' | 'designer' | 'admin',
): Promise<{ id: number; created: boolean }> {
  const db = await openDbConnection();
  try {
    const existing = db
      .query('SELECT id FROM users WHERE email = ?')
      .get(email) as { id: number } | null;
    if (existing) return { id: existing.id, created: false };

    db.run('INSERT INTO users (email, role) VALUES (?, ?)', [email, role]);
    const id = (
      db.query('SELECT last_insert_rowid() AS id').get() as { id: number }
    ).id;
    return { id, created: true };
  } finally {
    db.close();
  }
}

const profileFor = async (userId: number) => {
  const db = await openDbConnection();
  try {
    return db
      .query('SELECT id FROM designer_profiles WHERE user_id = ?')
      .get(userId) as { id: number } | null;
  } finally {
    db.close();
  }
};

async function setProfileStatus(
  id: number,
  status: string,
  note: string | null,
  reviewerId: number,
): Promise<void> {
  const db = await openDbConnection();
  try {
    const reviewed = status === 'approved' || status === 'rejected';
    db.run(
      `UPDATE designer_profiles
          SET status = ?, review_note = ?,
              reviewed_by = ?, reviewed_at = ?
        WHERE id = ?`,
      [
        status,
        note,
        reviewed ? reviewerId : null,
        reviewed ? new Date().toISOString() : null,
        id,
      ],
    );
  } finally {
    db.close();
  }
}

async function seedProject(
  profileId: number,
  ownerId: number,
  project: SeedProject,
): Promise<void> {
  const slug = await chooseSlug('portfolio_project', project.title);
  const created = await insertProject(profileId, slug, {
    title: project.title,
    summary: project.summary,
    description: `${project.summary} Seeded demo content.`,
    location: project.location,
    workType: project.workType,
    budgetBand: project.budgetBand,
    completedYear: project.completedYear,
    status: project.published === false ? 'draft' : 'published',
  });
  await recordSlug('portfolio_project', created.id, slug);

  const image = await addImage(
    ownerId,
    await placeholder(project.colour),
    `${slug}.jpg`,
    'image/jpeg',
    project.title,
  );
  await setProjectImages(created.id, [{ imageId: image.id, caption: null }]);
}

export interface SeedResult {
  designers: number;
  portfolioProjects: number;
  buyers: number;
  briefs: number;
  bids: number;
  skipped: boolean;
}

/**
 * Fill an empty database with a browsable marketplace.
 *
 * Idempotent: it finds-or-creates accounts and skips a designer who already
 * has a profile, so running it twice is safe and running it against a
 * partially seeded database completes rather than duplicates.
 *
 * Refuses to run in production. It writes fabricated accounts and fake
 * portfolio work, and doing that to real data would be destructive — so this
 * fails loudly rather than being merely discouraged, exactly like the
 * magic-link bypass and the missing-secret checks.
 */
export async function seed(): Promise<SeedResult> {
  if (isProduction(process.env.NODE_ENV)) {
    throw new RefusedInProductionError(
      'Refusing to seed: NODE_ENV=production. This writes fabricated accounts and demo content.',
    );
  }

  await runMigrations();

  const result: SeedResult = {
    designers: 0,
    portfolioProjects: 0,
    buyers: 0,
    briefs: 0,
    bids: 0,
    skipped: false,
  };

  // The reviewer recorded against approved and rejected profiles.
  const { id: adminId } = await upsertUser('admin@inside.test', 'admin');

  const approvedProfiles: Array<{ id: number }> = [];

  for (const designer of DESIGNERS) {
    const { id: userId } = await upsertUser(designer.email, 'designer');
    if (await profileFor(userId)) {
      result.skipped = true;
      const existing = await profileFor(userId);
      if (existing && designer.status === 'approved') {
        approvedProfiles.push(existing);
      }
      continue;
    }

    const slug = await chooseSlug('designer_profile', designer.studioName);
    const profile = await insertProfile(userId, slug, {
      studioName: designer.studioName,
      headline: designer.headline,
      bio: designer.bio,
      location: designer.location,
      websiteUrl: null,
      instagramUrl: null,
      budgetBand: designer.budgetBand,
      availability: designer.availability,
    });
    await recordSlug('designer_profile', profile.id, slug);
    result.designers += 1;

    for (const project of designer.projects) {
      await seedProject(profile.id, userId, project);
      result.portfolioProjects += 1;
    }

    await setProfileStatus(
      profile.id,
      designer.status,
      designer.reviewNote ?? null,
      adminId,
    );
    if (designer.status === 'approved') approvedProfiles.push(profile);
  }

  const buyerIds: number[] = [];
  for (const buyer of BUYERS) {
    const { id, created } = await upsertUser(buyer.email, 'buyer');
    buyerIds.push(id);
    if (created) result.buyers += 1;
    else result.skipped = true;
  }

  for (const [index, brief] of BRIEFS.entries()) {
    const buyerId = buyerIds[index % buyerIds.length];
    const db = await openDbConnection();
    const already = db
      .query('SELECT id FROM briefs WHERE title = ? AND buyer_id = ?')
      .get(brief.title, buyerId) as { id: number } | null;
    db.close();
    if (already) {
      result.skipped = true;
      continue;
    }

    const created = await insertBrief(
      buyerId,
      {
        title: brief.title,
        description: brief.description,
        workType: brief.workType,
        budgetBand: brief.budgetBand,
        location: brief.location,
        timeline: 'within_3_months',
        closesAt: null,
      },
      // Demo briefs that were 'open' become public and published; the rest
      // stay private and unpublished, which is what 'draft' meant.
      brief.status === 'open' ? 'public' : 'private',
      { publish: brief.status === 'open' },
    );
    result.briefs += 1;

    // One sent bid on the first open brief, so a buyer's inbox is not empty.
    if (brief.status === 'open' && approvedProfiles[0]) {
      const bid = await insertBid(created.id, approvedProfiles[0].id, {
        message:
          'We have done three houses on the same street and would love to see this one. Happy to visit before quoting.',
        budgetBand: brief.budgetBand,
        availability: 'within_3_months',
      });
      const db2 = await openDbConnection();
      db2.run(
        "UPDATE bids SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?",
        [bid.id],
      );
      db2.close();
      result.bids += 1;
    }
  }

  return result;
}
