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
      const positionDate =
        position.date instanceof Date ? position.date : new Date(position.date);
      const previousDate = list[ticker];
      if (!previousDate || positionDate < previousDate) {
        list[ticker] = positionDate;
      }
      return list;
    },
    {} as Record<string, Date>,
  );

  const getMonthCount = (startDate: Date, endDate: Date) => {
    const monthDifference =
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth());
    return Math.max(1, monthDifference + 1);
  };

  const formatMoney = (value: number) => `$${value.toFixed(2)}`;
  const formatAmount = (value: number) => value.toFixed(2);

  return Object.entries(positions)
    .map(([ticker, { amount, cost }]) => {
      const currentPrice = priceOverrides?.[ticker] ?? prices[ticker]?.price;
      const oldestDate = earliestDatesByTicker[ticker];
      const monthCount = oldestDate ? getMonthCount(oldestDate, now) : 1;
      const totalInput = cost;
      const averageUnitPrice = amount === 0 ? 0 : totalInput / amount;
      if (!currentPrice) {
        return [
          `${ticker} ? ?`,
          `${formatMoney(averageUnitPrice)} x ${formatAmount(amount)} (? ?)`,
          `${formatMoney(totalInput)} ➔ ? x ${monthCount}m`,
        ].join("\n");
      }

      const totalNow = amount * currentPrice;
      const totalChange = totalNow - totalInput;
      const totalPercentageChange =
        totalInput === 0 ? 0 : (totalChange / totalInput) * 100;
      const currentVsAveragePercentageChange =
        averageUnitPrice === 0
          ? 0
          : ((currentPrice - averageUnitPrice) / averageUnitPrice) * 100;

      return [
        `${ticker} ${formatMoneyChange(totalChange)} ${formatMoneyChange(totalPercentageChange, "%")}`,
        `${formatMoney(averageUnitPrice)} x ${formatAmount(amount)} (${formatMoney(currentPrice)} ${formatMoneyChange(currentVsAveragePercentageChange, "%")})`,
        `${formatMoney(totalInput)} ➔ ${formatMoney(totalNow)} x ${monthCount}m`,
      ].join("\n");
    })
    .join("\n");
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
