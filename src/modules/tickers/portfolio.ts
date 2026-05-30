import { formatMoneyChange } from "../../utils/money.ts";
import type { PortfolioPosition } from "../ibkr/client.ts";
import type { FlexTrade } from "../ibkr/flex.ts";
import {
  formatDecoratedTicker,
  type TickerDecorations,
  type TickerLabelPreferences,
} from "./decorations.ts";

type BuildTickerListArgs = {
  positions: PortfolioPosition[];
  priceOverrides?: Record<string, number>;
  tickerDecorations?: TickerDecorations;
  tickerLabelPreferences?: TickerLabelPreferences;
};

type BuildTradeHistoryArgs = {
  trades: FlexTrade[];
  tickerDecorations?: TickerDecorations;
  tickerLabelPreferences?: TickerLabelPreferences;
};

type PositionPerformance = {
  position: PortfolioPosition;
  currentPrice: number | null;
  averageUnitPrice: number | null;
  totalInput: number | null;
  totalNow: number | null;
  totalChange: number | null;
  totalPercentageChange: number | null;
  currentVsAverageChange: number | null;
  monthCount: number | null;
  monthlyChange: number | null;
  monthlyPercentageChange: number | null;
};

const formatMoney = (value: number, currency = "USD") =>
  currency === "USD"
    ? `$${value.toFixed(2)}`
    : `${value.toFixed(2)} ${currency}`;
const formatWholeMoney = (value: number, currency = "USD") =>
  currency === "USD"
    ? `$${value.toFixed(0)}`
    : `${value.toFixed(0)} ${currency}`;
const formatAmount = (value: number) => value.toFixed(2);

