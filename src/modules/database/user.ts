import type { ServiceResult } from "../../utils/service.ts";
import type { Database } from "./setup.ts";

export type Position = {
  ticker: string;
  amount: number;
  price: number;
  date: Date;
};

export type User = {
  userId: number;
  positions: Position[];
};

type UserRow = {
  user_id: number;
};

type PositionRow = {
  ticker: string;
  amount: number;
  price: number;
  date: string;
};

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function readPositions(database: Database, userId: number): Position[] {
  const rows = database
    .prepare(`
      SELECT ticker, amount, price, date
      FROM positions
      WHERE user_id = ?
      ORDER BY date, id
    `)
    .all(userId) as PositionRow[];

  return rows.map((row) => ({
    ticker: row.ticker,
    amount: row.amount,
    price: row.price,
    date: new Date(row.date),
  }));
}

function readUser(database: Database, userId: number): User | null {
  const row = database
    .prepare("SELECT user_id FROM users WHERE user_id = ?")
    .get(userId) as UserRow | undefined;

  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    positions: readPositions(database, row.user_id),
  };
}

export async function findOrCreateUser(
  database: Database,
  userId: number,
): Promise<User | null> {
  database
    .prepare(`
      INSERT INTO users (user_id)
      VALUES (?)
      ON CONFLICT(user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `)
    .run(userId);

  return readUser(database, userId);
}

type AddPositionArgs = {
  database: Database;
  userId: number;
  ticker: string;
  price: number;
  amount: number;
};

export async function addPosition({
  database,
  userId,
  ticker,
  price,
  amount,
}: AddPositionArgs): Promise<ServiceResult<null>> {
  const normalizedTicker = normalizeTicker(ticker);
  if (
    !normalizedTicker ||
    !Number.isFinite(price) ||
    !Number.isFinite(amount)
  ) {
    return { success: false, error: "Failed to add position" };
  }

  try {
    database
      .prepare(`
        INSERT INTO positions (user_id, ticker, price, amount, date)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(userId, normalizedTicker, price, amount, new Date().toISOString());

    database
      .prepare(`
        UPDATE users
        SET updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `)
      .run(userId);

    return { success: true, data: null };
  } catch {
    return { success: false, error: "Failed to add position" };
  }
}

export function getPositions(user: User) {
  return user.positions.reduce(
    (list, position) => {
      list[position.ticker] ??= { amount: 0, cost: 0 };
      list[position.ticker].amount += position.amount;
      list[position.ticker].cost += position.price;
      return list;
    },
    {} as Record<string, { amount: number; cost: number }>,
  );
}

export function getAllUsers(database: Database) {
  const rows = database
    .prepare("SELECT user_id FROM users ORDER BY user_id")
    .all() as UserRow[];

  return rows.map((row) => ({
    userId: row.user_id,
    positions: readPositions(database, row.user_id),
  }));
}
