import { formatMoneyChange } from "../../utils/money.ts";
import { getPrices, refreshPersistentPrice } from "../database/price.ts";
import type { Database } from "../database/setup.ts";
import {
  getPortfolioSummary,
  getPositionSummaries,
  type User,
} from "../database/user.ts";
import {
  formatDecoratedTicker,
  type TickerDecorations,
  type TickerLabelLinks,
  type TickerLabelPreferences,
} from "./decorations.ts";

type BuildTickerListArgs = {
  database: Database;
  user: User;
  priceOverrides?: Record<string, number>;
  tickerDecorations?: TickerDecorations;
  tickerLabelPreferences?: TickerLabelPreferences;
  tickerLabelLinks?: TickerLabelLinks;
};

type BuildHistoryArgs = {
  user: User;
  tickerDecorations?: TickerDecorations;
  tickerLabelPreferences?: TickerLabelPreferences;
  tickerLabelLinks?: TickerLabelLinks;
};

const formatMoney = (value: number) => `$${value.toFixed(2)}`;
const formatAmount = (value: number) => value.toFixed(2);
const formatSignedMoney = (value: number) => formatMoneyChange(value);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 365.2425 / 12;

function getElapsedMonthCount(startDate: Date, endDate: Date) {
  const elapsedDays = Math.max(
    0,
    (endDate.getTime() - startDate.getTime()) / MILLISECONDS_PER_DAY,
  );
  return elapsedDays / DAYS_PER_MONTH;
}

function formatElapsedPeriodFromMonths(months: number) {
  if (months < 12) {
    return `${months.toFixed(1)} month`;
  }

  const years = Math.floor(months / 12);
  const remainingMonths = months - years * 12;
  return `${years} year ${remainingMonths.toFixed(1)} month`;
}

