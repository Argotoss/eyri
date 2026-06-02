const TWELVE_BASE_URL = "https://api.twelvedata.com";
const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const ALPACA_DATA_BASE_URL = "https://data.alpaca.markets";
const YAHOO_CHART_BASE_URL =
  "https://query1.finance.yahoo.com/v8/finance/chart";
const STOOQ_BASE_URL = "https://stooq.com";

type JsonRecord = Record<string, unknown>;

export type PriceProvider =
  | "twelve_data"
  | "finnhub"
  | "alpaca_iex"
  | "yahoo_chart"
  | "stooq";

export type TickerQuote = {
  ticker: string;
  sourceTicker: string;
  provider: PriceProvider;
  price: number;
  closePrice?: number;
};

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function toNumber(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === "N/D"
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function splitTicker(ticker: string) {
  const normalized = normalizeTicker(ticker);
  const [base, exchange] = normalized.split(":", 2);
  return { base, exchange, normalized };
}

function isUsExchange(exchange?: string) {
  return (
    !exchange ||
    ["NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "IEX"].includes(exchange)
  );
}

export function toUsProviderSymbol(ticker: string) {
  const { base, exchange } = splitTicker(ticker);
  return isUsExchange(exchange) ? base : null;
}

export function toYahooSymbol(ticker: string) {
  const { base, exchange, normalized } = splitTicker(ticker);
  if (!exchange) {
    return normalized;
  }

  const suffixes: Record<string, string> = {
    LON: ".L",
    LSE: ".L",
    NYSE: "",
    NASDAQ: "",
    AMEX: "",
    ARCA: "",
    AMS: ".AS",
    EPA: ".PA",
    PAR: ".PA",
    XETRA: ".DE",
    FRA: ".DE",
    MIL: ".MI",
    TSE: ".TO",
  };
  return `${base}${suffixes[exchange] ?? `.${exchange.toLowerCase()}`}`;
}

export function toStooqSymbol(ticker: string) {
  const { base, exchange, normalized } = splitTicker(ticker);
  if (!exchange) {
    return `${normalized}.us`.toLowerCase();
  }

  const suffixes: Record<string, string> = {
    LON: ".uk",
    LSE: ".uk",
    NYSE: ".us",
    NASDAQ: ".us",
    AMEX: ".us",
    ARCA: ".us",
    AMS: ".nl",
    EPA: ".fr",
    PAR: ".fr",
    XETRA: ".de",
    FRA: ".de",
    MIL: ".it",
  };
  return `${base}${suffixes[exchange] ?? ""}`.toLowerCase();
}

async function fetchJson(url: URL, headers?: Record<string, string>) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as JsonRecord;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function fetchText(url: URL) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function fetchTwelveDataQuote(
  ticker: string,
): Promise<TickerQuote | null> {
  const apiKey = env("TWELVE_DATA_API_KEY");
  if (!apiKey) {
    return null;
  }

  const sourceTicker = normalizeTicker(ticker);
  const url = new URL("/quote", TWELVE_BASE_URL);
  url.searchParams.set("symbol", sourceTicker);
  url.searchParams.set("apikey", apiKey);
  const data = await fetchJson(url);
  if (!data || data.status === "error") {
    return null;
  }

  const price = toNumber(data.close) ?? toNumber(data.price);
  if (price === null || price <= 0) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    sourceTicker,
    provider: "twelve_data",
    price,
    closePrice: toNumber(data.previous_close) ?? undefined,
  };
}

async function fetchFinnhubQuote(ticker: string): Promise<TickerQuote | null> {
  const apiKey = env("FINNHUB_API_KEY");
  const sourceTicker = toUsProviderSymbol(ticker);
  if (!apiKey || !sourceTicker) {
    return null;
  }

  const url = new URL("/api/v1/quote", FINNHUB_BASE_URL);
  url.searchParams.set("symbol", sourceTicker);
  url.searchParams.set("token", apiKey);
  const data = await fetchJson(url);
  const price = toNumber(data?.c);
  if (!data || price === null || price <= 0) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    sourceTicker,
    provider: "finnhub",
    price,
    closePrice: toNumber(data.pc) ?? undefined,
  };
}