function getMonthCount(startDate: Date, endDate: Date) {
  const monthDifference =
    (endDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
    (endDate.getUTCMonth() - startDate.getUTCMonth());
  return Math.max(1, monthDifference + 1);
}

function getSortedPositions(positions: PortfolioPosition[]) {
  return [...positions].sort((positionA, positionB) => {
    const totalInputA = positionA.totalInput ?? 0;
    const totalInputB = positionB.totalInput ?? 0;
    return totalInputB - totalInputA;
  });
}

function buildPositionPerformance(
  position: PortfolioPosition,
  now: Date,
  priceOverrides?: Record<string, number>,
): PositionPerformance {
  const currentPrice =
    priceOverrides?.[position.ticker] ?? position.currentPrice;
  const totalInput = position.totalInput;
  const averageUnitPrice = position.averageUnitPrice;
  const monthCount = position.openedAt
    ? getMonthCount(position.openedAt, now)
    : null;

  if (
    currentPrice === undefined ||
    currentPrice === null ||
    totalInput === null ||
    averageUnitPrice === null
  ) {
    return {
      position,
      currentPrice: null,
      averageUnitPrice,
      totalInput,
      totalNow: null,
      totalChange: null,
      totalPercentageChange: null,
      currentVsAverageChange: null,
      monthCount,
      monthlyChange: null,
      monthlyPercentageChange: null,
    };
  }

  const totalNow = position.amount * currentPrice;
  const totalChange = totalNow - totalInput;
  const totalPercentageChange =
    totalInput === 0 ? 0 : (totalChange / totalInput) * 100;

  return {
    position,
    currentPrice,
    averageUnitPrice,
    totalInput,
    totalNow,
    totalChange,
    totalPercentageChange,
    currentVsAverageChange: currentPrice - averageUnitPrice,
    monthCount,
    monthlyChange: monthCount ? totalChange / monthCount : null,
    monthlyPercentageChange: monthCount
      ? totalPercentageChange / monthCount
      : null,
  };
}

function buildPortfolioTotals(performances: PositionPerformance[], now: Date) {
  const earliestPortfolioDate = performances.reduce(
    (earliest, { position }) =>
      !position.openedAt
        ? earliest
        : !earliest || position.openedAt < earliest
          ? position.openedAt
          : earliest,
    null as Date | null,
  );
  const monthCount = earliestPortfolioDate
    ? getMonthCount(earliestPortfolioDate, now)
    : null;

  const totals = performances.reduce(
    (totals, performance) => {
      if (performance.totalInput !== null) {
        totals.totalInput += performance.totalInput;
      }
      if (
        performance.totalInput === null ||
        performance.totalNow === null ||
        performance.totalChange === null
      ) {
        totals.hasMissingPrice = true;
        return totals;
      }

      totals.totalNow += performance.totalNow;
      return totals;
    },
    { totalInput: 0, totalNow: 0, hasMissingPrice: false },
  );

  const hasMissingOpenDate = performances.some(
    ({ position }) => !position.openedAt,
  );
  if (totals.hasMissingPrice) {
    return {
      ...totals,
      totalChange: null,
      totalPercentageChange: null,
      monthCount,
      monthlyChange: null,
      monthlyPercentageChange: null,
      hasMissingOpenDate,
    };
  }

  const totalChange = totals.totalNow - totals.totalInput;
  const totalPercentageChange =
    totals.totalInput === 0 ? 0 : (totalChange / totals.totalInput) * 100;

  return {
    ...totals,
    totalChange,
    totalPercentageChange,
    monthCount,
    monthlyChange: monthCount ? totalChange / monthCount : null,
    monthlyPercentageChange: monthCount
      ? totalPercentageChange / monthCount
      : null,
    hasMissingOpenDate,
  };
}

export async function buildTickerList({
  positions,
  priceOverrides,
  tickerDecorations,
  tickerLabelPreferences,
}: BuildTickerListArgs) {
  const now = new Date();
  const performances = getSortedPositions(positions).map((position) =>
    buildPositionPerformance(position, now, priceOverrides),
  );

  const tickerLines = performances.map((performance) => {
    const { position } = performance;
    const tickerName = formatDecoratedTicker(
      position.ticker,
      tickerDecorations,
      tickerLabelPreferences,
    );
    if (
      performance.currentPrice === null ||
      performance.totalInput === null ||
      performance.totalChange === null ||
      performance.totalPercentageChange === null ||
      performance.averageUnitPrice === null ||
      performance.totalNow === null ||
      performance.currentVsAverageChange === null
    ) {
      return [
        `${tickerName} ? ?`,
        `? x ${formatAmount(position.amount)} (? ?)`,
        `? -> ? x ${performance.monthCount ?? "?"}m`,
      ].join("\n");
    }

    return [
      `${tickerName} ${formatMoneyChange(performance.totalChange)} ${formatMoneyChange(
        performance.totalPercentageChange,
        "%",
      )}`,
      `${formatMoney(performance.averageUnitPrice, position.currency)} x ${formatAmount(
        position.amount,
      )} (${formatMoney(performance.currentPrice, position.currency)} ${formatMoneyChange(
        performance.currentVsAverageChange,
      )})`,
      `${formatMoney(performance.totalInput, position.currency)} -> ${formatMoney(
        performance.totalNow,
        position.currency,
      )} x ${performance.monthCount ?? "?"}m${
        performance.monthlyChange === null ||
        performance.monthlyPercentageChange === null
          ? ""
          : ` (${formatMoneyChange(performance.monthlyChange)} ${formatMoneyChange(
              performance.monthlyPercentageChange,
              "%",
            )}/m)`
      }`,
    ].join("\n");
  });

  const portfolioTotals = buildPortfolioTotals(performances, now);
  const totalSummary =
    portfolioTotals.hasMissingPrice ||
    portfolioTotals.totalChange === null ||
    portfolioTotals.totalPercentageChange === null
      ? "? ? / ? ?"
      : `${formatMoneyChange(portfolioTotals.totalChange)} ${formatMoneyChange(
          portfolioTotals.totalPercentageChange,
          "%",
        )} / ${
          portfolioTotals.hasMissingOpenDate ||
          portfolioTotals.monthlyChange === null ||
          portfolioTotals.monthlyPercentageChange === null
            ? "? ?"
            : `${formatMoneyChange(portfolioTotals.monthlyChange)} ${formatMoneyChange(
                portfolioTotals.monthlyPercentageChange,
                "%",
              )}`
        }`;

  return [...tickerLines, totalSummary].join("\n\n");
}

export async function buildPerformanceList({
  positions,
  priceOverrides,
  tickerDecorations,
  tickerLabelPreferences,
}: BuildTickerListArgs) {
  const now = new Date();
  const performances = getSortedPositions(positions).map((position) =>
    buildPositionPerformance(position, now, priceOverrides),
  );

  const performanceLines = performances.map((performance) => {
    const { position } = performance;
    const tickerName = formatDecoratedTicker(
      position.ticker,
      tickerDecorations,
      tickerLabelPreferences,
    );
    if (
      performance.totalChange === null ||
      performance.totalPercentageChange === null
    ) {
      return `${tickerName} ? ? (${performance.monthCount ?? "?"} month)`;
    }

    return `${tickerName} ${formatMoneyChange(
      performance.totalPercentageChange,
      "%",
    )} ${formatMoneyChange(performance.totalChange)} (${
      performance.monthCount ?? "?"
    } month)`;
  });

  const portfolioTotals = buildPortfolioTotals(performances, now);
  const totalLine =
    portfolioTotals.totalChange === null ||
    portfolioTotals.totalPercentageChange === null
      ? `Total: ? ? (${portfolioTotals.monthCount ?? "?"} month)`
      : `Total: ${formatMoneyChange(portfolioTotals.totalPercentageChange, "%")} ${formatMoneyChange(
          portfolioTotals.totalChange,
        )} (${portfolioTotals.monthCount ?? "?"} month)`;

  return [...performanceLines, totalLine].join("\n\n");
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
    overrides[ticker] = price;
  }
  return overrides;
}

