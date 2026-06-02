export const EPSILON = 1e-9;

export type TransactionKind = "buy" | "sell";

export type AccountingTransaction = {
  ticker: string;
  amount: number;
  price: number;
  date: Date;
  unitPrice?: number;
  commissionPercent?: number;
  commissionAmount?: number;
  grossValue?: number;
  netCashFlow?: number;
  realizedPl?: number;
  sharesBefore?: number;
  sharesAfter?: number;
  costBasisBefore?: number;
  costBasisAfter?: number;
  realizedCostBasisAfter?: number;
  kind?: TransactionKind;
};

export type PositionSummary = {
  amount: number;
  cost: number;
  oldestDate?: Date;
  firstTransactionDate?: Date;
  realizedPl: number;
  realizedCostBasis: number;
};

export type PortfolioSummary = {
  firstTransactionDate?: Date;
  openCostBasis: number;
  realizedPl: number;
  realizedCostBasis: number;
};

export type PurchaseInput = {
  ticker: string;
  unitPrice: number;
  amount: number;
  commissionPercent: number;
};

export type CalculatedPurchase = {
  ticker: string;
  kind: TransactionKind;
  unitPrice: number;
  amount: number;
  commissionPercent: number;
  commissionAmount: number;
  grossValue: number;
  netCashFlow: number;
  realizedPl: number;
  sharesBefore: number;
  sharesAfter: number;
  costBasisBefore: number;
  costBasisAfter: number;
  realizedCostBasisAfter: number;
};

function emptySummary(): PositionSummary {
  return {
    amount: 0,
    cost: 0,
    realizedPl: 0,
    realizedCostBasis: 0,
  };
}

function copyDate(value?: Date) {
  return value ? new Date(value.getTime()) : undefined;
}

function normalizeNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function transactionUnitPrice(transaction: AccountingTransaction) {
  if (Number.isFinite(transaction.unitPrice)) {
    return Number(transaction.unitPrice);
  }
  if (Math.abs(transaction.amount) <= EPSILON) {
    return 0;
  }
  return Math.abs(transaction.price / transaction.amount);
}

function transactionGrossValue(transaction: AccountingTransaction) {
  if (Number.isFinite(transaction.grossValue)) {
    return Number(transaction.grossValue);
  }
  if (transaction.amount > 0) {
    return Math.abs(transaction.price);
  }
  return Math.abs(transaction.amount) * transactionUnitPrice(transaction);
}

export function summarizeTransactions(
  transactions: AccountingTransaction[],
): Record<string, PositionSummary> {
  const summaries: Record<string, PositionSummary> = {};
  const sorted = [...transactions].sort(
    (left, right) => left.date.getTime() - right.date.getTime(),
  );

  for (const transaction of sorted) {
    const ticker = transaction.ticker.trim().toUpperCase();
    if (!ticker || Math.abs(transaction.amount) <= EPSILON) {
      continue;
    }

    const summary = summaries[ticker] ?? emptySummary();
    if (
      !summary.firstTransactionDate ||
      transaction.date < summary.firstTransactionDate
    ) {
      summary.firstTransactionDate = copyDate(transaction.date);
    }

    if (transaction.amount > 0) {
      if (summary.amount <= EPSILON) {
        summary.oldestDate = copyDate(transaction.date);
      }
      summary.amount += transaction.amount;
      summary.cost +=
        transactionGrossValue(transaction) +
        normalizeNumber(transaction.commissionAmount, 0);
      summaries[ticker] = summary;
      continue;
    }

    const sellAmount = Math.abs(transaction.amount);
    const removableAmount = Math.min(sellAmount, Math.max(summary.amount, 0));
    const averageCost =
      summary.amount <= EPSILON ? 0 : summary.cost / summary.amount;
    const inferredCostRemoved = averageCost * removableAmount;
    const storedCostRemoved =
      Number.isFinite(transaction.costBasisBefore) &&
      Number.isFinite(transaction.costBasisAfter)
        ? Math.max(
            0,
            Number(transaction.costBasisBefore) -
              Number(transaction.costBasisAfter),
          )
        : inferredCostRemoved;
    const grossValue = transactionGrossValue(transaction);
    const commissionAmount = normalizeNumber(transaction.commissionAmount, 0);
    const inferredRealizedPl =
      grossValue - commissionAmount - storedCostRemoved;

    summary.amount -= removableAmount;
    summary.cost -= storedCostRemoved;
    summary.realizedPl += normalizeNumber(
      transaction.realizedPl,
      inferredRealizedPl,
    );
    summary.realizedCostBasis += storedCostRemoved;

    if (summary.amount <= EPSILON) {
      summary.amount = 0;
      summary.cost = 0;
      summary.oldestDate = undefined;
    }
    summaries[ticker] = summary;
  }

  return summaries;
}

