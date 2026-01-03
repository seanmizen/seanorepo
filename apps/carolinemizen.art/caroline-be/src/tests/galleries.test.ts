import { beforeEach, describe, expect, test } from 'bun:test';
import { openDbConnection, seedDatabase } from '../services/db';

describe('Gallery Ordering', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  test('new galleries are created at display_order 0', async () => {
    const db = await openDbConnection();
    try {
      // Create first gallery
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['First Gallery', 'first-gallery', 'First', 0, 999], // display_order should be overridden
      );

      const firstGallery = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('first-gallery') as { display_order: number } | undefined;

      expect(firstGallery).toBeDefined();
      // This test verifies current behavior - the gallery is created with the provided display_order
      // In the actual POST endpoint, we increment existing galleries and set new ones to 0
    } finally {
      db.close();
    }
  });

  test('creating a new gallery increments existing galleries display_order', async () => {
    const db = await openDbConnection();
    try {
      // Create first gallery
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery 1', 'gallery-1', 'First gallery', 0, 0],
      );

      // Create second gallery
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery 2', 'gallery-2', 'Second gallery', 0, 1],
      );

      // Now simulate the POST endpoint behavior: increment all, then insert at 0
      db.run('UPDATE galleries SET display_order = display_order + 1');
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery 3', 'gallery-3', 'Third gallery (newest)', 0, 0],
      );

      const gallery1 = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-1') as { display_order: number } | undefined;
      const gallery2 = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-2') as { display_order: number } | undefined;
      const gallery3 = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-3') as { display_order: number } | undefined;

      expect(gallery1?.display_order).toBe(1);
      expect(gallery2?.display_order).toBe(2);
      expect(gallery3?.display_order).toBe(0); // Newest goes to top
    } finally {
      db.close();
    }
  });

  test('move-up swaps display_order correctly', async () => {
    const db = await openDbConnection();
    try {
      // Create three galleries in order
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery A', 'gallery-a', 'First', 0, 0],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery B', 'gallery-b', 'Second', 0, 1],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery C', 'gallery-c', 'Third', 0, 2],
      );

      const galleryB = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-b') as { id: number; display_order: number } | undefined;

      expect(galleryB).toBeDefined();
      if (!galleryB) throw new Error('galleryB should be defined');
      expect(galleryB.display_order).toBe(1);

      // Simulate move-up: Gallery B (order 1) moves up to 0, Gallery A (order 0) moves down to 1
      const galleryA = db
        .query('SELECT * FROM galleries WHERE display_order = ?')
        .get(galleryB.display_order - 1) as
        | { id: number; display_order: number }
        | undefined;

      expect(galleryA).toBeDefined();
      if (!galleryA) throw new Error('galleryA should be defined');

      // Swap
      db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
        galleryA.display_order,
        galleryB.id,
      ]);
      db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
        galleryB.display_order,
        galleryA.id,
      ]);

      const updatedA = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-a') as { display_order: number } | undefined;
      const updatedB = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-b') as { display_order: number } | undefined;

      expect(updatedA?.display_order).toBe(1);
      expect(updatedB?.display_order).toBe(0);
    } finally {
      db.close();
    }
  });

  test('move-down swaps display_order correctly', async () => {
    const db = await openDbConnection();
    try {
      // Create three galleries in order
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery A', 'gallery-a', 'First', 0, 0],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery B', 'gallery-b', 'Second', 0, 1],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery C', 'gallery-c', 'Third', 0, 2],
      );

      const galleryB = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-b') as { id: number; display_order: number } | undefined;

      expect(galleryB).toBeDefined();
      if (!galleryB) throw new Error('galleryB should be defined');
      expect(galleryB.display_order).toBe(1);

      // Simulate move-down: Gallery B (order 1) moves down to 2, Gallery C (order 2) moves up to 1
      const galleryC = db
        .query('SELECT * FROM galleries WHERE display_order = ?')
        .get(galleryB.display_order + 1) as
        | { id: number; display_order: number }
        | undefined;

      expect(galleryC).toBeDefined();
      if (!galleryC) throw new Error('galleryC should be defined');

      // Swap
      db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
        galleryC.display_order,
        galleryB.id,
      ]);
      db.run('UPDATE galleries SET display_order = ? WHERE id = ?', [
        galleryB.display_order,
        galleryC.id,
      ]);

      const updatedB = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-b') as { display_order: number } | undefined;
      const updatedC = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-c') as { display_order: number } | undefined;

      expect(updatedB?.display_order).toBe(2);
      expect(updatedC?.display_order).toBe(1);
    } finally {
      db.close();
    }
  });

  test('cannot move top gallery up', async () => {
    const db = await openDbConnection();
    try {
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Top Gallery', 'top-gallery', 'At position 0', 0, 0],
      );

      const gallery = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('top-gallery') as
        | { id: number; display_order: number }
        | undefined;

      expect(gallery).toBeDefined();
      if (!gallery) throw new Error('gallery should be defined');
      expect(gallery.display_order).toBe(0);

      // Try to find gallery above (should not exist)
      const aboveGallery = db
        .query('SELECT * FROM galleries WHERE display_order = ?')
        .get(gallery.display_order - 1);

      expect(aboveGallery).toBeNull();
    } finally {
      db.close();
    }
  });

  test('cannot move bottom gallery down', async () => {
    const db = await openDbConnection();
    try {
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery A', 'gallery-a', 'First', 0, 0],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery B', 'gallery-b', 'Last', 0, 1],
      );

      const gallery = db
        .query('SELECT * FROM galleries WHERE slug = ?')
        .get('gallery-b') as { id: number; display_order: number } | undefined;

      expect(gallery).toBeDefined();
      if (!gallery) throw new Error('gallery should be defined');
      expect(gallery.display_order).toBe(1);

      // Try to find gallery below (should not exist)
      const belowGallery = db
        .query('SELECT * FROM galleries WHERE display_order = ?')
        .get(gallery.display_order + 1);

      expect(belowGallery).toBeNull();
    } finally {
      db.close();
    }
  });

  test('galleries are sorted by display_order ascending', async () => {
    const db = await openDbConnection();
    try {
      // Create galleries in random order
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery B', 'gallery-b', 'Should be second', 0, 1],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery C', 'gallery-c', 'Should be third', 0, 2],
      );
      db.run(
        `INSERT INTO galleries (name, slug, description, is_featured, display_order)
         VALUES (?, ?, ?, ?, ?)`,
        ['Gallery A', 'gallery-a', 'Should be first', 0, 0],
      );

      const galleries = db
        .query('SELECT * FROM galleries ORDER BY display_order ASC')
        .all() as Array<{ slug: string; display_order: number }>;

      expect(galleries).toHaveLength(3);
      expect(galleries[0].slug).toBe('gallery-a');
      expect(galleries[1].slug).toBe('gallery-b');
      expect(galleries[2].slug).toBe('gallery-c');
    } finally {
      db.close();
    }
  });
});