async function fetchAlpacaQuote(ticker: string): Promise<TickerQuote | null> {
  const apiKey = env("ALPACA_API_KEY");
  const apiSecret = env("ALPACA_API_SECRET");
  const sourceTicker = toUsProviderSymbol(ticker);
  if (!apiKey || !apiSecret || !sourceTicker) {
    return null;
  }

  const url = new URL(
    `/v2/stocks/${encodeURIComponent(sourceTicker)}/trades/latest`,
    ALPACA_DATA_BASE_URL,
  );
  const data = await fetchJson(url, {
    "APCA-API-KEY-ID": apiKey,
    "APCA-API-SECRET-KEY": apiSecret,
  });
  const trade = data?.trade as JsonRecord | undefined;
  const price = toNumber(trade?.p);
  if (price === null || price <= 0) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    sourceTicker,
    provider: "alpaca_iex",
    price,
  };
}

async function fetchYahooQuote(ticker: string): Promise<TickerQuote | null> {
  const sourceTicker = toYahooSymbol(ticker);
  const url = new URL(
    `/v8/finance/chart/${encodeURIComponent(sourceTicker)}`,
    YAHOO_CHART_BASE_URL,
  );
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1m");
  url.searchParams.set("includePrePost", "true");

  const data = await fetchJson(url, { "User-Agent": "Mozilla/5.0" });
  const chart = data?.chart as JsonRecord | undefined;
  const results = chart?.result as JsonRecord[] | undefined;
  const result = results?.[0];
  const meta = result?.meta as JsonRecord | undefined;
  const indicators = result?.indicators as JsonRecord | undefined;
  const quotes = indicators?.quote as JsonRecord[] | undefined;
  const quote = quotes?.[0];
  const closes = quote?.close as unknown[] | undefined;
  const lastClose = [...(closes ?? [])]
    .reverse()
    .find((value) => toNumber(value) !== null);
  const price = toNumber(lastClose) ?? toNumber(meta?.regularMarketPrice);
  if (price === null || price <= 0) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    sourceTicker,
    provider: "yahoo_chart",
    price,
    closePrice:
      toNumber(meta?.chartPreviousClose) ??
      toNumber(meta?.regularMarketPreviousClose) ??
      undefined,
  };
}

export function parseStooqCsv(data: string) {
  const line = data.trim().split(/\r?\n/).at(-1);
  if (!line) {
    return null;
  }
  const fields = line.split(",");
  const price = toNumber(fields.at(6));
  return price === null || price <= 0 ? null : price;
}

async function fetchStooqQuote(ticker: string): Promise<TickerQuote | null> {
  const sourceTicker = toStooqSymbol(ticker);
  const url = new URL("/q/l/", STOOQ_BASE_URL);
  url.searchParams.set("s", sourceTicker);
  url.searchParams.set("f", "sd2t2ohlcv");
  url.searchParams.set("h", "");
  url.searchParams.set("e", "csv");
  const data = await fetchText(url);
  const price = data ? parseStooqCsv(data) : null;
  if (price === null) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    sourceTicker,
    provider: "stooq",
    price,
  };
}

export async function fetchTickerQuote(ticker: string) {
  const fetchers = [
    fetchTwelveDataQuote,
    fetchFinnhubQuote,
    fetchAlpacaQuote,
    fetchYahooQuote,
    fetchStooqQuote,
  ];

  for (const fetcher of fetchers) {
    const quote = await fetcher(ticker);
    if (quote) {
      return quote;
    }
  }

  return null;
}

export async function fetchTickerPrice(ticker: string) {
  return (await fetchTickerQuote(ticker))?.price ?? null;
}
