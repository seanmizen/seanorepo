import Database from "bun:sqlite";
import path from "path";
import { configs, ConfigType } from "../configs";

const env = process.env.NODE_ENV || "development";
const config: ConfigType = configs[env];

// dbName might be "./mydb_dev.sqlite" or "./mydb_prod.sqlite"
const dbPath = path.join(import.meta.dir, config.dbName);
const db = new Database(dbPath);

// Create table if not exists
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  sessionToken TEXT PRIMARY KEY,
  message TEXT,
  address TEXT,
  email TEXT,
  selectedCardDesign TEXT
);
`);

const rows = db.query("SELECT * FROM sessions").all();
console.log("db connection established with row count:", rows.length);
console.log("latest row:", rows[rows.length - 1]);

export { db };
