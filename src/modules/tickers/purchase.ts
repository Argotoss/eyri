import { formatMoneyChange } from "../../utils/money.ts";
import type { PurchaseResult } from "../database/user.ts";

export type PurchaseCommand = {
  ticker: string;
  unitPrice: number;
  amount: number;
  commissionPercent: number;
};

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function parseNumber(value: string | undefined) {
  if (!value) {
    return null;
  }
  const parsed = Number(value.trim().replaceAll(",", "").replace(/^\$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCommissionPercent(value: string | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = parseNumber(value.trim().replace(/%$/, ""));
  return parsed === null ? null : parsed;
}

export function parsePurchaseCommand(input: string): PurchaseCommand | null {
  const params = input.trim().split(/\s+/).filter(Boolean);
  if (params.length !== 3 && params.length !== 4) {
    return null;
  }

  const [ticker, unitPriceInput, amountInput, commissionInput] = params;
  const unitPrice = parseNumber(unitPriceInput);
  const amount = parseNumber(amountInput);
  const commissionPercent = parseCommissionPercent(commissionInput);
  if (
    !ticker ||
    unitPrice === null ||
    amount === null ||
    commissionPercent === null ||
    unitPrice <= 0 ||
    amount === 0 ||
    commissionPercent < 0
  ) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    unitPrice,
    amount,
    commissionPercent,
  };
}

export function parseLegacyBuyCommand(input: string): PurchaseCommand | null {
  const params = input.trim().split(/\s+/).filter(Boolean);
  if (params.length !== 4) {
    return null;
  }

  const [ticker, totalPriceInput, commissionInput, amountInput] = params;
  const totalPrice = parseNumber(totalPriceInput);
  const commission = parseNumber(commissionInput);
  const amount = parseNumber(amountInput);
  if (
    !ticker ||
    totalPrice === null ||
    commission === null ||
    amount === null ||
    totalPrice <= 0 ||
    amount <= 0 ||
    commission < 0
  ) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    unitPrice: totalPrice / amount,
    amount,
    commissionPercent: totalPrice === 0 ? 0 : (commission / totalPrice) * 100,
  };
}

export function formatPurchaseResult(result: PurchaseResult) {
  const commissionText =
    result.commissionPercent > 0
      ? `, commission ${result.commissionPercent.toFixed(4).replace(/\.?0+$/, "")}%`
      : "";

  if (result.kind === "buy") {
    const averageCost =
      result.sharesAfter === 0 ? 0 : result.costBasisAfter / result.sharesAfter;
    return [
      `Bought ${Math.abs(result.amount).toFixed(4)} ${result.ticker} at $${result.unitPrice.toFixed(2)}${commissionText}.`,
      `Position: ${result.sharesAfter.toFixed(4)} shares, avg cost $${averageCost.toFixed(2)}.`,
    ].join("\n");
  }

  const position =
    result.sharesAfter <= 0
      ? "closed"
      : `${result.sharesAfter.toFixed(4)} shares`;
  return [
    `Sold ${Math.abs(result.amount).toFixed(4)} ${result.ticker} at $${result.unitPrice.toFixed(2)}${commissionText}.`,
    `Realized P/L: ${formatMoneyChange(result.realizedPl)}.`,
    `Position: ${position}.`,
  ].join("\n");
}
