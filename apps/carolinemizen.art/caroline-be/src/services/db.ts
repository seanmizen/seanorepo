// database actions e.g. seed, init, arbitrary query
// TODO: bun:sqlite3? might be faster.
import { Database } from "better-sqlite3";
import { existsSync, unlinkSync } from "node:fs";
import * as userService from "./users";

const openDbConnection: () => Promise<Database> = async () => {
  const db = new Database("./database.db");
  return db;
};

/**
 * Not sure I'm a fan of this. rather use sqlite's serialize
 *
 * but I couldn't figure that out at 2am
 */
const runQuery = (connection: Database, query: string) =>
  new Promise<void>((resolve, reject) => {
    connection.run(query, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });

const seedDatabase = async () => {
  // V1: create the entire schema and some seed data in this function.
  // eventually we obviously don't want that.
  const connection = await openDbConnection();
  // connection.serialize is no good here it seems
  await runQuery(connection, `DROP TABLE IF EXISTS users`);
  await runQuery(
    connection,
    `CREATE TABLE users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    salt_iterations INTEGER NOT NULL,
    date_created DATETIME DEFAULT CURRENT_TIMESTAMP
  )`
  );
  connection.close();
  console.debug("Database seeded");

  await userService.createUser({
    email: "alice@bob.com",
    password: "password",
    role: "user",
  });
  await userService.createUser({
    email: "bob@bob.com",
    password: "password",
  });
  await userService.createUser({
    email: "daniel@bob.com",
    password: "password",
  });
};

const resetDatabase = async () => {
  if (existsSync("./database.db")) unlinkSync("./database.db");
  await seedDatabase();
};

/**
 * Executes arbitrary SQL
 */
const executeQuery: (sql: string) => Promise<any[]> = async (sql: string) => {
  const db = await openDbConnection();

  return new Promise((resolve, reject) => {
    db.all<any>(sql, (err, rows) => {
      if (err) {
        console.error(err);
        console.error("The above error occurred when executing the this SQL:");
        console.error(sql);
        db.close();
        reject(err);
      } else {
        db.close();
        resolve(rows);
      }
    });
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
    const result = await db.get("SELECT name FROM sqlite_master LIMIT 1");
    await db.close();
    return result !== undefined;
  } catch (error) {
    console.error("Database connection test failed:", error);
    return false;
  }
};

export {
  seedDatabase,
  resetDatabase,
  openDbConnection,
  executeQuery,
  testDbConnection,
};