export function summarizePortfolio(
  transactions: AccountingTransaction[],
): PortfolioSummary {
  const tickerSummaries = summarizeTransactions(transactions);
  return Object.values(tickerSummaries).reduce(
    (summary, tickerSummary) => {
      summary.openCostBasis += tickerSummary.cost;
      summary.realizedPl += tickerSummary.realizedPl;
      summary.realizedCostBasis += tickerSummary.realizedCostBasis;
      if (
        tickerSummary.firstTransactionDate &&
        (!summary.firstTransactionDate ||
          tickerSummary.firstTransactionDate < summary.firstTransactionDate)
      ) {
        summary.firstTransactionDate = copyDate(
          tickerSummary.firstTransactionDate,
        );
      }
      return summary;
    },
    {
      openCostBasis: 0,
      realizedPl: 0,
      realizedCostBasis: 0,
    } as PortfolioSummary,
  );
}

export function calculatePurchase(
  input: PurchaseInput,
  currentSummary?: PositionSummary,
): CalculatedPurchase {
  const sharesBefore = currentSummary?.amount ?? 0;
  const costBasisBefore = currentSummary?.cost ?? 0;
  const realizedCostBasisBefore = currentSummary?.realizedCostBasis ?? 0;
  const grossValue = Math.abs(input.amount) * input.unitPrice;
  const commissionAmount = grossValue * (input.commissionPercent / 100);

  if (input.amount > 0) {
    return {
      ticker: input.ticker,
      kind: "buy",
      unitPrice: input.unitPrice,
      amount: input.amount,
      commissionPercent: input.commissionPercent,
      commissionAmount,
      grossValue,
      netCashFlow: -(grossValue + commissionAmount),
      realizedPl: 0,
      sharesBefore,
      sharesAfter: sharesBefore + input.amount,
      costBasisBefore,
      costBasisAfter: costBasisBefore + grossValue + commissionAmount,
      realizedCostBasisAfter: realizedCostBasisBefore,
    };
  }

  const sellAmount = Math.abs(input.amount);
  if (sharesBefore + EPSILON < sellAmount) {
    throw new Error(
      `Cannot sell ${sellAmount} ${input.ticker}; only ${sharesBefore} shares are held.`,
    );
  }

  const averageCost =
    sharesBefore <= EPSILON ? 0 : costBasisBefore / sharesBefore;
  const costRemoved = averageCost * sellAmount;
  const proceeds = grossValue - commissionAmount;
  const sharesAfter = sharesBefore - sellAmount;
  const costBasisAfter =
    sharesAfter <= EPSILON ? 0 : costBasisBefore - costRemoved;

  return {
    ticker: input.ticker,
    kind: "sell",
    unitPrice: input.unitPrice,
    amount: input.amount,
    commissionPercent: input.commissionPercent,
    commissionAmount,
    grossValue,
    netCashFlow: proceeds,
    realizedPl: proceeds - costRemoved,
    sharesBefore,
    sharesAfter: sharesAfter <= EPSILON ? 0 : sharesAfter,
    costBasisBefore,
    costBasisAfter,
    realizedCostBasisAfter: realizedCostBasisBefore + costRemoved,
  };
}
