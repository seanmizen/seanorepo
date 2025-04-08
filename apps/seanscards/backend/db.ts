import Database from "bun:sqlite";
import path from "path";
import { configs, ConfigType } from "../configs";

const env = process.env.NODE_ENV || "development";
const config: ConfigType = configs[env];

const dbBase = process.env.DB_PATH || import.meta.dir;
const dbPath = path.join(dbBase, config.dbName);
const db = new Database(dbPath);

// db.exec(`DROP TABLE IF EXISTS sessions`);

// Create table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionToken TEXT UNIQUE,
    message TEXT,
    address TEXT,
    email TEXT,
    selectedCardDesign TEXT,
    stripeSessionId TEXT,
    stripeStatus TEXT,
    stripeCustomerEmail TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TRIGGER IF NOT EXISTS update_timestamp
  AFTER UPDATE ON sessions
  FOR EACH ROW
  BEGIN
    UPDATE sessions
    SET updatedAt = datetime('now')
    WHERE id = NEW.id;
  END;
`);

const rows = db.query("SELECT * FROM sessions").all();
console.log("db connection established with row count:", rows.length);
console.log("latest row:", rows[rows.length - 1]);
// console.log("all rows:", JSON.stringify(rows, null, 2));

export { db };
