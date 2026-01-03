import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDbConnection } from '@/services/db';
import {
  countFilesInDirectory,
  createTestImage,
  type E2ETestContext,
  setupE2E,
  teardownE2E,
} from './setup';

describe('Nuke Endpoint E2E Tests', () => {
  let context: E2ETestContext;

  // Create fresh context for each test to ensure isolation
  beforeEach(async () => {
    context = await setupE2E();
  });

  afterEach(async () => {
    await teardownE2E(context);
  });

  test('should delete all images and re-seed database', async () => {
    const { serverUrl, adminCookie, imagesPath } = context;

    // Create test images
    createTestImage(imagesPath, 'test1.jpg');
    createTestImage(imagesPath, 'test2.png');
    createTestImage(imagesPath, 'test3.webp');

    // Verify images exist
    const imageCountBefore = countFilesInDirectory(imagesPath);
    expect(imageCountBefore).toBe(3);

    // Add some data to database (simulate having artworks, galleries, etc.)
    const db = await openDbConnection();
    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES ('test1.jpg', 'test1.jpg', 'image/jpeg', 1000, 'images/test1.jpg')`,
    );
    db.run(
      `INSERT INTO artworks (title, description, price_cents, currency, status)
       VALUES ('Test Artwork', 'Test description', 50000, 'GBP', 'available')`,
    );
    db.run(
      `INSERT INTO galleries (name, slug, description, display_order)
       VALUES ('Test Gallery', 'test-gallery', 'Test description', 0)`,
    );

    // Verify data exists
    const imagesCount = (
      db.query('SELECT COUNT(*) as count FROM images').get() as {
        count: number;
      }
    ).count;
    const artworksCount = (
      db.query('SELECT COUNT(*) as count FROM artworks').get() as {
        count: number;
      }
    ).count;
    const galleriesCount = (
      db.query('SELECT COUNT(*) as count FROM galleries').get() as {
        count: number;
      }
    ).count;

    expect(imagesCount).toBe(1);
    expect(artworksCount).toBe(1);
    expect(galleriesCount).toBe(1);

    db.close();

    // Call nuke endpoint
    const nukeResponse = await fetch(`${serverUrl}/admin/nuke`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
      },
    });

    if (!nukeResponse.ok) {
      const errorText = await nukeResponse.text();
      console.error('Nuke endpoint failed:', errorText);
    }

    expect(nukeResponse.ok).toBe(true);

    const nukeData = (await nukeResponse.json()) as {
      success: boolean;
      backup_path: string;
      images_deleted: number;
      message: string;
    };

    expect(nukeData.success).toBe(true);
    expect(nukeData.images_deleted).toBe(3);
    expect(nukeData.message).toBe('Database and images reset successful');
    expect(nukeData.backup_path).toBeString();

    // Verify images were deleted
    const imageCountAfter = countFilesInDirectory(imagesPath);
    expect(imageCountAfter).toBe(0);

    // Verify database was re-seeded (only default data, no test data)
    const db2 = await openDbConnection();

    const imagesCountAfter = (
      db2.query('SELECT COUNT(*) as count FROM images').get() as {
        count: number;
      }
    ).count;
    const artworksCountAfter = (
      db2.query('SELECT COUNT(*) as count FROM artworks').get() as {
        count: number;
      }
    ).count;
    const galleriesCountAfter = (
      db2.query('SELECT COUNT(*) as count FROM galleries').get() as {
        count: number;
      }
    ).count;

    // After nuke, only seeded data should exist (1 admin user, 0 artworks, 0 galleries, 0 images)
    expect(imagesCountAfter).toBe(0);
    expect(artworksCountAfter).toBe(0);
    expect(galleriesCountAfter).toBe(0);

    // Verify admin user still exists
    const usersCount = (
      db2.query('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      }
    ).count;
    expect(usersCount).toBe(1);

    db2.close();

    // Verify backup was created
    expect(existsSync(nukeData.backup_path)).toBe(true);
  });

  test('should handle empty images folder gracefully', async () => {
    const { serverUrl, adminCookie, imagesPath } = context;

    // Ensure images folder is empty
    const imageCountBefore = countFilesInDirectory(imagesPath);
    expect(imageCountBefore).toBe(0);

    // Call nuke endpoint
    const nukeResponse = await fetch(`${serverUrl}/admin/nuke`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
      },
    });

    expect(nukeResponse.ok).toBe(true);

    const nukeData = (await nukeResponse.json()) as {
      success: boolean;
      images_deleted: number;
    };

    expect(nukeData.success).toBe(true);
    expect(nukeData.images_deleted).toBe(0);
  });

  test('should require admin authentication', async () => {
    const { serverUrl } = context;

    // Call nuke endpoint without authentication
    const nukeResponse = await fetch(`${serverUrl}/admin/nuke`, {
      method: 'POST',
    });

    // Should return 401 Unauthorized
    expect(nukeResponse.status).toBe(401);
  });

  test('should only delete files, not directories', async () => {
    const { serverUrl, adminCookie, imagesPath } = context;
    const { mkdirSync } = require('node:fs');

    // Create test images and a subdirectory
    createTestImage(imagesPath, 'test1.jpg');
    createTestImage(imagesPath, 'test2.jpg');
    mkdirSync(join(imagesPath, 'subdir'), { recursive: true });

    // Verify 2 files + 1 directory
    const beforeCount = countFilesInDirectory(imagesPath);
    expect(beforeCount).toBe(3); // 2 files + 1 directory

    // Call nuke endpoint
    const nukeResponse = await fetch(`${serverUrl}/admin/nuke`, {
      method: 'POST',
      headers: {
        Cookie: adminCookie,
      },
    });

    expect(nukeResponse.ok).toBe(true);

    const nukeData = (await nukeResponse.json()) as {
      success: boolean;
      images_deleted: number;
    };

    // Should only delete the 2 files, not the directory
    expect(nukeData.images_deleted).toBe(2);

    // Verify directory still exists
    const afterCount = countFilesInDirectory(imagesPath);
    expect(afterCount).toBe(1); // Only the directory remains
    expect(existsSync(join(imagesPath, 'subdir'))).toBe(true);
  });
});
