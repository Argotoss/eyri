import type { ServiceResult } from "../../utils/service.ts";
import {
  calculatePurchase,
  EPSILON,
  summarizePortfolio,
  summarizeTransactions,
  type CalculatedPurchase,
  type PortfolioSummary,
  type PositionSummary,
  type TransactionKind,
} from "../tickers/accounting.ts";
import type { Database } from "./setup.ts";

export type Position = {
  ticker: string;
  amount: number;
  price: number;
  date: Date;
  unitPrice?: number;
  commissionPercent: number;
  commissionAmount: number;
  grossValue?: number;
  netCashFlow?: number;
  realizedPl: number;
  sharesBefore?: number;
  sharesAfter?: number;
  costBasisBefore?: number;
  costBasisAfter?: number;
  realizedCostBasisAfter?: number;
  kind?: TransactionKind;
};

export type User = {
  userId: number;
  positions: Position[];
};

export type PurchaseResult = CalculatedPurchase & {
  totalRealizedPl: number;
};

type UserRow = {
  user_id: number;
};

type PositionRow = {
  ticker: string;
  amount: number;
  price: number;
  date: string;
  unit_price: number | null;
  commission_percent: number | null;
  commission_amount: number | null;
  gross_value: number | null;
  net_cash_flow: number | null;
  realized_pl: number | null;
  shares_before: number | null;
  shares_after: number | null;
  cost_basis_before: number | null;
  cost_basis_after: number | null;
  realized_cost_basis_after: number | null;
  kind: TransactionKind | null;
};

export function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function readPositions(database: Database, userId: number): Position[] {
  const rows = database
    .prepare(`
      SELECT
        ticker,
        amount,
        price,
        date,
        unit_price,
        commission_percent,
        commission_amount,
        gross_value,
        net_cash_flow,
        realized_pl,
        shares_before,
        shares_after,
        cost_basis_before,
        cost_basis_after,
        realized_cost_basis_after,
        kind
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
    unitPrice: row.unit_price ?? undefined,
    commissionPercent: row.commission_percent ?? 0,
    commissionAmount: row.commission_amount ?? 0,
    grossValue: row.gross_value ?? undefined,
    netCashFlow: row.net_cash_flow ?? undefined,
    realizedPl: row.realized_pl ?? 0,
    sharesBefore: row.shares_before ?? undefined,
    sharesAfter: row.shares_after ?? undefined,
    costBasisBefore: row.cost_basis_before ?? undefined,
    costBasisAfter: row.cost_basis_after ?? undefined,
    realizedCostBasisAfter: row.realized_cost_basis_after ?? undefined,
    kind: row.kind ?? undefined,
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

type RecordPurchaseArgs = {
  database: Database;
  userId: number;
  ticker: string;
  unitPrice: number;
  amount: number;
  commissionPercent?: number;
};

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function recordPurchase({
  database,
  userId,
  ticker,
  unitPrice,
  amount,
  commissionPercent = 0,
}: RecordPurchaseArgs): Promise<ServiceResult<PurchaseResult>> {
  const normalizedTicker = normalizeTicker(ticker);
  if (
    !normalizedTicker ||
    !finitePositive(unitPrice) ||
    !Number.isFinite(amount) ||
    Math.abs(amount) <= EPSILON ||
    !Number.isFinite(commissionPercent) ||
    commissionPercent < 0
  ) {
    return { success: false, error: "Failed to record purchase" };
  }

  try {
    database.exec("BEGIN");
    database
      .prepare(`
        INSERT INTO users (user_id)
        VALUES (?)
        ON CONFLICT(user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      `)
      .run(userId);

    const user = readUser(database, userId) ?? { userId, positions: [] };
    const currentSummary = getPositionSummaries(user)[normalizedTicker];
    const purchase = calculatePurchase(
      {
        ticker: normalizedTicker,
        unitPrice,
        amount,
        commissionPercent,
      },
      currentSummary,
    );
    const totalRealizedPl =
      (currentSummary?.realizedPl ?? 0) + purchase.realizedPl;
    const storedPrice =
      purchase.kind === "buy"
        ? purchase.grossValue + purchase.commissionAmount
        : purchase.netCashFlow;

    database
      .prepare(`
        INSERT INTO positions (
          user_id,
          ticker,
          price,
          amount,
          unit_price,
          commission_percent,
          commission_amount,
          gross_value,
          net_cash_flow,
          realized_pl,
          shares_before,
          shares_after,
          cost_basis_before,
          cost_basis_after,
          realized_cost_basis_after,
          kind,
          date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        userId,
        normalizedTicker,
        storedPrice,
        purchase.amount,
        purchase.unitPrice,
        purchase.commissionPercent,
        purchase.commissionAmount,
        purchase.grossValue,
        purchase.netCashFlow,
        purchase.realizedPl,
        purchase.sharesBefore,
        purchase.sharesAfter,
        purchase.costBasisBefore,
        purchase.costBasisAfter,
        purchase.realizedCostBasisAfter,
        purchase.kind,
        new Date().toISOString(),
      );

    database
      .prepare(`
        UPDATE users
        SET updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `)
      .run(userId);

    database.exec("COMMIT");
    return { success: true, data: { ...purchase, totalRealizedPl } };
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction may not have started if SQLite failed before BEGIN.
    }
    return { success: false, error: getErrorMessage(error) };
  }
}

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
    !Number.isFinite(amount) ||
    Math.abs(amount) <= EPSILON
  ) {
    return { success: false, error: "Failed to add position" };
  }

  const result = await recordPurchase({
    database,
    userId,
    ticker: normalizedTicker,
    unitPrice: Math.abs(price / amount),
    amount,
    commissionPercent: 0,
  });

  return result.success
    ? { success: true, data: null }
    : { success: false, error: result.error };
}

export function getPositionSummaries(
  user: User,
): Record<string, PositionSummary> {
  return summarizeTransactions(user.positions);
}

export function getPortfolioSummary(user: User): PortfolioSummary {
  return summarizePortfolio(user.positions);
}

export function getPositions(user: User) {
  const summaries = getPositionSummaries(user);
  return Object.fromEntries(
    Object.entries(summaries).filter(
      ([, position]) => position.amount > EPSILON,
    ),
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
