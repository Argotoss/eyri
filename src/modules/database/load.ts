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

type PositionRowInput = MongoPosition & {
  user_id?: unknown;
  userId?: unknown;
};

type ParsedPosition = {
  userId: number | null;
  ticker: string | null;
  amount: number | null;
  price: number | null;
  date: string;
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

function hasFlatPositionShape(value: unknown): value is PositionRowInput {
  return Boolean(
    value &&
      typeof value === "object" &&
      "ticker" in value &&
      ("user_id" in value || "userId" in value),
  );
}

function parseInput(input: string): ParsedPosition[] {
  const parsed = JSON.parse(input);
  const documents = Array.isArray(parsed) ? parsed : [parsed];
  const positions: ParsedPosition[] = [];

  for (const document of documents) {
    if (hasFlatPositionShape(document)) {
      positions.push({
        userId: numberFrom(document.user_id ?? document.userId),
        ticker: tickerFrom(document.ticker),
        amount: numberFrom(document.amount),
        price: numberFrom(document.price),
        date: dateFrom(document.date),
      });
      continue;
    }

    if (!document || typeof document !== "object") {
      continue;
    }

    const user = document as MongoUser;
    const userId = numberFrom(user.userId);
    for (const position of user.positions ?? []) {
      positions.push({
        userId,
        ticker: tickerFrom(position.ticker),
        amount: numberFrom(position.amount),
        price: numberFrom(position.price),
        date: dateFrom(position.date),
      });
    }

    if ((user.positions ?? []).length === 0) {
      positions.push({
        userId,
        ticker: null,
        amount: null,
        price: null,
        date: new Date().toISOString(),
      });
    }
  }

  return positions;
}

export function loadMongoUsers(
  database: Database,
  input: string,
): LoadMongoUsersResult {
  const positions = parseInput(input);
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

    const importedUserIds = new Set<number>();
    for (const position of positions) {
      if (position.userId === null) {
        result.skippedUsers += 1;
        continue;
      }

      insertUser.run(position.userId);
      if (!importedUserIds.has(position.userId)) {
        importedUserIds.add(position.userId);
        result.importedUsers += 1;
      }

      if (
        !position.ticker ||
        position.amount === null ||
        position.price === null
      ) {
        result.skippedPositions += 1;
        continue;
      }

      const changes = insertPosition.run(
        position.userId,
        position.ticker,
        position.amount,
        position.price,
        position.date,
        position.userId,
        position.ticker,
        position.amount,
        position.price,
        position.date,
      );
      result.importedPositions += changes;
      if (changes === 0) {
        result.skippedPositions += 1;
      }
    }

    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