function formatDate(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

const currencyCodes = new Set([
  "AED",
  "AUD",
  "CAD",
  "CHF",
  "CNH",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "USD",
  "ZAR",
]);

function isCurrencyConversionTrade(trade: FlexTrade) {
  const assetCategory = trade.assetCategory?.toUpperCase();
  if (assetCategory === "CASH" || assetCategory === "FOREX") {
    return true;
  }

  const [base, quote] = trade.ticker.toUpperCase().split(".");
  return Boolean(
    base &&
      quote &&
      currencyCodes.has(base) &&
      currencyCodes.has(quote),
  );
}

function getTradeHistoryKey(trade: FlexTrade) {
  return [
    trade.date.toISOString().slice(0, 10),
    trade.ticker,
    trade.currency ?? "USD",
  ].join(":");
}

function buildTradeHistoryGroups(trades: FlexTrade[]) {
  const grouped = new Map<
    string,
    {
      date: Date;
      ticker: string;
      currency: string;
      quantity: number;
      total: number;
    }
  >();

  for (const trade of trades) {
    if (
      trade.quantity <= 0 ||
      trade.price === null ||
      isCurrencyConversionTrade(trade)
    ) {
      continue;
    }

    const key = getTradeHistoryKey(trade);
    const group = grouped.get(key) ?? {
      date: trade.date,
      ticker: trade.ticker,
      currency: trade.currency ?? "USD",
      quantity: 0,
      total: 0,
    };
    group.quantity += trade.quantity;
    group.total += trade.quantity * trade.price;
    grouped.set(key, group);
  }

  return [...grouped.values()].sort(
    (groupA, groupB) => groupA.date.getTime() - groupB.date.getTime(),
  );
}

export function buildTradeHistory({
  trades,
  tickerDecorations,
  tickerLabelPreferences,
}: BuildTradeHistoryArgs) {
  const sorted = buildTradeHistoryGroups(trades);
  if (sorted.length === 0) {
    return "";
  }

  const grouped = new Map<number, string[]>();
  const yearTotals = new Map<number, { total: number; currency: string }>();
  let totalSpent = 0;
  let totalCurrency = "USD";

  for (const group of sorted) {
    const year = group.date.getUTCFullYear();
    const lines = grouped.get(year) ?? [];
    const averagePrice = group.total / group.quantity;
    const tickerName = formatDecoratedTicker(
      group.ticker,
      tickerDecorations,
      tickerLabelPreferences,
    );
    lines.push(
      `${formatDate(group.date)} ${tickerName} ${group.quantity.toFixed(
        4,
      )} x ${formatMoney(averagePrice, group.currency)} (${formatWholeMoney(
        group.total,
        group.currency,
      )})`,
    );
    grouped.set(year, lines);

    const yearTotal = yearTotals.get(year) ?? {
      total: 0,
      currency: group.currency,
    };
    yearTotal.total += group.total;
    yearTotals.set(year, yearTotal);
    totalSpent += group.total;
    totalCurrency = group.currency;
  }

  const yearBlocks = [...grouped.entries()].map(([year, lines]) => {
    const yearTotal = yearTotals.get(year);
    const header = yearTotal
      ? `${year} · ${formatWholeMoney(yearTotal.total, yearTotal.currency)}`
      : String(year);
    return `${header}\n${lines.join("\n")}`;
  });

  return `${yearBlocks.join("\n\n")}\n\nTotal ${formatWholeMoney(
    totalSpent,
    totalCurrency,
  )}`;
}