function getElapsedPeriod(startDate: Date | null | undefined, endDate: Date) {
  const months = startDate ? getElapsedMonthCount(startDate, endDate) : 0;
  return {
    months: Math.max(months, 0.1),
    label: formatElapsedPeriodFromMonths(months),
  };
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function openPositionEntries(user: User) {
  return Object.entries(getPositionSummaries(user)).filter(
    ([, position]) => position.amount > 0,
  );
}

export async function buildTickerList({
  database,
  user,
  priceOverrides,
  tickerDecorations,
  tickerLabelPreferences,
  tickerLabelLinks,
}: BuildTickerListArgs) {
  if (user.positions.length === 0) {
    return "";
  }

  const positionSummaries = getPositionSummaries(user);
  const positions = Object.entries(positionSummaries).filter(
    ([, position]) => position.amount > 0,
  );
  const portfolioSummary = getPortfolioSummary(user);
  const tickers = positions.map(([ticker]) => ticker);
  await Promise.all(
    [...new Set(tickers)].map((ticker) =>
      refreshPersistentPrice(database, ticker),
    ),
  );

  const prices = await getPrices(database, tickers);
  const now = new Date();

  const tickerLines = positions.map(([ticker, { amount, cost }]) => {
    const tickerName = formatDecoratedTicker(
      ticker,
      tickerDecorations,
      tickerLabelPreferences,
      tickerLabelLinks,
    );
    const currentPrice = priceOverrides?.[ticker] ?? prices[ticker]?.price;
    const oldestDate = positionSummaries[ticker]?.oldestDate;
    const elapsedPeriod = getElapsedPeriod(oldestDate, now);
    const totalInput = cost;
    const averageUnitPrice = amount === 0 ? 0 : totalInput / amount;
    if (currentPrice === undefined || currentPrice === null) {
      return [
        `${tickerName} ? ?`,
        `${formatMoney(averageUnitPrice)} x ${formatAmount(amount)} (? ?)`,
        `${formatMoney(totalInput)} -> ? x ${elapsedPeriod.label}`,
      ].join("\n");
    }

    const totalNow = amount * currentPrice;
    const totalChange = totalNow - totalInput;
    const totalPercentageChange =
      totalInput === 0 ? 0 : (totalChange / totalInput) * 100;
    const currentVsAverageChange = currentPrice - averageUnitPrice;

    return [
      `${tickerName} ${formatMoneyChange(totalChange)} ${formatMoneyChange(
        totalPercentageChange,
        "%",
      )}`,
      `${formatMoney(averageUnitPrice)} x ${formatAmount(amount)} (${formatMoney(
        currentPrice,
      )} ${formatMoneyChange(currentVsAverageChange)})`,
      `${formatMoney(totalInput)} -> ${formatMoney(
        totalNow,
      )} x ${elapsedPeriod.label}`,
    ].join("\n");
  });

  const portfolioElapsedPeriod = getElapsedPeriod(
    portfolioSummary.firstTransactionDate,
    now,
  );
  const portfolioTotals = positions.reduce(
    (totals, [ticker, { amount, cost }]) => {
      const currentPrice = priceOverrides?.[ticker] ?? prices[ticker]?.price;
      totals.openCost += cost;
      if (currentPrice === undefined || currentPrice === null) {
        totals.hasMissingPrice = true;
        return totals;
      }

      totals.totalNow += amount * currentPrice;
      return totals;
    },
    { openCost: 0, totalNow: 0, hasMissingPrice: false },
  );

  const totalSummary = portfolioTotals.hasMissingPrice
    ? `? ? / ? ? (${portfolioElapsedPeriod.label})`
    : (() => {
        const unrealizedChange =
          portfolioTotals.totalNow - portfolioTotals.openCost;
        const totalChange = unrealizedChange + portfolioSummary.realizedPl;
        const totalBasis =
          portfolioTotals.openCost + portfolioSummary.realizedCostBasis;
        const totalPercentageChange =
          totalBasis === 0 ? 0 : (totalChange / totalBasis) * 100;
        const monthlyChange = totalChange / portfolioElapsedPeriod.months;
        const monthlyPercentageChange =
          totalPercentageChange / portfolioElapsedPeriod.months;
        return `${formatMoneyChange(totalChange)} ${formatMoneyChange(
          totalPercentageChange,
          "%",
        )} / ${formatMoneyChange(monthlyChange)} ${formatMoneyChange(
          monthlyPercentageChange,
          "%",
        )} (${portfolioElapsedPeriod.label})`;
      })();

  const realizedLine =
    Math.abs(portfolioSummary.realizedPl) > 0.005
      ? [`Realized: ${formatSignedMoney(portfolioSummary.realizedPl)}`]
      : [];
  return [...tickerLines, ...realizedLine, totalSummary].join("\n\n");
}

export async function buildPerformanceList({
  database,
  user,
  priceOverrides,
  tickerDecorations,
  tickerLabelPreferences,
  tickerLabelLinks,
}: BuildTickerListArgs) {
  if (user.positions.length === 0) {
    return "";
  }

  const positions = openPositionEntries(user);
  const portfolioSummary = getPortfolioSummary(user);
  const tickers = positions.map(([ticker]) => ticker);
  await Promise.all(
    [...new Set(tickers)].map((ticker) =>
      refreshPersistentPrice(database, ticker),
    ),
  );

  const prices = await getPrices(database, tickers);
  const now = new Date();

  let totalInput = 0;
  let totalNow = 0;
  let hasMissingPrice = false;

  const lines = positions.map(([ticker, position]) => {
    const tickerName = formatDecoratedTicker(
      ticker,
      tickerDecorations,
      tickerLabelPreferences,
      tickerLabelLinks,
    );
    const currentPrice = priceOverrides?.[ticker] ?? prices[ticker]?.price;
    const elapsedPeriod = getElapsedPeriod(position.oldestDate, now);
    totalInput += position.cost;

    if (currentPrice === undefined || currentPrice === null) {
      hasMissingPrice = true;
      return `${tickerName} ? ? (${elapsedPeriod.label})`;
    }

    const tickerTotalNow = position.amount * currentPrice;
    const change = tickerTotalNow - position.cost;
    const percentageChange =
      position.cost === 0 ? 0 : (change / position.cost) * 100;
    totalNow += tickerTotalNow;

    return `${tickerName} ${formatMoneyChange(
      percentageChange,
      "%",
    )} ${formatMoneyChange(change)} (${elapsedPeriod.label})`;
  });

  const portfolioElapsedPeriod = getElapsedPeriod(
    portfolioSummary.firstTransactionDate,
    now,
  );
  const totalLine = hasMissingPrice
    ? `Total: ? ? (${portfolioElapsedPeriod.label})`
    : (() => {
        const change = totalNow - totalInput + portfolioSummary.realizedPl;
        const basis = totalInput + portfolioSummary.realizedCostBasis;
        const percentageChange = basis === 0 ? 0 : (change / basis) * 100;
        return `Total: ${formatMoneyChange(
          percentageChange,
          "%",
        )} ${formatMoneyChange(change)} (${portfolioElapsedPeriod.label})`;
      })();

  return [...lines, totalLine].join("\n\n");
}

export function buildHistory({
  user,
  tickerDecorations,
  tickerLabelPreferences,
  tickerLabelLinks,
}: BuildHistoryArgs) {
  if (user.positions.length === 0) {
    return "";
  }

  const sorted = [...user.positions].sort((posA, posB) => {
    const dateA = toDate(posA.date);
    const dateB = toDate(posB.date);
    return dateA.getTime() - dateB.getTime();
  });

  const pad = (value: number) => String(value).padStart(2, "0");

  const grouped = new Map<number, { lines: string[]; total: number }>();
  for (const position of sorted) {
    const date = toDate(position.date);
    const year = date.getFullYear();
    const unitPrice =
      position.unitPrice ??
      (position.amount === 0 ? 0 : Math.abs(position.price / position.amount));
    const tickerName = formatDecoratedTicker(
      position.ticker,
      tickerDecorations,
      tickerLabelPreferences,
      tickerLabelLinks,
    );
    const isSell = position.amount < 0 || position.kind === "sell";
    const totalCost = isSell
      ? (position.netCashFlow ?? position.price)
      : (position.grossValue ?? position.price) + position.commissionAmount;
    const realized = isSell ? ` ${formatSignedMoney(position.realizedPl)}` : "";
    const line = `${pad(date.getDate())}.${pad(
      date.getMonth() + 1,
    )} ${isSell ? "SELL" : "BUY"} ${tickerName} ${Math.abs(position.amount).toFixed(4)} x $${unitPrice.toFixed(
      2,
    )} ($${totalCost.toFixed(0)}${realized})`;
    const group = grouped.get(year) ?? { lines: [], total: 0 };
    group.lines.push(line);
    if (!isSell) {
      group.total += totalCost;
    }
    grouped.set(year, group);
  }

  let grandTotal = 0;
  const sections = [...grouped.entries()].map(([year, { lines, total }]) => {
    grandTotal += total;
    return `${year} - $${total.toFixed(0)}\n${lines.join("\n")}`;
  });

  sections.push(`Total $${grandTotal.toFixed(0)}`);
  return sections.join("\n\n");
}

export function parsePriceOverrides(
  input: string,
): Record<string, number> | null {
  const pairs = input.split(" ");
  const overrides: Record<string, number> = {};
  for (const pair of pairs) {
    const [ticker, priceStr] = pair.split("=");
    const price = Number(priceStr);
    if (!ticker || !priceStr || Number.isNaN(price)) {
      return null;
    }
    overrides[ticker.trim().toUpperCase()] = price;
  }
  return overrides;
}
