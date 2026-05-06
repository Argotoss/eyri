import { formatMoneyChange } from "../../utils/money.ts";
import { getPrices, refreshPersistentPrice } from "../database/price.ts";
import type { Database } from "../database/setup.ts";
import { getPositions, type User } from "../database/user.ts";

type BuildTickerListArgs = {
  database: Database;
  user: User;
  priceOverrides?: Record<string, number>;
};

export async function buildTickerList({
  database,
  user,
  priceOverrides,
}: BuildTickerListArgs) {
  const tickers = user.positions.map((position) => position.ticker);
  for (const ticker of tickers) {
    await refreshPersistentPrice(database, ticker);
  }

  const prices = await getPrices(database, tickers);

  const positions = getPositions(user);
  const now = new Date();
  const earliestDatesByTicker = user.positions.reduce(
    (list, position) => {
      const ticker = position.ticker;
      const positionDate = position.date instanceof Date
        ? position.date
        : new Date(position.date);
      const previousDate = list[ticker];
      if (!previousDate || positionDate < previousDate) {
        list[ticker] = positionDate;
      }
      return list;
    },
    {} as Record<string, Date>,
  );
  const earliestPortfolioDate = Object.values(earliestDatesByTicker).reduce(
    (earliest, date) => (!earliest || date < earliest ? date : earliest),
    null as Date | null,
  );

  const getMonthCount = (startDate: Date, endDate: Date) => {
    const monthDifference =
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth());
    return Math.max(1, monthDifference + 1);
  };

  const formatMoney = (value: number) => `$${value.toFixed(2)}`;
  const formatAmount = (value: number) => value.toFixed(2);

  const tickerLines = Object.entries(positions).map(
    ([ticker, { amount, cost }]) => {
      const currentPrice = priceOverrides?.[ticker] ?? prices[ticker]?.price;
      const oldestDate = earliestDatesByTicker[ticker];
      const monthCount = oldestDate ? getMonthCount(oldestDate, now) : 1;
      const totalInput = cost;
      const averageUnitPrice = amount === 0 ? 0 : totalInput / amount;
      if (currentPrice === undefined || currentPrice === null) {
        return [
          `${ticker} ? ?`,
          `${formatMoney(averageUnitPrice)} x ${formatAmount(amount)} (? ?)`,
          `${formatMoney(totalInput)} ➔ ? x ${monthCount}m`,
        ].join("\n");
      }

      const totalNow = amount * currentPrice;
      const totalChange = totalNow - totalInput;
      const totalPercentageChange = totalInput === 0
        ? 0
        : (totalChange / totalInput) * 100;
      const currentVsAverageChange = currentPrice - averageUnitPrice;

      return [
        `${ticker} ${formatMoneyChange(totalChange)} ${
          formatMoneyChange(totalPercentageChange, "%")
        }`,
        `${formatMoney(averageUnitPrice)} x ${formatAmount(amount)} (${
          formatMoney(currentPrice)
        } ${formatMoneyChange(currentVsAverageChange)})`,
        `${formatMoney(totalInput)} ➔ ${
          formatMoney(totalNow)
        } x ${monthCount}m`,
      ].join("\n");
    },
  );

  const portfolioMonthCount = earliestPortfolioDate
    ? getMonthCount(earliestPortfolioDate, now)
    : 1;
  const portfolioTotals = Object.entries(positions).reduce(
    (totals, [ticker, { amount, cost }]) => {
      const currentPrice = priceOverrides?.[ticker] ?? prices[ticker]?.price;
      totals.totalInput += cost;
      if (currentPrice === undefined || currentPrice === null) {
        totals.hasMissingPrice = true;
        return totals;
      }

      totals.totalNow += amount * currentPrice;
      return totals;
    },
    { totalInput: 0, totalNow: 0, hasMissingPrice: false },
  );

  const totalSummary = portfolioTotals.hasMissingPrice ? "? ? / ? ?" : (() => {
    const totalChange = portfolioTotals.totalNow - portfolioTotals.totalInput;
    const totalPercentageChange = portfolioTotals.totalInput === 0
      ? 0
      : (totalChange / portfolioTotals.totalInput) * 100;
    const monthlyChange = totalChange / portfolioMonthCount;
    const monthlyPercentageChange = totalPercentageChange / portfolioMonthCount;
    return `${formatMoneyChange(totalChange)} ${
      formatMoneyChange(totalPercentageChange, "%")
    } / ${formatMoneyChange(monthlyChange)} ${
      formatMoneyChange(monthlyPercentageChange, "%")
    }`;
  })();

  return [...tickerLines, totalSummary].join("\n\n");
}

export function buildHistory(user: User) {
  const sorted = [...user.positions].sort((posA, posB) => {
    const dateA = posA.date instanceof Date ? posA.date : new Date(posA.date);
    const dateB = posB.date instanceof Date ? posB.date : new Date(posB.date);
    return dateA.getTime() - dateB.getTime();
  });

  const pad = (value: number) => String(value).padStart(2, "0");

  const grouped = new Map<number, { lines: string[]; total: number }>();
  for (const position of sorted) {
    const date = position.date instanceof Date
      ? position.date
      : new Date(position.date);
    const year = date.getFullYear();
    const unitPrice = position.amount === 0
      ? 0
      : position.price / position.amount;
    const line = `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${position.ticker} ${position.amount.toFixed(4)} x $${unitPrice.toFixed(2)} ($${position.price.toFixed(0)})`;
    const group = grouped.get(year) ?? { lines: [], total: 0 };
    group.lines.push(line);
    group.total += position.price;
    grouped.set(year, group);
  }

  let grandTotal = 0;
  const sections = [...grouped.entries()].map(([year, { lines, total }]) => {
    grandTotal += total;
    return `${year} · $${total.toFixed(0)}\n${lines.join("\n")}`;
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
    overrides[ticker] = price;
  }
  return overrides;
}
