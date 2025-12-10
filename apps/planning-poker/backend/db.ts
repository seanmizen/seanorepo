import Database from 'bun:sqlite';
import path from 'node:path';
import { type ConfigType, configs } from '../configs';

const env = process.env.NODE_ENV || 'development';
const config: ConfigType = configs[env];

const dbBase = process.env.DB_PATH || __dirname;
const dbPath = path.join(dbBase, config.dbName);
const db = new Database(dbPath);

db.run(`
  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionToken TEXT UNIQUE,
    name TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TRIGGER IF NOT EXISTS update_user_session_timestamp
  AFTER UPDATE ON user_sessions
  FOR EACH ROW
  BEGIN
    UPDATE user_sessions
    SET updatedAt = datetime('now')
    WHERE id = NEW.id;
  END;

  CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    shortId TEXT UNIQUE NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gameSessionId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    estimate TEXT,
    orderIndex INTEGER NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (gameSessionId) REFERENCES game_sessions(id)
  );

  CREATE TRIGGER IF NOT EXISTS update_game_session_timestamp
  AFTER UPDATE ON game_sessions
  FOR EACH ROW
  BEGIN
    UPDATE game_sessions
    SET updatedAt = datetime('now')
    WHERE id = NEW.id;
  END;
`);

const rows = db.query('SELECT * FROM user_sessions').all();
console.log('db connection established with row count:', rows.length);
console.log('latest row:', rows[rows.length - 1]);

export { db };