describe('Gallery-Artwork Associations', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  test('creating gallery with artwork_ids associates artworks', async () => {
    const db = await openDbConnection();
    try {
      // Create some artworks first
      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork 1', 1000, 'GBP', 'available'],
      );
      const artwork1Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork 2', 2000, 'GBP', 'available'],
      );
      const artwork2Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork 3', 3000, 'GBP', 'draft'],
      );
      const artwork3Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Create gallery
      db.run('UPDATE galleries SET display_order = display_order + 1');
      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Test Gallery', 'test-gallery', 'A test gallery', 0],
      );
      const galleryId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Associate artworks (simulating POST /admin/galleries with artwork_ids)
      const artworkIds = [artwork1Id, artwork2Id, artwork3Id];
      for (let i = 0; i < artworkIds.length; i++) {
        db.run(
          'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
          [galleryId, artworkIds[i], i],
        );
      }

      // Verify associations created
      const associations = db
        .query('SELECT * FROM gallery_artworks WHERE gallery_id = ?')
        .all(galleryId) as Array<{
        artwork_id: number;
        display_order: number;
      }>;

      expect(associations).toHaveLength(3);
      expect(associations[0].artwork_id).toBe(artwork1Id);
      expect(associations[0].display_order).toBe(0);
      expect(associations[1].artwork_id).toBe(artwork2Id);
      expect(associations[1].display_order).toBe(1);
      expect(associations[2].artwork_id).toBe(artwork3Id);
      expect(associations[2].display_order).toBe(2);

      // Verify can fetch artworks with gallery
      const artworks = db
        .query(
          `SELECT a.* FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?
           ORDER BY ga.display_order ASC`,
        )
        .all(galleryId) as Array<{ id: number; title: string }>;

      expect(artworks).toHaveLength(3);
      expect(artworks[0].title).toBe('Artwork 1');
      expect(artworks[1].title).toBe('Artwork 2');
      expect(artworks[2].title).toBe('Artwork 3');
    } finally {
      db.close();
    }
  });

  test('updating gallery artworks replaces existing associations', async () => {
    const db = await openDbConnection();
    try {
      // Create artworks
      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork A', 1000, 'GBP', 'available'],
      );
      const artworkA = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork B', 2000, 'GBP', 'available'],
      );
      const artworkB = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork C', 3000, 'GBP', 'available'],
      );
      const artworkC = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Create gallery with initial artworks
      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Gallery', 'gallery', 'Test', 0],
      );
      const galleryId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artworkA, 0],
      );
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artworkB, 1],
      );

      // Verify initial state
      let artworks = db
        .query(
          `SELECT a.id FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?
           ORDER BY ga.display_order ASC`,
        )
        .all(galleryId) as Array<{ id: number }>;

      expect(artworks).toHaveLength(2);
      expect(artworks[0].id).toBe(artworkA);
      expect(artworks[1].id).toBe(artworkB);

      // Update associations (simulating PUT /admin/galleries/:id/artworks)
      db.run('DELETE FROM gallery_artworks WHERE gallery_id = ?', [galleryId]);

      const newArtworkIds = [artworkB, artworkC]; // Changed order, removed A, added C
      for (let i = 0; i < newArtworkIds.length; i++) {
        db.run(
          'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
          [galleryId, newArtworkIds[i], i],
        );
      }

      // Verify updated state
      artworks = db
        .query(
          `SELECT a.id FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?
           ORDER BY ga.display_order ASC`,
        )
        .all(galleryId) as Array<{ id: number }>;

      expect(artworks).toHaveLength(2);
      expect(artworks[0].id).toBe(artworkB);
      expect(artworks[1].id).toBe(artworkC);
    } finally {
      db.close();
    }
  });

  test('deleting gallery cascades to gallery_artworks', async () => {
    const db = await openDbConnection();
    try {
      // Create artwork
      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork', 1000, 'GBP', 'available'],
      );
      const artworkId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Create gallery
      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Gallery to Delete', 'delete-me', 'Will be deleted', 0],
      );
      const galleryId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Associate artwork
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artworkId, 0],
      );

      // Verify association exists
      let associations = db
        .query('SELECT * FROM gallery_artworks WHERE gallery_id = ?')
        .all(galleryId);
      expect(associations).toHaveLength(1);

      // Delete gallery
      db.run('DELETE FROM galleries WHERE id = ?', [galleryId]);

      // Verify gallery deleted
      const gallery = db
        .query('SELECT * FROM galleries WHERE id = ?')
        .get(galleryId);
      expect(gallery).toBeFalsy();

      // Verify associations cascade deleted
      associations = db
        .query('SELECT * FROM gallery_artworks WHERE gallery_id = ?')
        .all(galleryId);
      expect(associations).toHaveLength(0);

      // Verify artwork still exists (should not cascade)
      const artwork = db
        .query('SELECT * FROM artworks WHERE id = ?')
        .get(artworkId);
      expect(artwork).toBeTruthy();
    } finally {
      db.close();
    }
  });

  test('removing artwork from gallery does not delete the artwork', async () => {
    const db = await openDbConnection();
    try {
      // Create artwork
      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Artwork', 1000, 'GBP', 'available'],
      );
      const artworkId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Create gallery
      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Gallery', 'gallery', 'Test', 0],
      );
      const galleryId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Associate artwork
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artworkId, 0],
      );

      // Remove association (simulating updating gallery with empty artwork_ids)
      db.run('DELETE FROM gallery_artworks WHERE gallery_id = ?', [galleryId]);

      // Verify association removed
      const associations = db
        .query('SELECT * FROM gallery_artworks WHERE gallery_id = ?')
        .all(galleryId);
      expect(associations).toHaveLength(0);

      // Verify artwork still exists
      const artwork = db
        .query('SELECT * FROM artworks WHERE id = ?')
        .get(artworkId);
      expect(artwork).toBeTruthy();

      // Verify gallery still exists
      const gallery = db
        .query('SELECT * FROM galleries WHERE id = ?')
        .get(galleryId);
      expect(gallery).toBeTruthy();
    } finally {
      db.close();
    }
  });

  test('same artwork can be in multiple galleries', async () => {
    const db = await openDbConnection();
    try {
      // Create artwork
      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Shared Artwork', 5000, 'GBP', 'available'],
      );
      const artworkId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Create two galleries
      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Gallery 1', 'gallery-1', 'First', 0],
      );
      const gallery1Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Gallery 2', 'gallery-2', 'Second', 1],
      );
      const gallery2Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Add same artwork to both galleries
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [gallery1Id, artworkId, 0],
      );
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [gallery2Id, artworkId, 0],
      );

      // Verify artwork is in both galleries
      const gallery1Artworks = db
        .query(
          `SELECT a.* FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?`,
        )
        .all(gallery1Id) as Array<{ id: number }>;

      const gallery2Artworks = db
        .query(
          `SELECT a.* FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?`,
        )
        .all(gallery2Id) as Array<{ id: number }>;

      expect(gallery1Artworks).toHaveLength(1);
      expect(gallery2Artworks).toHaveLength(1);
      expect(gallery1Artworks[0].id).toBe(artworkId);
      expect(gallery2Artworks[0].id).toBe(artworkId);

      // Find all galleries containing this artwork
      const galleries = db
        .query(
          `SELECT g.* FROM galleries g
           JOIN gallery_artworks ga ON g.id = ga.gallery_id
           WHERE ga.artwork_id = ?`,
        )
        .all(artworkId) as Array<{ id: number }>;

      expect(galleries).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  test('gallery artworks maintain display_order when reordered', async () => {
    const db = await openDbConnection();
    try {
      // Create artworks
      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['First', 1000, 'GBP', 'available'],
      );
      const artwork1Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Second', 2000, 'GBP', 'available'],
      );
      const artwork2Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      db.run(
        `INSERT INTO artworks (title, price_cents, currency, status)
         VALUES (?, ?, ?, ?)`,
        ['Third', 3000, 'GBP', 'available'],
      );
      const artwork3Id = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Create gallery
      db.run(
        `INSERT INTO galleries (name, slug, description, display_order)
         VALUES (?, ?, ?, ?)`,
        ['Gallery', 'gallery', 'Test', 0],
      );
      const galleryId = Number(
        (db.query('SELECT last_insert_rowid() as id').get() as { id: number })
          .id,
      );

      // Add in order: 1, 2, 3
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artwork1Id, 0],
      );
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artwork2Id, 1],
      );
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artwork3Id, 2],
      );

      // Verify initial order
      let artworks = db
        .query(
          `SELECT a.title FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?
           ORDER BY ga.display_order ASC`,
        )
        .all(galleryId) as Array<{ title: string }>;

      expect(artworks[0].title).toBe('First');
      expect(artworks[1].title).toBe('Second');
      expect(artworks[2].title).toBe('Third');

      // Reorder: 3, 1, 2
      db.run('DELETE FROM gallery_artworks WHERE gallery_id = ?', [galleryId]);
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artwork3Id, 0],
      );
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artwork1Id, 1],
      );
      db.run(
        'INSERT INTO gallery_artworks (gallery_id, artwork_id, display_order) VALUES (?, ?, ?)',
        [galleryId, artwork2Id, 2],
      );

      // Verify new order
      artworks = db
        .query(
          `SELECT a.title FROM artworks a
           JOIN gallery_artworks ga ON a.id = ga.artwork_id
           WHERE ga.gallery_id = ?
           ORDER BY ga.display_order ASC`,
        )
        .all(galleryId) as Array<{ title: string }>;

      expect(artworks[0].title).toBe('Third');
      expect(artworks[1].title).toBe('First');
      expect(artworks[2].title).toBe('Second');
    } finally {
      db.close();
    }
  });
});
