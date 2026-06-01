import type { Database } from "./setup.ts";

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

export type LoadMongoUsersResult = {
  importedUsers: number;
  importedPositions: number;
  skippedUsers: number;
  skippedPositions: number;
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

function parseUsers(input: string): MongoUser[] {
  const parsed = JSON.parse(input);
  if (Array.isArray(parsed)) {
    return parsed as MongoUser[];
  }
  if (parsed && typeof parsed === "object") {
    return [parsed as MongoUser];
  }
  throw new Error("Expected a Mongo user document or an array of documents");
}

export function loadMongoUsers(
  database: Database,
  input: string,
): LoadMongoUsersResult {
  const users = parseUsers(input);
  const result: LoadMongoUsersResult = {
    importedUsers: 0,
    importedPositions: 0,
    skippedUsers: 0,
    skippedPositions: 0,
  };

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

    for (const user of users) {
      const userId = numberFrom(user.userId);
      if (userId === null) {
        result.skippedUsers += 1;
        continue;
      }

      insertUser.run(userId);
      result.importedUsers += 1;

      for (const position of user.positions ?? []) {
        const ticker = tickerFrom(position.ticker);
        const amount = numberFrom(position.amount);
        const price = numberFrom(position.price);
        const date = dateFrom(position.date);

        if (!ticker || amount === null || price === null) {
          result.skippedPositions += 1;
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
        result.importedPositions += changes;
        if (changes === 0) {
          result.skippedPositions += 1;
        }
      }
    }

    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
