import { fetchTickerQuote } from "../tickers/price.ts";
import type { Database } from "./setup.ts";

export type Price = {
  ticker: string;
  price: number;
  closePrice?: number;
  provider?: string;
  sourceTicker?: string;
  date: Date;
};

type PriceRow = {
  ticker: string;
  price: number;
  close_price: number | null;
  provider: string | null;
  source_ticker: string | null;
  date: string;
};

type SavePriceArgs = {
  database: Database;
  ticker: string;
  price: number;
  closePrice?: number;
  provider?: string;
  sourceTicker?: string;
};

export async function savePrice({
  database,
  ticker,
  price,
  closePrice,
  provider,
  sourceTicker,
}: SavePriceArgs) {
  database
    .prepare(`
      INSERT INTO prices (ticker, price, close_price, provider, source_ticker, date)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET
        price = excluded.price,
        close_price = excluded.close_price,
        provider = excluded.provider,
        source_ticker = excluded.source_ticker,
        date = excluded.date
    `)
    .run(
      ticker.trim().toUpperCase(),
      price,
      closePrice ?? null,
      provider ?? null,
      sourceTicker ?? null,
      new Date().toISOString(),
    );
}

export async function getPrices(
  database: Database,
  tickers: string[],
): Promise<Record<string, Price | null>> {
  const uniqueTickers = [
    ...new Set(tickers.map((ticker) => ticker.trim().toUpperCase())),
  ];
  if (uniqueTickers.length === 0) {
    return {};
  }

  const placeholders = uniqueTickers.map(() => "?").join(", ");
  const rows = database
    .prepare(`
      SELECT ticker, price, close_price, provider, source_ticker, date
      FROM prices
      WHERE ticker IN (${placeholders})
    `)
    .all(...uniqueTickers) as PriceRow[];
  const prices = new Map(
    rows.map((row) => [
      row.ticker,
      {
        ticker: row.ticker,
        price: row.price,
        closePrice: row.close_price ?? undefined,
        provider: row.provider ?? undefined,
        sourceTicker: row.source_ticker ?? undefined,
        date: new Date(row.date),
      },
    ]),
  );

  return Object.fromEntries(
    tickers.map((ticker) => [
      ticker,
      prices.get(ticker.trim().toUpperCase()) ?? null,
    ]),
  );
}

export async function refreshPersistentPrice(
  database: Database,
  ticker: string,
) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const quote = await fetchTickerQuote(normalizedTicker);
  if (quote) {
    await savePrice({
      database,
      ticker: normalizedTicker,
      price: quote.price,
      closePrice: quote.closePrice,
      provider: quote.provider,
      sourceTicker: quote.sourceTicker,
    });
  }
}
