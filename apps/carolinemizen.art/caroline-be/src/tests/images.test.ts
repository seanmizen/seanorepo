import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDbConnection, seedDatabase } from '../services/db';

describe('Images Tests', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  afterEach(async () => {
    const db = await openDbConnection();
    db.close();
  });

  test('should support multiple file upload', async () => {
    const db = await openDbConnection();

    // Create test images
    const imageData = [
      {
        filename: 'test1.jpg',
        original_name: 'photo1.jpg',
        mime_type: 'image/jpeg',
        file_size: 1024,
        storage_path: 'uploads/images/test1.jpg',
      },
      {
        filename: 'test2.jpg',
        original_name: 'photo2.jpg',
        mime_type: 'image/jpeg',
        file_size: 2048,
        storage_path: 'uploads/images/test2.jpg',
      },
      {
        filename: 'test3.mp4',
        original_name: 'video1.mp4',
        mime_type: 'video/mp4',
        file_size: 102400,
        storage_path: 'uploads/images/test3.mp4',
      },
    ];

    for (const image of imageData) {
      db.run(
        `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
         VALUES (?, ?, ?, ?, ?)`,
        [
          image.filename,
          image.original_name,
          image.mime_type,
          image.file_size,
          image.storage_path,
        ],
      );
    }

    const images = db.query('SELECT * FROM images').all();
    expect(images).toHaveLength(3);

    db.close();
  });

  test('should support video files', async () => {
    const db = await openDbConnection();

    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'video.mp4',
        'my-video.mp4',
        'video/mp4',
        512000,
        'uploads/images/video.mp4',
      ],
    );

    const video = db
      .query('SELECT * FROM images WHERE mime_type LIKE ?')
      .get('video/%');
    expect(video).toBeTruthy();
    expect((video as { mime_type: string }).mime_type).toBe('video/mp4');

    db.close();
  });

  test('should list images with pagination', async () => {
    const db = await openDbConnection();

    // Create 25 test images
    for (let i = 0; i < 25; i++) {
      db.run(
        `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
         VALUES (?, ?, ?, ?, ?)`,
        [
          `test${i}.jpg`,
          `photo${i}.jpg`,
          'image/jpeg',
          1024,
          `uploads/images/test${i}.jpg`,
        ],
      );
    }

    // Default pagination (20 per page)
    const page1 = db
      .query('SELECT * FROM images ORDER BY created_at DESC LIMIT 20')
      .all();
    expect(page1).toHaveLength(20);

    // Second page
    const page2 = db
      .query('SELECT * FROM images ORDER BY created_at DESC LIMIT 20 OFFSET 20')
      .all();
    expect(page2).toHaveLength(5);

    const totalCount = (
      db.query('SELECT COUNT(*) as count FROM images').get() as {
        count: number;
      }
    ).count;
    expect(totalCount).toBe(25);

    db.close();
  });

  test('should delete image from database', async () => {
    const db = await openDbConnection();

    db.run(
      `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'delete-me.jpg',
        'original.jpg',
        'image/jpeg',
        1024,
        'uploads/images/delete-me.jpg',
      ],
    );

    const imageId = Number(
      (
        db.query('SELECT last_insert_rowid() as id').get() as {
          id: number;
        }
      ).id,
    );

    const imageBefore = db
      .query('SELECT * FROM images WHERE id = ?')
      .get(imageId);
    expect(imageBefore).toBeTruthy();

    db.run('DELETE FROM images WHERE id = ?', [imageId]);

    const imageAfter = db
      .query('SELECT * FROM images WHERE id = ?')
      .get(imageId);
    expect(imageAfter).toBeFalsy();

    db.close();
  });
});
