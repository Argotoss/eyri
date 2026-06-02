import type { Database } from "@db/sqlite";
import { getDatabase } from "../storage/sqlite.ts";

export type { Database };

type TableColumn = {
  name: string;
};

function getTableColumns(database: Database, tableName: string) {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as TableColumn[];
}

function hasColumn(database: Database, tableName: string, columnName: string) {
  return getTableColumns(database, tableName).some(
    (column) => column.name === columnName,
  );
}

function addColumnIfMissing(
  database: Database,
  tableName: string,
  columnName: string,
  definition: string,
) {
  if (!hasColumn(database, tableName, columnName)) {
    database.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
    );
  }
}

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
      unit_price REAL,
      commission_percent REAL NOT NULL DEFAULT 0,
      commission_amount REAL NOT NULL DEFAULT 0,
      gross_value REAL,
      net_cash_flow REAL,
      realized_pl REAL NOT NULL DEFAULT 0,
      shares_before REAL,
      shares_after REAL,
      cost_basis_before REAL,
      cost_basis_after REAL,
      realized_cost_basis_after REAL,
      kind TEXT,
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
      provider TEXT,
      source_ticker TEXT,
      date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumnIfMissing(database, "positions", "unit_price", "REAL");
  addColumnIfMissing(
    database,
    "positions",
    "commission_percent",
    "REAL NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "positions",
    "commission_amount",
    "REAL NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(database, "positions", "gross_value", "REAL");
  addColumnIfMissing(database, "positions", "net_cash_flow", "REAL");
  addColumnIfMissing(
    database,
    "positions",
    "realized_pl",
    "REAL NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(database, "positions", "shares_before", "REAL");
  addColumnIfMissing(database, "positions", "shares_after", "REAL");
  addColumnIfMissing(database, "positions", "cost_basis_before", "REAL");
  addColumnIfMissing(database, "positions", "cost_basis_after", "REAL");
  addColumnIfMissing(
    database,
    "positions",
    "realized_cost_basis_after",
    "REAL",
  );
  addColumnIfMissing(database, "positions", "kind", "TEXT");
  addColumnIfMissing(database, "prices", "provider", "TEXT");
  addColumnIfMissing(database, "prices", "source_ticker", "TEXT");
}

export async function connectToDb() {
  const database = await getDatabase();
  ensureSchema(database);
  return database;
}
