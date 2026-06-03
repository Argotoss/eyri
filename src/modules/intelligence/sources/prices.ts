import { fetchTickerQuote, toYahooSymbol } from "../../tickers/price.ts";
import type { IntelHorizon, MarketSnapshot } from "../types.ts";

const YAHOO_CHART_BASE_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart";

type JsonRecord = Record<string, unknown>;

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function historyRangeForHorizon(horizon: IntelHorizon) {
  if (horizon === "14d") {
    return "1mo";
  }
  if (horizon === "3d") {
    return "5d";
  }
  return "5d";
}

async function fetchYahooHistory(ticker: string, horizon: IntelHorizon) {
  const sourceTicker = toYahooSymbol(ticker);
  const url = new URL(
    `/v8/finance/chart/${encodeURIComponent(sourceTicker)}`,
    YAHOO_CHART_BASE_URL,
  );
  url.searchParams.set("range", historyRangeForHorizon(horizon));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "true");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as JsonRecord;
    const chart = data.chart as JsonRecord | undefined;
    const results = chart?.result as JsonRecord[] | undefined;
    const result = results?.[0];
    const indicators = result?.indicators as JsonRecord | undefined;
    const quotes = indicators?.quote as JsonRecord[] | undefined;
    const quote = quotes?.[0];
    const closes =
      (quote?.close as unknown[] | undefined)
        ?.map(toNumber)
        .filter((value): value is number => value !== null && value > 0) ?? [];
    const volumes =
      (quote?.volume as unknown[] | undefined)
        ?.map(toNumber)
        .filter((value): value is number => value !== null && value >= 0) ?? [];
    if (closes.length === 0) {
      return null;
    }

    const previousPrice = closes[0];
    const latestVolume = volumes.at(-1);
    const previousVolumes = volumes.slice(0, -1);
    const averageVolume =
      previousVolumes.length === 0
        ? undefined
        : previousVolumes.reduce((sum, volume) => sum + volume, 0) /
          previousVolumes.length;

    return {
      previousPrice,
      volume: latestVolume,
      averageVolume,
      volumeRatio:
        latestVolume !== undefined && averageVolume && averageVolume > 0
          ? latestVolume / averageVolume
          : undefined,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function fetchMarketSnapshot(
  ticker: string,
  horizon: IntelHorizon,
): Promise<MarketSnapshot | null> {
  const quote = await fetchTickerQuote(ticker);
  if (!quote) {
    return null;
  }

  const history = await fetchYahooHistory(ticker, horizon);
  const previousPrice =
    horizon === "1d" ? quote.closePrice : history?.previousPrice;
  const percentChange =
    previousPrice && previousPrice > 0
      ? ((quote.price - previousPrice) / previousPrice) * 100
      : undefined;

  return {
    ticker: ticker.trim().toUpperCase(),
    horizon,
    price: quote.price,
    previousPrice,
    closePrice: quote.closePrice,
    percentChange,
    volume: history?.volume,
    averageVolume: history?.averageVolume,
    volumeRatio: history?.volumeRatio,
    provider: quote.provider,
    sourceTicker: quote.sourceTicker,
    fetchedAt: new Date(),
  };
}

export async function collectMarketSnapshots(
  tickers: string[],
  horizon: IntelHorizon,
) {
  const limit = envNumber("INTEL_PRICE_TICKER_LIMIT", 60);
  const uniqueTickers = [
    ...new Set(tickers.map((ticker) => ticker.trim().toUpperCase())),
  ].slice(0, limit);
  const snapshots: MarketSnapshot[] = [];

  for (const ticker of uniqueTickers) {
    const snapshot = await fetchMarketSnapshot(ticker, horizon);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  return snapshots;
}
