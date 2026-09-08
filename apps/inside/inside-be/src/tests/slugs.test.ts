import { describe, expect, test } from 'bun:test';
import { getApp, uniqueEmail } from './setup';

// setup builds and migrates the app before anything below imports the services.
await getApp();

const {
  chooseSlug,
  claimSlug,
  isReservedSlug,
  recordSlug,
  resolveSlug,
  slugHistory,
  slugify,
  SlugRejected,
} = await import('../services/slugs');

const { openDbConnection } = await import('../services/db');

/** A designer profile row, created directly — these tests are about slugs. */
async function makeProfile(slug: string): Promise<number> {
  const db = await openDbConnection();
  try {
    db.run('INSERT INTO users (email, role) VALUES (?, ?)', [
      uniqueEmail('slug'),
      'designer',
    ]);
    const user = db.query('SELECT last_insert_rowid() AS id').get() as {
      id: number;
    };
    db.run(
      'INSERT INTO designer_profiles (user_id, slug, studio_name) VALUES (?, ?, ?)',
      [user.id, slug, `Studio ${slug}`],
    );
    const profile = db.query('SELECT last_insert_rowid() AS id').get() as {
      id: number;
    };
    await recordSlug('designer_profile', profile.id, slug);
    return profile.id;
  } finally {
    db.close();
  }
}

async function rename(id: number, desired: string): Promise<string> {
  const slug = await claimSlug('designer_profile', id, desired, {
    custom: true,
  });
  const db = await openDbConnection();
  try {
    db.run('UPDATE designer_profiles SET slug = ? WHERE id = ?', [slug, id]);
  } finally {
    db.close();
  }
  return slug;
}

describe('slugify', () => {
  test('strips diacritics rather than dropping the characters', () => {
    expect(slugify('Estúdio Ãosta')).toBe('estudio-aosta');
  });

  test('collapses punctuation and trims the edges', () => {
    expect(slugify('  --North & House!!  ')).toBe('north-house');
  });
});

describe('a slug, once issued, is permanent', () => {
  test('an old slug still resolves after a rename', async () => {
    const id = await makeProfile('slugtest-original');
    await rename(id, 'slugtest-renamed');

    const resolved = await resolveSlug('designer_profile', 'slugtest-original');
    expect(resolved).not.toBeNull();
    expect(resolved?.entityId).toBe(id);
    expect(resolved?.canonical).toBe('slugtest-renamed');
    expect(resolved?.moved).toBe(true);
  });

  test('the current slug resolves to itself and is not marked moved', async () => {
    const id = await makeProfile('slugtest-current');

    const resolved = await resolveSlug('designer_profile', 'slugtest-current');
    expect(resolved?.entityId).toBe(id);
    expect(resolved?.canonical).toBe('slugtest-current');
    expect(resolved?.moved).toBe(false);
  });

  test('a chain of renames all resolve to the NEWEST, not the next one along', async () => {
    const id = await makeProfile('chain-one');
    await rename(id, 'chain-two');
    await rename(id, 'chain-three');
    await rename(id, 'chain-four');

    // Every slug this entity has ever held, including the first.
    for (const old of ['chain-one', 'chain-two', 'chain-three']) {
      const resolved = await resolveSlug('designer_profile', old);
      expect(resolved?.canonical).toBe('chain-four');
      expect(resolved?.moved).toBe(true);
    }

    expect(await slugHistory('designer_profile', id)).toEqual([
      'chain-one',
      'chain-two',
      'chain-three',
      'chain-four',
    ]);
  });

  test('twenty renames keep all twenty slugs working', async () => {
    const id = await makeProfile('messy-0');
    for (let n = 1; n <= 20; n++) await rename(id, `messy-${n}`);

    const history = await slugHistory('designer_profile', id);
    expect(history).toHaveLength(21);

    for (const slug of history) {
      const resolved = await resolveSlug('designer_profile', slug);
      expect(resolved?.canonical).toBe('messy-20');
    }
  });

  test('returning to an old name is allowed — it is already yours', async () => {
    const id = await makeProfile('boomerang-a');
    await rename(id, 'boomerang-b');
    const back = await rename(id, 'boomerang-a');

    expect(back).toBe('boomerang-a');
    // No duplicate history row: it was already recorded the first time.
    expect(await slugHistory('designer_profile', id)).toEqual([
      'boomerang-a',
      'boomerang-b',
    ]);
  });
});

describe('a released slug is never reissued to someone else', () => {
  test('a custom slug someone else once held is refused', async () => {
    const first = await makeProfile('contested-name');
    await rename(first, 'contested-moved-on');
    await makeProfile('other-studio-x');

    // 'contested-name' is free by the live column, but not by history.
    expect(
      claimSlug('designer_profile', 999_001, 'contested-name', {
        custom: true,
      }),
    ).rejects.toThrow(SlugRejected);
  });

  test('a derived slug skips past a historical one instead of stealing it', async () => {
    const first = await makeProfile('derived-clash');
    await rename(first, 'derived-clash-moved');

    const chosen = await chooseSlug('designer_profile', 'derived clash', {
      entityId: 999_002,
    });
    expect(chosen).toBe('derived-clash-2');
  });

  test('resolving an old slug never sends a visitor to the wrong entity', async () => {
    const original = await makeProfile('identity-check');
    await rename(original, 'identity-check-renamed');
    const impostor = await makeProfile('identity-check-2');

    const resolved = await resolveSlug('designer_profile', 'identity-check');
    expect(resolved?.entityId).toBe(original);
    expect(resolved?.entityId).not.toBe(impostor);
  });
});

describe('reserved words', () => {
  test('the blocklist covers the route-shadowing names', () => {
    for (const word of [
      'admin',
      'api',
      'login',
      'designers',
      'briefs',
      'bids',
      'account',
    ]) {
      expect(isReservedSlug(word)).toBe(true);
    }
  });

  test('a custom reserved slug is refused with a reason worth showing', async () => {
    const id = await makeProfile('reserved-probe');

    try {
      await claimSlug('designer_profile', id, 'admin', { custom: true });
      throw new Error('should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(SlugRejected);
      expect((error as InstanceType<typeof SlugRejected>).reason).toBe(
        'reserved',
      );
      expect((error as Error).message).toContain('reserved');
    }
  });

  test('a derived slug that lands on a reserved word is suffixed, not refused', async () => {
    const chosen = await chooseSlug('designer_profile', 'Admin', {
      entityId: 999_003,
    });
    expect(isReservedSlug(chosen)).toBe(false);
    expect(chosen.startsWith('admin')).toBe(true);
  });
});

describe('resolution misses', () => {
  test('a slug nobody has ever held is null, not an error', async () => {
    expect(
      await resolveSlug('designer_profile', 'never-existed-anywhere'),
    ).toBeNull();
  });

  test('namespaces are independent — a brief may reuse a designer slug', async () => {
    await makeProfile('shared-word');
    await recordSlug('brief', 999_004, 'shared-word');

    const asProfile = await resolveSlug('designer_profile', 'shared-word');
    expect(asProfile).not.toBeNull();
    // The brief's own row does not exist, so it resolves to null rather than
    // leaking the designer — but the database accepted the INSERT above, which is the
    // point: the two namespaces do not collide.
    expect(await resolveSlug('brief', 'shared-word')).toBeNull();
  });
});
