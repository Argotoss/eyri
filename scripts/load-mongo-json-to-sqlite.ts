import { connectToDb } from "../src/modules/database/setup.ts";
import { Database as SqliteDatabase } from "@db/sqlite";

type MongoUser = {
  userId?: unknown;
  positions?: MongoPosition[];
};

type MongoPosition = {
  ticker?: unknown;
  amount?: unknown;
  price?: unknown;
  date?: unknown;
};

type MongoPrice = {
  ticker?: unknown;
  price?: unknown;
  closePrice?: unknown;
  date?: unknown;
};

type PositionDebugRow = {
  user_id: number;
  ticker: string;
  amount: number;
  price: number;
  date: string;
};

function numberFrom(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      numberFrom(record.$numberInt) ??
        numberFrom(record.$numberLong) ??
        numberFrom(record.$numberDouble) ??
        null
    );
  }

  return null;
}

function dateFrom(value: unknown): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (value instanceof Date || typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? new Date().toISOString()
      : date.toISOString();
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("$date" in record) {
      return dateFrom(record.$date);
    }
    if ("$numberLong" in record) {
      const milliseconds = numberFrom(record.$numberLong);
      if (milliseconds !== null) {
        return new Date(milliseconds).toISOString();
      }
    }
  }

  return new Date().toISOString();
}

function tickerFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  const text = await Deno.readTextFile(path);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} did not contain a JSON array`);
  }
  return parsed as T[];
}

function getArg(name: string) {
  const prefix = `--${name}=`;
  const value = Deno.args.find((arg) => arg.startsWith(prefix));
  if (!value) {
    throw new Error(`Missing ${prefix}<path>`);
  }
  return value.slice(prefix.length);
}

function readPositionRows(db: SqliteDatabase) {
  return db.prepare(`
    SELECT user_id, ticker, amount, price, date
    FROM positions
    ORDER BY user_id, date, id
  `).all() as PositionDebugRow[];
}

function readCounts(db: SqliteDatabase) {
  return {
    users: db.prepare("SELECT count(*) AS count FROM users").get(),
    positions: db.prepare("SELECT count(*) AS count FROM positions").get(),
    prices: db.prepare("SELECT count(*) AS count FROM prices").get(),
  };
}

const usersPath = getArg("users");
const pricesPath = getArg("prices");
const users = await readJsonArray<MongoUser>(usersPath);
const prices = await readJsonArray<MongoPrice>(pricesPath);
const database = await connectToDb();
const databasePath = Deno.env.get("EYRI_DATABASE_PATH");

console.log("SQLite database path:", databasePath);
console.log("JSON users data:");
console.log(JSON.stringify(users, null, 2));
console.log("JSON prices data:");
console.log(JSON.stringify(prices, null, 2));
console.log("Fetched counts now from SQLite:");
console.log(JSON.stringify(readCounts(database), null, 2));
console.log("Fetched positions now from SQLite:");
console.log(JSON.stringify(readPositionRows(database), null, 2));

let importedUsers = 0;
let importedPositions = 0;
let importedPrices = 0;

database.exec("BEGIN");
try {
  const insertUser = database.prepare(`
    INSERT INTO users (user_id)
    VALUES (?)
    ON CONFLICT(user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
  `);
  const insertPosition = database.prepare(`
    INSERT INTO positions (user_id, ticker, amount, price, date)
    SELECT ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM positions
      WHERE user_id = ?
        AND ticker = ?
        AND amount = ?
        AND price = ?
        AND date = ?
    )
  `);
  const upsertPrice = database.prepare(`
    INSERT INTO prices (ticker, price, close_price, date)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
      price = excluded.price,
      close_price = excluded.close_price,
      date = excluded.date
  `);

  for (const user of users) {
    const userId = numberFrom(user.userId);
    if (userId === null) {
      continue;
    }

    insertUser.run(userId);
    importedUsers += 1;

    for (const position of user.positions ?? []) {
      const ticker = tickerFrom(position.ticker);
      const amount = numberFrom(position.amount);
      const price = numberFrom(position.price);
      const date = dateFrom(position.date);
      if (!ticker || amount === null || price === null) {
        continue;
      }

      const changes = insertPosition.run(
        userId,
        ticker,
        amount,
        price,
        date,
        userId,
        ticker,
        amount,
        price,
        date,
      );
      importedPositions += changes;
    }
  }

  for (const priceDocument of prices) {
    const ticker = tickerFrom(priceDocument.ticker);
    const price = numberFrom(priceDocument.price);
    if (!ticker || price === null) {
      continue;
    }

    upsertPrice.run(
      ticker,
      price,
      numberFrom(priceDocument.closePrice),
      dateFrom(priceDocument.date),
    );
    importedPrices += 1;
  }

  database.exec("COMMIT");
  console.log("Fetched counts after insertion:");
  console.log(JSON.stringify(readCounts(database), null, 2));
  console.log("Fetched positions after insertion:");
  console.log(JSON.stringify(readPositionRows(database), null, 2));
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

if (databasePath) {
  const reopenedDatabase = new SqliteDatabase(databasePath);
  try {
    console.log("Fetched counts after close/reopen:");
    console.log(JSON.stringify(readCounts(reopenedDatabase), null, 2));
    console.log("Fetched positions after close/reopen:");
    console.log(JSON.stringify(readPositionRows(reopenedDatabase), null, 2));
  } finally {
    reopenedDatabase.close();
  }
}

console.log(
  `Imported ${importedUsers} users, ${importedPositions} positions, ${importedPrices} prices.`,
);
