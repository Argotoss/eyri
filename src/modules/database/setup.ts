import type { Database } from "@db/sqlite";
import { getDatabase } from "../storage/sqlite.ts";

export type { Database };

function ensureSchema(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      amount REAL NOT NULL,
      price REAL NOT NULL,
      date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    CREATE INDEX IF NOT EXISTS positions_user_id_idx
      ON positions(user_id);

    CREATE INDEX IF NOT EXISTS positions_ticker_idx
      ON positions(ticker);

    CREATE TABLE IF NOT EXISTS prices (
      ticker TEXT PRIMARY KEY,
      price REAL NOT NULL,
      close_price REAL,
      date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function connectToDb() {
  const database = await getDatabase();
  ensureSchema(database);
  return database;
}
