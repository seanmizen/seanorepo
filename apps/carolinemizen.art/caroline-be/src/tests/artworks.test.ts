import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDbConnection, seedDatabase } from '../services/db';

describe('Artworks Tests', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  afterEach(async () => {
    const db = await openDbConnection();
    db.close();
  });

  test('should create artwork and retrieve it in admin list', async () => {
    const db = await openDbConnection();

    // Create a draft artwork (like the user's scenario)
    db.run(
      `INSERT INTO artworks (title, description, price_cents, currency, status, primary_image_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['Test Artwork', 'Test description', 2000, 'GBP', 'draft', null],
    );

    const artworkId = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    // Should be able to retrieve draft artworks from admin endpoint
    // This simulates GET /admin/artworks which should show ALL artworks regardless of status
    const allArtworks = db.query('SELECT * FROM artworks').all();
    expect(allArtworks).toHaveLength(1);

    const draftArtwork = db
      .query('SELECT * FROM artworks WHERE id = ?')
      .get(artworkId) as {
      status: string;
    };
    expect(draftArtwork).toBeTruthy();
    expect(draftArtwork.status).toBe('draft');

    db.close();
  });

  test('should list all artworks for admin including drafts', async () => {
    const db = await openDbConnection();

    // Create artworks with different statuses
    db.run(
      `INSERT INTO artworks (title, description, price_cents, currency, status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Draft Artwork', 'Draft', 1000, 'GBP', 'draft'],
    );
    db.run(
      `INSERT INTO artworks (title, description, price_cents, currency, status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Available Artwork', 'Available', 2000, 'GBP', 'available'],
    );
    db.run(
      `INSERT INTO artworks (title, description, price_cents, currency, status)
       VALUES (?, ?, ?, ?, ?)`,
      ['Sold Artwork', 'Sold', 3000, 'GBP', 'sold'],
    );

    // Admin should see ALL artworks
    const allArtworks = db.query('SELECT * FROM artworks').all();
    expect(allArtworks).toHaveLength(3);

    // Public endpoint should only see available
    const availableArtworks = db
      .query('SELECT * FROM artworks WHERE status = ?')
      .all('available');
    expect(availableArtworks).toHaveLength(1);

    db.close();
  });

  test('should associate images with artwork', async () => {
    const db = await openDbConnection();

    // Create artwork
    db.run(
      `INSERT INTO artworks (title, price_cents, currency, status)
       VALUES (?, ?, ?, ?)`,
      ['Artwork with Images', 5000, 'GBP', 'available'],
    );

    const artworkId = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    // Create some images
    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES (?, ?, ?, ?, ?)`,
      ['img1.jpg', 'image1.jpg', 'image/jpeg', 1024, 'uploads/images/img1.jpg'],
    );
    const imageId1 = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES (?, ?, ?, ?, ?)`,
      ['img2.jpg', 'image2.jpg', 'image/jpeg', 2048, 'uploads/images/img2.jpg'],
    );
    const imageId2 = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    // Associate images with artwork
    db.run(
      'INSERT INTO artwork_images (artwork_id, image_id, display_order) VALUES (?, ?, ?)',
      [artworkId, imageId1, 0],
    );
    db.run(
      'INSERT INTO artwork_images (artwork_id, image_id, display_order) VALUES (?, ?, ?)',
      [artworkId, imageId2, 1],
    );

    // Verify associations
    const artworkImages = db
      .query(
        `SELECT i.* FROM images i
         JOIN artwork_images ai ON i.id = ai.image_id
         WHERE ai.artwork_id = ?
         ORDER BY ai.display_order ASC`,
      )
      .all(artworkId);

    expect(artworkImages).toHaveLength(2);
    expect((artworkImages[0] as { id: number }).id).toBe(imageId1);
    expect((artworkImages[1] as { id: number }).id).toBe(imageId2);

    db.close();
  });

  test('should delete artwork and cascade delete associations', async () => {
    const db = await openDbConnection();

    // Create artwork with image association
    db.run(
      `INSERT INTO artworks (title, price_cents, currency, status)
       VALUES (?, ?, ?, ?)`,
      ['Artwork to Delete', 1000, 'GBP', 'draft'],
    );
    const artworkId = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES (?, ?, ?, ?, ?)`,
      ['img.jpg', 'image.jpg', 'image/jpeg', 1024, 'uploads/images/img.jpg'],
    );
    const imageId = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    db.run(
      'INSERT INTO artwork_images (artwork_id, image_id, display_order) VALUES (?, ?, ?)',
      [artworkId, imageId, 0],
    );

    // Verify associations exist
    const associationsBefore = db
      .query('SELECT * FROM artwork_images WHERE artwork_id = ?')
      .all(artworkId);
    expect(associationsBefore).toHaveLength(1);

    // Delete artwork
    db.run('DELETE FROM artworks WHERE id = ?', [artworkId]);

    // Verify artwork deleted
    const artwork = db
      .query('SELECT * FROM artworks WHERE id = ?')
      .get(artworkId);
    expect(artwork).toBeFalsy();

    // Verify associations cascade deleted (due to ON DELETE CASCADE in schema)
    const associationsAfter = db
      .query('SELECT * FROM artwork_images WHERE artwork_id = ?')
      .all(artworkId);
    expect(associationsAfter).toHaveLength(0);

    db.close();
  });
});
