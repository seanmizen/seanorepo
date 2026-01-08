// database actions e.g. seed, init, arbitrary query

import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'node:fs';

type DatabaseType = Database;

const openDbConnection: () => Promise<DatabaseType> = async () => {
  const dbPath = process.env.DB_PATH
    ? `${process.env.DB_PATH}/database.db`
    : './database.db';
  const db = new Database(dbPath);
  // Enable foreign key constraints (disabled by default in SQLite)
  db.run('PRAGMA foreign_keys = ON');
  return db;
};

/**
 * Execute a query using bun:sqlite API
 */
const runQuery = (connection: DatabaseType, query: string) => {
  try {
    connection.run(query);
  } catch (err) {
    throw new Error(`Failed to execute query: ${query}. Error: ${err}`);
  }
};

const seedDatabase = async () => {
  const connection = await openDbConnection();

  // Drop all tables in reverse dependency order
  await runQuery(connection, 'DROP TABLE IF EXISTS sessions');
  await runQuery(connection, 'DROP TABLE IF EXISTS magic_tokens');
  await runQuery(connection, 'DROP TABLE IF EXISTS orders');
  await runQuery(connection, 'DROP TABLE IF EXISTS gallery_artworks');
  await runQuery(connection, 'DROP TABLE IF EXISTS galleries');
  await runQuery(connection, 'DROP TABLE IF EXISTS artwork_images');
  await runQuery(connection, 'DROP TABLE IF EXISTS artworks');
  await runQuery(connection, 'DROP TABLE IF EXISTS images');
  await runQuery(connection, 'DROP TABLE IF EXISTS site_content');
  await runQuery(connection, 'DROP TABLE IF EXISTS users');

  // Create users table (simplified for magic link auth)
  await runQuery(
    connection,
    `CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'guest',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create magic_tokens table
  await runQuery(
    connection,
    `CREATE TABLE magic_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create sessions table for JWT session management
  await runQuery(
    connection,
    `CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create images table
  await runQuery(
    connection,
    `CREATE TABLE images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      storage_path TEXT NOT NULL,
      alt_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create artworks table
  await runQuery(
    connection,
    `CREATE TABLE artworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      status TEXT NOT NULL DEFAULT 'draft',
      primary_image_id INTEGER REFERENCES images(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create artwork_images junction table
  await runQuery(
    connection,
    `CREATE TABLE artwork_images (
      artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      display_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (artwork_id, image_id)
    )`,
  );

  // Create galleries table
  await runQuery(
    connection,
    `CREATE TABLE galleries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      cover_image_id INTEGER REFERENCES images(id),
      is_featured BOOLEAN DEFAULT FALSE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create gallery_artworks junction table
  await runQuery(
    connection,
    `CREATE TABLE gallery_artworks (
      gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
      artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      display_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (gallery_id, artwork_id)
    )`,
  );

  // Create site_content table
  await runQuery(
    connection,
    `CREATE TABLE site_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'text',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  // Create orders table
  await runQuery(
    connection,
    `CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      artwork_id INTEGER NOT NULL REFERENCES artworks(id),
      stripe_session_id TEXT,
      stripe_payment_intent_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      customer_email TEXT NOT NULL,
      customer_name TEXT,
      shipping_line1 TEXT NOT NULL,
      shipping_line2 TEXT,
      shipping_city TEXT NOT NULL,
      shipping_postal_code TEXT NOT NULL,
      shipping_country TEXT NOT NULL DEFAULT 'GB',
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'GBP',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME,
      shipped_at DATETIME,
      delivered_at DATETIME
    )`,
  );

  // Create indexes for performance
  await runQuery(
    connection,
    'CREATE INDEX idx_magic_tokens_token ON magic_tokens(token)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_magic_tokens_expires ON magic_tokens(expires_at)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_sessions_token_hash ON sessions(token_hash)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_sessions_user_id ON sessions(user_id)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_artworks_status ON artworks(status)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_galleries_slug ON galleries(slug)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_orders_status ON orders(status)',
  );
  await runQuery(
    connection,
    'CREATE INDEX idx_orders_stripe_session ON orders(stripe_session_id)',
  );

  // Seed admin user
  await runQuery(
    connection,
    `INSERT INTO users (email, role) VALUES ('caroline@carolinemizen.art', 'admin')`,
  );

  // Seed default site content
  const defaultContent = [
    { key: 'hero_title', value: 'Caroline Mizen' },
    { key: 'hero_subtitle', value: 'Original Artwork & Paintings' },
    { key: 'hero_cta', value: 'View Collections' },
    { key: 'about_title', value: 'About' },
    { key: 'about_text', value: 'Artist biography coming soon.' },
  ];

  for (const content of defaultContent) {
    await runQuery(
      connection,
      `INSERT INTO site_content (key, value) VALUES ('${content.key}', '${content.value}')`,
    );
  }

  connection.close();
  console.debug('Database seeded with new CMS schema');
};

const resetDatabase = async () => {
  const dbPath = process.env.DB_PATH
    ? `${process.env.DB_PATH}/database.db`
    : './database.db';
  if (existsSync(dbPath)) unlinkSync(dbPath);
  await seedDatabase();
};

/**
 * Executes arbitrary SQL
 */
const executeQuery: (sql: string) => Promise<unknown[]> = async (
  sql: string,
) => {
  const db = await openDbConnection();

  return new Promise((resolve, reject) => {
    try {
      const rows = db.query(sql).all();
      db.close();
      resolve(rows);
    } catch (err) {
      console.error(err);
      console.error('The above error occurred when executing this SQL:');
      console.error(sql);
      db.close();
      reject(err);
    }
  });
};

/**
 * Test the database connection
 *
 * @returns true if the connection is successful, false otherwise. Does not throw.
 */
const testDbConnection: () => Promise<boolean> = async () => {
  try {
    const db = await openDbConnection();
    const result = db.query('SELECT name FROM sqlite_master LIMIT 1').get();
    await db.close();
    return result !== undefined;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
};

/**
 * Check if the database needs to be seeded
 *
 * @returns true if the database needs seeding (doesn't exist or has no tables), false otherwise
 */
const needsSeeding: () => Promise<boolean> = async () => {
  const dbPath = process.env.DB_PATH
    ? `${process.env.DB_PATH}/database.db`
    : './database.db';

  // Check if database file exists
  if (!existsSync(dbPath)) {
    return true;
  }

  // Check if database has the expected tables
  try {
    const db = await openDbConnection();
    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
      )
      .all();
    db.close();

    // If users table doesn't exist, database needs seeding
    return tables.length === 0;
  } catch (error) {
    console.error('Error checking database state:', error);
    return true; // If we can't check, assume it needs seeding
  }
};

/**
 * Scan the uploads/images folder and add any files not in the database
 */
const ingestOrphanedImages = async () => {
  const { readdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');

  const uploadsPath = process.env.UPLOADS_PATH || './uploads';
  const imagesPath = path.join(uploadsPath, 'images');

  try {
    // Check if images folder exists
    try {
      await stat(imagesPath);
    } catch {
      console.log('Images folder does not exist yet, skipping ingestion');
      return;
    }

    const files = await readdir(imagesPath);
    if (files.length === 0) {
      console.log('No files found in images folder');
      return;
    }

    const db = await openDbConnection();
    let ingestedCount = 0;

    try {
      for (const filename of files) {
        const filePath = path.join(imagesPath, filename);
        const stats = await stat(filePath);

        // Skip directories
        if (!stats.isFile()) continue;

        // Check if file already exists in database by storage_path
        const storagePath = `images/${filename}`;
        const existing = db
          .query('SELECT id FROM images WHERE storage_path = ?')
          .get(storagePath);

        if (existing) {
          continue; // Already in database
        }

        // Determine mime type from extension
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime',
          '.webm': 'video/webm',
        };

        const mimeType = mimeTypes[ext] || 'application/octet-stream';

        // Insert into database
        db.run(
          `INSERT INTO images (filename, original_name, mime_type, file_size, storage_path)
           VALUES (?, ?, ?, ?, ?)`,
          [filename, filename, mimeType, stats.size, storagePath],
        );

        ingestedCount++;
        console.log(`Ingested orphaned file: ${filename}`);
      }

      if (ingestedCount > 0) {
        console.log(
          `✓ Ingested ${ingestedCount} orphaned image(s) from filesystem`,
        );
      } else {
        console.log('✓ All images in filesystem are already in database');
      }
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('Error ingesting orphaned images:', error);
  }
};

export {
  seedDatabase,
  resetDatabase,
  openDbConnection,
  executeQuery,
  testDbConnection,
  needsSeeding,
  ingestOrphanedImages,
};
