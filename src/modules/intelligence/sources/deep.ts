import type {
  IntelHorizon,
  IntelRawItemInput,
  DeepResearchPreset,
  SourceCollectionResult,
  SourceDiagnostic,
  UniverseEntry,
} from "../types.ts";

const ALPACA_DATA_BASE_URL = "https://data.alpaca.markets";
const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const NASDAQ_BASE_URL = "https://api.nasdaq.com";
const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com";
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss/search";
const YAHOO_FINANCE_RSS_URL =
  "https://feeds.finance.yahoo.com/rss/2.0/headline";
const REDDIT_SEARCH_URL = "https://www.reddit.com/search.json";
const STOCKTWITS_SYMBOL_URL = "https://api.stocktwits.com/api/2/streams/symbol";

type JsonRecord = Record<string, unknown>;

type AlpacaNewsItem = {
  id?: number;
  headline?: string;
  summary?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  source?: string;
  symbols?: string[];
};

type AlpacaNewsResponse = {
  news?: AlpacaNewsItem[];
  next_page_token?: string;
};

type FinnhubNewsItem = {
  id?: number;
  datetime?: number;
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
  related?: string;
};

type FinnhubEarningsCalendarItem = {
  date?: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  hour?: string;
  quarter?: number;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
  symbol?: string;
  year?: number;
};

type FinnhubEarningsCalendarResponse = {
  earningsCalendar?: FinnhubEarningsCalendarItem[];
};

type FinnhubPriceTargetResponse = {
  symbol?: string;
  targetHigh?: number | null;
  targetLow?: number | null;
  targetMean?: number | null;
  targetMedian?: number | null;
  lastUpdated?: string;
};

type FinnhubUpgradeDowngradeItem = {
  symbol?: string;
  company?: string;
  firm?: string;
  fromGrade?: string;
  toGrade?: string;
  action?: string;
  gradeTime?: string;
  period?: string;
};

type YahooChartMeta = {
  currency?: string;
  symbol?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  regularMarketTime?: number;
  regularMarketPrice?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  longName?: string;
  shortName?: string;
};

type YahooChartQuote = {
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
      timestamp?: number[];
      indicators?: {
        quote?: YahooChartQuote[];
      };
    }>;
    error?: unknown;
  };
};

type NasdaqShortInterestRow = {
  settlementDate?: string;
  interest?: string | number | null;
  avgDailyShareVolume?: string | number | null;
  daysToCover?: string | number | null;
};

type NasdaqShortInterestResponse = {
  data?: {
    symbol?: string;
    shortInterestTable?: {
      rows?: NasdaqShortInterestRow[];
    };
  };
};

type NasdaqOptionRow = {
  expirygroup?: string | null;
  expiryDate?: string | null;
  c_Volume?: string | number | null;
  c_Openinterest?: string | number | null;
  c_Bid?: string | number | null;
  c_Ask?: string | number | null;
  strike?: string | number | null;
  p_Volume?: string | number | null;
  p_Openinterest?: string | number | null;
  p_Bid?: string | number | null;
  p_Ask?: string | number | null;
};

type NasdaqOptionsResponse = {
  data?: {
    totalRecord?: number;
    lastTrade?: string;
    table?: {
      rows?: NasdaqOptionRow[];
    };
  };
};

type NasdaqTargetPriceResponse = {
  data?: {
    symbol?: string;
    consensusOverview?: {
      lowPriceTarget?: number | string | null;
      highPriceTarget?: number | string | null;
      priceTarget?: number | string | null;
      buy?: number | string | null;
      hold?: number | string | null;
      sell?: number | string | null;
    };
    historicalConsensus?: Array<{
      z?: {
        buy?: number | string | null;
        hold?: number | string | null;
        sell?: number | string | null;
        date?: string;
        consensus?: string;
      };
      y?: number | string | null;
    }>;
  };
};

type NasdaqEarningsSurpriseRow = {
  fiscalQtrEnd?: string;
  dateReported?: string;
  eps?: number | string | null;
  consensusForecast?: number | string | null;
  percentageSurprise?: number | string | null;
};

type NasdaqEarningsSurpriseResponse = {
  data?: {
    symbol?: string;
    earningsSurpriseTable?: {
      rows?: NasdaqEarningsSurpriseRow[];
    };
  };
};

type NasdaqOwnershipSummaryResponse = {
  data?: {
    institutionalOwnership?: {
      holdings?: string | number | null;
      holders?: string | number | null;
      sharesHeld?: string | number | null;
      holdingsValue?: string | number | null;
      netActivity?: string | number | null;
    };
    top5Holders?: Array<{
      name?: string;
      shares?: string | number | null;
    }>;
  };
};

type NasdaqInsiderTradeSummaryRow = {
  insiderTrade?: string;
  months3?: string | number | null;
  months12?: string | number | null;
};

type NasdaqInsiderTransactionRow = {
  insider?: string;
  relation?: string;
  lastDate?: string;
  transactionType?: string;
  ownType?: string;
  sharesTraded?: string | number | null;
  lastPrice?: string | number | null;
  sharesHeld?: string | number | null;
};

type NasdaqInsiderTradesResponse = {
  data?: {
    numberOfTrades?: {
      rows?: NasdaqInsiderTradeSummaryRow[];
    };
    numberOfSharesTraded?: {
      rows?: NasdaqInsiderTradeSummaryRow[];
    };
    transactionTable?: {
      totalRecords?: string | number | null;
      table?: {
        rows?: NasdaqInsiderTransactionRow[];
      };
    };
  };
};

type RedditChild = {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    subreddit?: string;
    permalink?: string;
    url?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
  };
};

type StockTwitsMessage = {
  id?: number;
  body?: string;
  created_at?: string;
  user?: {
    username?: string;
  };
};

function env(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envBoolean(name: string, fallback = false) {
  const value = Deno.env.get(name)?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

function presetLimit(
  preset: DeepResearchPreset,
  values: { fast: number; deep: number; exhaustive: number },
) {
  return values[preset];
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase().split(":", 1)[0];
}

function nowIso() {
  return new Date().toISOString();
}

function horizonDays(horizon: IntelHorizon) {
  return horizon === "14d" ? 14 : horizon === "3d" ? 3 : 1;
}

function isoDateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function yyyyMmDd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(horizon: IntelHorizon) {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - horizonDays(horizon));
  return { from, to };
}

function yahooChartRange(horizon: IntelHorizon) {
  return horizon === "14d" ? "6mo" : horizon === "3d" ? "3mo" : "1mo";
}

function earningsCalendarDateRange(horizon: IntelHorizon) {
  const from = new Date();
  const to = new Date();
  from.setUTCDate(from.getUTCDate() - horizonDays(horizon));
  to.setUTCDate(
    to.getUTCDate() + (horizon === "1d" ? 7 : horizon === "3d" ? 10 : 21),
  );
  return { from, to };
}

function parseDate(value: string | number | undefined) {
  if (typeof value === "number") {
    return new Date(value * 1000);
  }
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNasdaqNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  const isNegative = /^\(.+\)$/.test(trimmed);
  const normalized = trimmed.replace(/[()$,%\s,]/g, "");
  if (!normalized || normalized === "--") {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (isNegative ? -parsed : parsed) : undefined;
}

function parseNasdaqDate(value: string | undefined) {
  const match = value?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return parseDate(value);
  }
  const [, month, day, year] = match;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0),
  );
}

function formatOptionalNumber(label: string, value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${label}: ${value}`
    : "";
}

function formatPercent(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const numeric = value as number;
  const prefix = numeric >= 0 ? "+" : "";
  return `${prefix}${numeric.toFixed(2)}%`;
}

function formatMoney(value: number | null | undefined, currency = "USD") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${currency} ${value.toFixed(2)}`
    : "";
}

function percentChange(
  current: number | undefined,
  previous: number | undefined,
) {
  if (
    typeof current !== "number" ||
    typeof previous !== "number" ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return undefined;
  }
  return ((current - previous) / previous) * 100;
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function normalizeText(value: string) {
  return decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
}

function makeDiagnostic(args: {
  source: string;
  label: string;
  startedAt: Date;
  status: SourceDiagnostic["status"];
  itemCount: number;
  message?: string;
  metadata?: Record<string, unknown>;
}): SourceDiagnostic {
  return {
    source: args.source,
    label: args.label,
    status: args.status,
    itemCount: args.itemCount,
    startedAt: args.startedAt,
    completedAt: new Date(),
    message: args.message,
    metadata: args.metadata,
  };
}

async function fetchJson<T>(
  url: URL,
  headers?: Record<string, string>,
): Promise<{ data: T | null; status: number; text: string }> {
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    if (!response.ok) {
      return { data: null, status: response.status, text };
    }
    return { data: JSON.parse(text) as T, status: response.status, text };
  } catch (error) {
    return {
      data: null,
      status: 0,
      text: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchText(
  url: URL,
  headers?: Record<string, string>,
): Promise<{ text: string | null; status: number }> {
  try {
    const response = await fetch(url, { headers });
    const text = await response.text();
    return { text: response.ok ? text : null, status: response.status };
  } catch {
    return { text: null, status: 0 };
  }
}

function companyTerms(entry: UniverseEntry) {
  return [
    entry.name !== entry.ticker ? `"${entry.name}"` : "",
    ...entry.aliases
      .filter((alias) => alias.length >= 4 && alias !== entry.name)
      .slice(0, 3)
      .map((alias) => `"${alias}"`),
    `$${normalizeTicker(entry.ticker)}`,
    `${normalizeTicker(entry.ticker)} stock`,
  ].filter(Boolean);
}

export type RssItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
};

export function companyReleaseSearchQuery(
  entry: UniverseEntry,
  horizon: IntelHorizon,
) {
  const terms = companyTerms(entry);
  const releaseTerms = [
    '"press release"',
    '"investor relations"',
    '"company news"',
    '"announces"',
    '"launches"',
    '"guidance"',
    '"earnings release"',
  ];
  return `(${terms.join(" OR ")}) (${releaseTerms.join(" OR ")}) when:${horizonDays(horizon)}d`;
}

function parseRssItems(xml: string): RssItem[] {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => {
    const readTag = (tag: string) =>
      normalizeText(
        item.match(
          new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
        )?.[1] ?? "",
      );
    return {
      title: readTag("title"),
      link: readTag("link"),
      description: readTag("description"),
      pubDate: readTag("pubDate"),
      source: readTag("source"),
    };
  });
}

async function collectAlpacaNews(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const apiKey = env("ALPACA_API_KEY");
  const apiSecret = env("ALPACA_API_SECRET");
  const ticker = normalizeTicker(entry.ticker);
  if (!apiKey || !apiSecret) {
    return {
      items: [],
      diagnostics: [
        makeDiagnostic({
          source: "alpaca_news",
          label: `ticker-news:${ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: "ALPACA_API_KEY or ALPACA_API_SECRET is not configured",
        }),
      ],
    };
  }

  const limit = envNumber(
    "INTEL_ALPACA_NEWS_LIMIT",
    presetLimit(preset, { fast: 30, deep: 100, exhaustive: 200 }),
  );
  const pageLimit = envNumber(
    "INTEL_ALPACA_NEWS_PAGES",
    presetLimit(preset, { fast: 1, deep: 2, exhaustive: 4 }),
  );
  const items: IntelRawItemInput[] = [];
  let nextPageToken: string | undefined;
  let status = 200;
  let text = "";
  for (let page = 0; page < pageLimit && items.length < limit; page += 1) {
    const url = new URL("/v1beta1/news", ALPACA_DATA_BASE_URL);
    url.searchParams.set("symbols", ticker);
    url.searchParams.set("limit", String(Math.min(50, limit - items.length)));
    url.searchParams.set("sort", "desc");
    url.searchParams.set("start", isoDateDaysAgo(horizonDays(horizon)));
    if (nextPageToken) {
      url.searchParams.set("page_token", nextPageToken);
    }

    const result = await fetchJson<AlpacaNewsResponse>(url, {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": apiSecret,
    });
    status = result.status;
    text = result.text;
    if (!result.data) {
      break;
    }

    const fetchedAt = new Date();
    for (const news of result.data.news ?? []) {
      if (!news.headline) {
        continue;
      }
      items.push({
        source: "alpaca_news",
        sourceType: "news",
        sourceId: `alpaca:${news.id ?? news.url ?? news.headline}`,
        title: news.headline,
        url: news.url,
        publishedAt: parseDate(news.created_at ?? news.updated_at),
        fetchedAt,
        body: [news.summary, news.source ? `Source: ${news.source}` : ""]
          .filter(Boolean)
          .join("\n"),
        rawPayload: news,
        tickers: [ticker],
      });
    }
    nextPageToken = result.data.next_page_token;
    if (!nextPageToken) {
      break;
    }
  }

  return {
    items,
    diagnostics: [
      makeDiagnostic({
        source: "alpaca_news",
        label: `ticker-news:${ticker}`,
        startedAt,
        status: items.length > 0 ? "ok" : status === 200 ? "ok" : "failed",
        itemCount: items.length,
        message:
          status !== 200 && items.length === 0
            ? `HTTP ${status}: ${text.slice(0, 160)}`
            : undefined,
        metadata: { ticker, limit, pageLimit },
      }),
    ],
  };
}

async function collectFinnhub(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  _preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const apiKey = env("FINNHUB_API_KEY");
  const ticker = normalizeTicker(entry.ticker);
  if (!apiKey) {
    return {
      items: [],
      diagnostics: [
        makeDiagnostic({
          source: "finnhub",
          label: `ticker-news:${ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: "FINNHUB_API_KEY is not configured",
        }),
      ],
    };
  }

  const range = dateRange(horizon);
  const newsUrl = new URL("/api/v1/company-news", FINNHUB_BASE_URL);
  newsUrl.searchParams.set("symbol", ticker);
  newsUrl.searchParams.set("from", yyyyMmDd(range.from));
  newsUrl.searchParams.set("to", yyyyMmDd(range.to));
  newsUrl.searchParams.set("token", apiKey);
  const news = await fetchJson<FinnhubNewsItem[]>(newsUrl);
  const fetchedAt = new Date();
  const newsItems = (news.data ?? [])
    .filter((item) => item.headline)
    .map(
      (item): IntelRawItemInput => ({
        source: "finnhub_news",
        sourceType: "news",
        sourceId: `finnhub:${item.id ?? item.url ?? item.headline}`,
        title: item.headline ?? "Finnhub news",
        url: item.url,
        publishedAt: parseDate(item.datetime),
        fetchedAt,
        body: [
          item.summary,
          item.source ? `Source: ${item.source}` : "",
          item.related ? `Related: ${item.related}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        rawPayload: item,
        tickers: [ticker],
      }),
    );

  const metricsUrl = new URL("/api/v1/stock/metric", FINNHUB_BASE_URL);
  metricsUrl.searchParams.set("symbol", ticker);
  metricsUrl.searchParams.set("metric", "all");
  metricsUrl.searchParams.set("token", apiKey);
  const metrics = await fetchJson<JsonRecord>(metricsUrl);

  const recommendationUrl = new URL(
    "/api/v1/stock/recommendation",
    FINNHUB_BASE_URL,
  );
  recommendationUrl.searchParams.set("symbol", ticker);
  recommendationUrl.searchParams.set("token", apiKey);
  const recommendations = await fetchJson<JsonRecord[]>(recommendationUrl);

  const socialUrl = new URL("/api/v1/stock/social-sentiment", FINNHUB_BASE_URL);
  socialUrl.searchParams.set("symbol", ticker);
  socialUrl.searchParams.set("from", yyyyMmDd(range.from));
  socialUrl.searchParams.set("token", apiKey);
  const social = await fetchJson<JsonRecord>(socialUrl);

  const researchItems: IntelRawItemInput[] = [];
  if (metrics.data) {
    researchItems.push({
      source: "finnhub_metrics",
      sourceType: "research",
      sourceId: `finnhub:metrics:${ticker}:${nowIso().slice(0, 13)}`,
      title: `${ticker} Finnhub metric snapshot`,
      publishedAt: fetchedAt,
      fetchedAt,
      body: JSON.stringify(metrics.data).slice(0, 3000),
      rawPayload: metrics.data,
      tickers: [ticker],
    });
  }
  if (recommendations.data && recommendations.data.length > 0) {
    researchItems.push({
      source: "finnhub_recommendations",
      sourceType: "research",
      sourceId: `finnhub:recommendations:${ticker}:${nowIso().slice(0, 13)}`,
      title: `${ticker} analyst recommendation trend`,
      publishedAt: fetchedAt,
      fetchedAt,
      body: JSON.stringify(recommendations.data).slice(0, 3000),
      rawPayload: recommendations.data,
      tickers: [ticker],
    });
  }
  if (social.data) {
    researchItems.push({
      source: "finnhub_social",
      sourceType: "social",
      sourceId: `finnhub:social:${ticker}:${nowIso().slice(0, 13)}`,
      title: `${ticker} social sentiment snapshot`,
      publishedAt: fetchedAt,
      fetchedAt,
      body: JSON.stringify(social.data).slice(0, 3000),
      rawPayload: social.data,
      tickers: [ticker],
    });
  }

  return {
    items: [...newsItems, ...researchItems],
    diagnostics: [
      makeDiagnostic({
        source: "finnhub",
        label: `ticker-news:${ticker}`,
        startedAt,
        status: news.status === 200 || metrics.status === 200 ? "ok" : "failed",
        itemCount: newsItems.length + researchItems.length,
        message:
          news.status !== 200 && metrics.status !== 200
            ? `news HTTP ${news.status}, metrics HTTP ${metrics.status}`
            : undefined,
        metadata: {
          ticker,
          news: newsItems.length,
          metrics: metrics.data ? 1 : 0,
          recommendations: recommendations.data?.length ?? 0,
          social: social.data ? 1 : 0,
        },
      }),
    ],
  };
}

export function buildFinnhubPriceTargetItems(args: {
  response: FinnhubPriceTargetResponse;
  ticker: string;
  fetchedAt: Date;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const responseTicker = normalizeTicker(args.response.symbol ?? ticker);
  if (responseTicker !== ticker) {
    return [];
  }
  const targetFields = [
    args.response.targetHigh,
    args.response.targetLow,
    args.response.targetMean,
    args.response.targetMedian,
  ];
  if (!targetFields.some((value) => typeof value === "number")) {
    return [];
  }
  const updatedAt = parseDate(args.response.lastUpdated);
  return [
    {
      source: "finnhub_price_target",
      sourceType: "research",
      sourceId: `finnhub:price-target:${ticker}:${args.response.lastUpdated ?? nowIso().slice(0, 10)}`,
      title: `${ticker} analyst price target snapshot`,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/analysis`,
      publishedAt: updatedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        formatOptionalNumber("Target high", args.response.targetHigh),
        formatOptionalNumber("Target mean", args.response.targetMean),
        formatOptionalNumber("Target median", args.response.targetMedian),
        formatOptionalNumber("Target low", args.response.targetLow),
        args.response.lastUpdated
          ? `Last updated: ${args.response.lastUpdated}`
          : "",
        "Analyst target snapshots are useful for estimate direction and consensus context, but they need corroboration from revisions, earnings, and price action.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: args.response,
      tickers: [ticker],
    },
  ];
}

export function buildFinnhubUpgradeDowngradeItems(args: {
  response: FinnhubUpgradeDowngradeItem[];
  ticker: string;
  fetchedAt: Date;
  limit: number;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  return args.response
    .filter((item) => normalizeTicker(item.symbol ?? ticker) === ticker)
    .slice(0, args.limit)
    .map((item, index): IntelRawItemInput => {
      const firm = item.firm || "Analyst firm";
      const action = item.action || "rating action";
      const fromGrade = item.fromGrade || "n/a";
      const toGrade = item.toGrade || "n/a";
      const publishedAt = parseDate(item.gradeTime ?? item.period);
      return {
        source: "finnhub_upgrade_downgrade",
        sourceType: "research",
        sourceId: `finnhub:upgrade-downgrade:${ticker}:${item.gradeTime ?? item.period ?? index}:${firm}:${fromGrade}:${toGrade}`,
        title: `${ticker} ${firm} ${action}: ${fromGrade} -> ${toGrade}`,
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/analysis`,
        publishedAt,
        discoveredAt: args.fetchedAt,
        fetchedAt: args.fetchedAt,
        body: [
          item.company ? `Company: ${item.company}` : "",
          `Firm: ${firm}`,
          `Action: ${action}`,
          `Rating: ${fromGrade} -> ${toGrade}`,
          item.gradeTime ? `Grade time: ${item.gradeTime}` : "",
          item.period ? `Period: ${item.period}` : "",
          "Fresh upgrades, downgrades, initiations, and reiterations can explain near-term positioning when they align with catalysts and market reaction.",
        ]
          .filter(Boolean)
          .join("\n"),
        rawPayload: item,
        tickers: [ticker],
      };
    });
}

async function collectFinnhubAnalystSignals(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const apiKey = env("FINNHUB_API_KEY");
  const ticker = normalizeTicker(entry.ticker);
  if (!apiKey) {
    return {
      items: [],
      diagnostics: [
        makeDiagnostic({
          source: "finnhub_price_target",
          label: `ticker-analyst-price-target:${ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: "FINNHUB_API_KEY is not configured",
        }),
        makeDiagnostic({
          source: "finnhub_upgrade_downgrade",
          label: `ticker-analyst-revisions:${ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: "FINNHUB_API_KEY is not configured",
        }),
      ],
    };
  }

  const range = dateRange(horizon);
  const revisionLimit = envNumber(
    "INTEL_FINNHUB_UPGRADE_DOWNGRADE_LIMIT",
    presetLimit(preset, { fast: 12, deep: 40, exhaustive: 80 }),
  );

  const priceTargetUrl = new URL(
    "/api/v1/stock/price-target",
    FINNHUB_BASE_URL,
  );
  priceTargetUrl.searchParams.set("symbol", ticker);
  priceTargetUrl.searchParams.set("token", apiKey);

  const revisionsUrl = new URL(
    "/api/v1/stock/upgrade-downgrade",
    FINNHUB_BASE_URL,
  );
  revisionsUrl.searchParams.set("symbol", ticker);
  revisionsUrl.searchParams.set("from", yyyyMmDd(range.from));
  revisionsUrl.searchParams.set("to", yyyyMmDd(range.to));
  revisionsUrl.searchParams.set("token", apiKey);

  const [priceTarget, revisions] = await Promise.all([
    fetchJson<FinnhubPriceTargetResponse>(priceTargetUrl),
    fetchJson<FinnhubUpgradeDowngradeItem[]>(revisionsUrl),
  ]);
  const fetchedAt = new Date();
  const priceTargetItems = priceTarget.data
    ? buildFinnhubPriceTargetItems({
        response: priceTarget.data,
        ticker,
        fetchedAt,
      })
    : [];
  const revisionItems = Array.isArray(revisions.data)
    ? buildFinnhubUpgradeDowngradeItems({
        response: revisions.data,
        ticker,
        fetchedAt,
        limit: revisionLimit,
      })
    : [];

  return {
    items: [...priceTargetItems, ...revisionItems],
    diagnostics: [
      makeDiagnostic({
        source: "finnhub_price_target",
        label: `ticker-analyst-price-target:${ticker}`,
        startedAt,
        status: priceTarget.status === 200 ? "ok" : "failed",
        itemCount: priceTargetItems.length,
        message:
          priceTarget.status === 200
            ? undefined
            : `HTTP ${priceTarget.status}: ${priceTarget.text.slice(0, 160)}`,
        metadata: { ticker },
      }),
      makeDiagnostic({
        source: "finnhub_upgrade_downgrade",
        label: `ticker-analyst-revisions:${ticker}`,
        startedAt,
        status: revisions.status === 200 ? "ok" : "failed",
        itemCount: revisionItems.length,
        message:
          revisions.status === 200
            ? undefined
            : `HTTP ${revisions.status}: ${revisions.text.slice(0, 160)}`,
        metadata: { ticker, limit: revisionLimit },
      }),
    ],
  };
}

export function buildYahooChartContextItems(args: {
  response: YahooChartResponse;
  ticker: string;
  fetchedAt: Date;
  horizon: IntelHorizon;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const result = args.response.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close ?? []).filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (!meta || closes.length === 0) {
    return [];
  }

  const currency = meta.currency ?? "USD";
  const latestClose =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : closes.at(-1);
  const previousClose = closes.length > 1 ? closes.at(-2) : undefined;
  const fiveDayBase = closes.length > 5 ? closes.at(-6) : closes[0];
  const periodBase = closes[0];
  const oneDayReturn = percentChange(latestClose, previousClose);
  const fiveDayReturn = percentChange(latestClose, fiveDayBase);
  const periodReturn = percentChange(latestClose, periodBase);
  const volumes = (quote?.volume ?? []).filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  const recentVolumes = volumes.slice(-20);
  const averageVolume =
    recentVolumes.length > 0
      ? recentVolumes.reduce((sum, value) => sum + value, 0) /
        recentVolumes.length
      : undefined;
  const latestVolume =
    typeof meta.regularMarketVolume === "number"
      ? meta.regularMarketVolume
      : volumes.at(-1);
  const volumeRatio =
    latestVolume && averageVolume ? latestVolume / averageVolume : undefined;
  const rangeSpread =
    typeof meta.fiftyTwoWeekHigh === "number" &&
    typeof meta.fiftyTwoWeekLow === "number"
      ? meta.fiftyTwoWeekHigh - meta.fiftyTwoWeekLow
      : undefined;
  const rangePosition =
    rangeSpread && rangeSpread > 0 && typeof latestClose === "number"
      ? ((latestClose - (meta.fiftyTwoWeekLow as number)) / rangeSpread) * 100
      : undefined;
  const publishedAt = parseDate(meta.regularMarketTime);
  const symbol = normalizeTicker(meta.symbol ?? ticker);
  if (symbol !== ticker) {
    return [];
  }

  return [
    {
      source: "yahoo_chart",
      sourceType: "market",
      sourceId: `yahoo:chart:${ticker}:${args.horizon}:${publishedAt.toISOString().slice(0, 10)}`,
      title: `${ticker} Yahoo chart technical context`,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`,
      publishedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        meta.longName || meta.shortName
          ? `Company: ${meta.longName ?? meta.shortName}`
          : "",
        meta.fullExchangeName || meta.exchangeName
          ? `Exchange: ${meta.fullExchangeName ?? meta.exchangeName}`
          : "",
        latestClose
          ? `Latest price: ${formatMoney(latestClose, currency)}`
          : "",
        formatPercent(oneDayReturn)
          ? `1d return: ${formatPercent(oneDayReturn)}`
          : "",
        formatPercent(fiveDayReturn)
          ? `5d return: ${formatPercent(fiveDayReturn)}`
          : "",
        formatPercent(periodReturn)
          ? `${yahooChartRange(args.horizon)} return: ${formatPercent(periodReturn)}`
          : "",
        meta.regularMarketDayLow || meta.regularMarketDayHigh
          ? `Day range: ${formatMoney(meta.regularMarketDayLow, currency)} - ${formatMoney(meta.regularMarketDayHigh, currency)}`
          : "",
        meta.fiftyTwoWeekLow || meta.fiftyTwoWeekHigh
          ? `52w range: ${formatMoney(meta.fiftyTwoWeekLow, currency)} - ${formatMoney(meta.fiftyTwoWeekHigh, currency)}`
          : "",
        typeof rangePosition === "number"
          ? `52w range position: ${rangePosition.toFixed(1)}%`
          : "",
        latestVolume ? `Latest volume: ${Math.round(latestVolume)}` : "",
        averageVolume
          ? `20-session average volume: ${Math.round(averageVolume)}`
          : "",
        volumeRatio ? `Relative volume: ${volumeRatio.toFixed(2)}x` : "",
        volumeRatio && volumeRatio >= 1.5
          ? "Unusual volume is present and should be checked against catalysts."
          : "",
        "Technical context is not a catalyst by itself; use it to judge whether news is already being priced in.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        meta,
        closeCount: closes.length,
        latestClose,
        oneDayReturn,
        fiveDayReturn,
        periodReturn,
        averageVolume,
        latestVolume,
        volumeRatio,
        rangePosition,
      },
      tickers: [ticker],
    },
  ];
}

async function collectYahooChartContext(
  entry: UniverseEntry,
  horizon: IntelHorizon,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const url = new URL(
    `/v8/finance/chart/${encodeURIComponent(ticker)}`,
    YAHOO_CHART_BASE_URL,
  );
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", yahooChartRange(horizon));
  const result = await fetchJson<YahooChartResponse>(url, {
    "User-Agent": "Mozilla/5.0",
  });
  const fetchedAt = new Date();
  const items = result.data
    ? buildYahooChartContextItems({
        response: result.data,
        ticker,
        fetchedAt,
        horizon,
      })
    : [];

  return {
    items,
    diagnostics: [
      makeDiagnostic({
        source: "yahoo_chart",
        label: `ticker-chart:${ticker}`,
        startedAt,
        status: result.status === 200 ? "ok" : "failed",
        itemCount: items.length,
        message:
          result.status === 200
            ? undefined
            : `HTTP ${result.status}: ${result.text.slice(0, 160)}`,
        metadata: {
          ticker,
          range: yahooChartRange(horizon),
        },
      }),
    ],
  };
}

function formatCompactNumber(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const numeric = value as number;
  if (Math.abs(numeric) >= 1_000_000_000) {
    return `${(numeric / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(numeric) >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(numeric) >= 1_000) {
    return `${(numeric / 1_000).toFixed(1)}K`;
  }
  return numeric.toFixed(0);
}

function ratio(value: number | undefined) {
  return Number.isFinite(value) ? (value as number).toFixed(2) : "";
}

export function buildNasdaqShortInterestItems(args: {
  response: NasdaqShortInterestResponse;
  ticker: string;
  fetchedAt: Date;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const responseTicker = normalizeTicker(args.response.data?.symbol ?? ticker);
  if (responseTicker !== ticker) {
    return [];
  }
  const rows = args.response.data?.shortInterestTable?.rows ?? [];
  const latest = rows[0];
  if (!latest?.settlementDate) {
    return [];
  }
  const previous = rows[1];
  const latestInterest = parseNasdaqNumber(latest.interest);
  const previousInterest = parseNasdaqNumber(previous?.interest);
  const interestChange = percentChange(latestInterest, previousInterest);
  const avgDailyVolume = parseNasdaqNumber(latest.avgDailyShareVolume);
  const daysToCover = parseNasdaqNumber(latest.daysToCover);
  const publishedAt = parseNasdaqDate(latest.settlementDate);

  return [
    {
      source: "nasdaq_short_interest",
      sourceType: "research",
      sourceId: `nasdaq:short-interest:${ticker}:${latest.settlementDate}`,
      title: `${ticker} short interest snapshot`,
      url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/short-interest`,
      publishedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        `Settlement date: ${latest.settlementDate}`,
        latestInterest
          ? `Short interest: ${formatCompactNumber(latestInterest)} shares`
          : "",
        avgDailyVolume
          ? `Average daily share volume: ${formatCompactNumber(avgDailyVolume)}`
          : "",
        daysToCover ? `Days to cover: ${ratio(daysToCover)}` : "",
        formatPercent(interestChange)
          ? `Change vs previous settlement: ${formatPercent(interestChange)}`
          : "",
        previous?.settlementDate && previousInterest
          ? `Previous settlement ${previous.settlementDate}: ${formatCompactNumber(previousInterest)} shares`
          : "",
        "Short interest is a positioning/risk signal, not a standalone catalyst; rising short interest can increase squeeze potential or show bearish conviction.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        latest,
        previous,
        latestInterest,
        previousInterest,
        interestChange,
        avgDailyVolume,
        daysToCover,
      },
      tickers: [ticker],
    },
  ];
}

function topOptionRows(
  rows: NasdaqOptionRow[],
  side: "call" | "put",
  metric: "volume" | "openInterest",
  limit = 3,
) {
  const prefix = side === "call" ? "c" : "p";
  const key = `${prefix}_${metric === "volume" ? "Volume" : "Openinterest"}` as
    | "c_Volume"
    | "c_Openinterest"
    | "p_Volume"
    | "p_Openinterest";
  return rows
    .map((row) => ({
      row,
      value: parseNasdaqNumber(row[key]),
    }))
    .filter((entry): entry is { row: NasdaqOptionRow; value: number } =>
      Number.isFinite(entry.value),
    )
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

function optionLabel(row: NasdaqOptionRow) {
  const expiry = row.expiryDate || row.expirygroup || "unknown expiry";
  const strike = parseNasdaqNumber(row.strike);
  return `${expiry} ${strike ? strike.toFixed(2) : "unknown strike"}`;
}

export function buildNasdaqOptionsItems(args: {
  response: NasdaqOptionsResponse;
  ticker: string;
  fetchedAt: Date;
  limit: number;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const rows = (args.response.data?.table?.rows ?? [])
    .filter((row) => parseNasdaqNumber(row.strike) !== undefined)
    .slice(0, args.limit);
  if (rows.length === 0) {
    return [];
  }

  const callVolume = rows.reduce(
    (sum, row) => sum + (parseNasdaqNumber(row.c_Volume) ?? 0),
    0,
  );
  const putVolume = rows.reduce(
    (sum, row) => sum + (parseNasdaqNumber(row.p_Volume) ?? 0),
    0,
  );
  const callOpenInterest = rows.reduce(
    (sum, row) => sum + (parseNasdaqNumber(row.c_Openinterest) ?? 0),
    0,
  );
  const putOpenInterest = rows.reduce(
    (sum, row) => sum + (parseNasdaqNumber(row.p_Openinterest) ?? 0),
    0,
  );
  const putCallVolumeRatio =
    callVolume > 0 ? putVolume / callVolume : undefined;
  const putCallOpenInterestRatio =
    callOpenInterest > 0 ? putOpenInterest / callOpenInterest : undefined;
  const topCallVolume = topOptionRows(rows, "call", "volume");
  const topPutVolume = topOptionRows(rows, "put", "volume");
  const topCallOpenInterest = topOptionRows(rows, "call", "openInterest");
  const topPutOpenInterest = topOptionRows(rows, "put", "openInterest");

  return [
    {
      source: "nasdaq_options",
      sourceType: "market",
      sourceId: `nasdaq:options:${ticker}:${nowIso().slice(0, 13)}:${rows.length}`,
      title: `${ticker} options positioning snapshot`,
      url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/option-chain`,
      publishedAt: args.fetchedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        args.response.data?.lastTrade ?? "",
        `Rows analyzed: ${rows.length}${args.response.data?.totalRecord ? ` / ${args.response.data.totalRecord} total` : ""}`,
        `Call volume: ${formatCompactNumber(callVolume)}`,
        `Put volume: ${formatCompactNumber(putVolume)}`,
        ratio(putCallVolumeRatio)
          ? `Put/call volume ratio: ${ratio(putCallVolumeRatio)}`
          : "",
        `Call open interest: ${formatCompactNumber(callOpenInterest)}`,
        `Put open interest: ${formatCompactNumber(putOpenInterest)}`,
        ratio(putCallOpenInterestRatio)
          ? `Put/call open-interest ratio: ${ratio(putCallOpenInterestRatio)}`
          : "",
        topCallVolume.length > 0
          ? `Top call volume: ${topCallVolume
              .map(
                (entry) =>
                  `${optionLabel(entry.row)} (${formatCompactNumber(entry.value)})`,
              )
              .join("; ")}`
          : "",
        topPutVolume.length > 0
          ? `Top put volume: ${topPutVolume
              .map(
                (entry) =>
                  `${optionLabel(entry.row)} (${formatCompactNumber(entry.value)})`,
              )
              .join("; ")}`
          : "",
        topCallOpenInterest.length > 0
          ? `Top call open interest: ${topCallOpenInterest
              .map(
                (entry) =>
                  `${optionLabel(entry.row)} (${formatCompactNumber(entry.value)})`,
              )
              .join("; ")}`
          : "",
        topPutOpenInterest.length > 0
          ? `Top put open interest: ${topPutOpenInterest
              .map(
                (entry) =>
                  `${optionLabel(entry.row)} (${formatCompactNumber(entry.value)})`,
              )
              .join("; ")}`
          : "",
        "Options activity is a positioning signal; use it to find crowded strikes, hedging pressure, or speculative attention around catalysts.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        totalRecord: args.response.data?.totalRecord,
        lastTrade: args.response.data?.lastTrade,
        analyzedRows: rows.length,
        callVolume,
        putVolume,
        callOpenInterest,
        putOpenInterest,
        putCallVolumeRatio,
        putCallOpenInterestRatio,
        topCallVolume,
        topPutVolume,
        topCallOpenInterest,
        topPutOpenInterest,
      },
      tickers: [ticker],
    },
  ];
}

function nasdaqHeaders() {
  return {
    Accept: "application/json",
    Referer: "https://www.nasdaq.com/",
    "User-Agent": "Mozilla/5.0",
  };
}

async function collectNasdaqPositioning(
  entry: UniverseEntry,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const optionsLimit = envNumber(
    "INTEL_NASDAQ_OPTIONS_LIMIT",
    presetLimit(preset, { fast: 250, deep: 600, exhaustive: 1200 }),
  );
  const shortInterestUrl = new URL(
    `/api/quote/${encodeURIComponent(ticker)}/short-interest`,
    NASDAQ_BASE_URL,
  );
  shortInterestUrl.searchParams.set("assetclass", "stocks");
  const optionsUrl = new URL(
    `/api/quote/${encodeURIComponent(ticker)}/option-chain`,
    NASDAQ_BASE_URL,
  );
  optionsUrl.searchParams.set("assetclass", "stocks");
  optionsUrl.searchParams.set("limit", String(optionsLimit));

  const [shortInterest, options] = await Promise.all([
    fetchJson<NasdaqShortInterestResponse>(shortInterestUrl, nasdaqHeaders()),
    fetchJson<NasdaqOptionsResponse>(optionsUrl, nasdaqHeaders()),
  ]);
  const fetchedAt = new Date();
  const shortInterestItems = shortInterest.data
    ? buildNasdaqShortInterestItems({
        response: shortInterest.data,
        ticker,
        fetchedAt,
      })
    : [];
  const optionItems = options.data
    ? buildNasdaqOptionsItems({
        response: options.data,
        ticker,
        fetchedAt,
        limit: optionsLimit,
      })
    : [];

  return {
    items: [...shortInterestItems, ...optionItems],
    diagnostics: [
      makeDiagnostic({
        source: "nasdaq_short_interest",
        label: `ticker-short-interest:${ticker}`,
        startedAt,
        status: shortInterest.status === 200 ? "ok" : "failed",
        itemCount: shortInterestItems.length,
        message:
          shortInterest.status === 200
            ? undefined
            : `HTTP ${shortInterest.status}: ${shortInterest.text.slice(0, 160)}`,
        metadata: { ticker },
      }),
      makeDiagnostic({
        source: "nasdaq_options",
        label: `ticker-options:${ticker}`,
        startedAt,
        status: options.status === 200 ? "ok" : "failed",
        itemCount: optionItems.length,
        message:
          options.status === 200
            ? undefined
            : `HTTP ${options.status}: ${options.text.slice(0, 160)}`,
        metadata: {
          ticker,
          limit: optionsLimit,
          returnedRows: options.data?.data?.table?.rows?.length ?? 0,
        },
      }),
    ],
  };
}

export function buildNasdaqAnalystTargetItems(args: {
  response: NasdaqTargetPriceResponse;
  ticker: string;
  fetchedAt: Date;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const responseTicker = normalizeTicker(args.response.data?.symbol ?? ticker);
  const overview = args.response.data?.consensusOverview;
  if (responseTicker !== ticker || !overview) {
    return [];
  }
  const target = parseNasdaqNumber(overview.priceTarget);
  const high = parseNasdaqNumber(overview.highPriceTarget);
  const low = parseNasdaqNumber(overview.lowPriceTarget);
  const buy = parseNasdaqNumber(overview.buy) ?? 0;
  const hold = parseNasdaqNumber(overview.hold) ?? 0;
  const sell = parseNasdaqNumber(overview.sell) ?? 0;
  if (!target && !high && !low && buy + hold + sell === 0) {
    return [];
  }
  const history = args.response.data?.historicalConsensus ?? [];
  const latestHistory = history.at(-1);
  const previousHistory = history.length > 1 ? history.at(-2) : undefined;
  const latestConsensus = latestHistory?.z?.consensus;
  const latestDate = latestHistory?.z?.date;
  const latestHistoricalPriceTarget = parseNasdaqNumber(latestHistory?.y);
  const previousHistoricalPriceTarget = parseNasdaqNumber(previousHistory?.y);
  const targetChange = percentChange(
    latestHistoricalPriceTarget,
    previousHistoricalPriceTarget,
  );
  const publishedAt = latestDate ? parseNasdaqDate(latestDate) : args.fetchedAt;

  return [
    {
      source: "nasdaq_analyst_target",
      sourceType: "research",
      sourceId: `nasdaq:analyst-target:${ticker}:${latestDate ?? nowIso().slice(0, 10)}`,
      title: `${ticker} Nasdaq analyst target consensus`,
      url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/analyst-research`,
      publishedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        target ? `Consensus price target: ${target.toFixed(2)}` : "",
        low || high
          ? `Target range: ${low?.toFixed(2) ?? "n/a"} - ${high?.toFixed(2) ?? "n/a"}`
          : "",
        `Ratings mix: ${buy.toFixed(0)} buy / ${hold.toFixed(0)} hold / ${sell.toFixed(0)} sell`,
        latestConsensus
          ? `Latest historical consensus: ${latestConsensus}`
          : "",
        latestDate ? `Latest consensus date: ${latestDate}` : "",
        formatPercent(targetChange)
          ? `Historical target change vs previous point: ${formatPercent(targetChange)}`
          : "",
        "Analyst target consensus can lag fresh research notes, but it helps quantify street bias and upside/downside expectations.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        overview,
        latestHistory,
        previousHistory,
        latestHistoricalPriceTarget,
        previousHistoricalPriceTarget,
        targetChange,
      },
      tickers: [ticker],
    },
  ];
}

export function buildNasdaqEarningsSurpriseItems(args: {
  response: NasdaqEarningsSurpriseResponse;
  ticker: string;
  fetchedAt: Date;
  limit: number;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const responseTicker = normalizeTicker(args.response.data?.symbol ?? ticker);
  if (responseTicker !== ticker) {
    return [];
  }
  const rows = (args.response.data?.earningsSurpriseTable?.rows ?? [])
    .filter((row) => row.dateReported)
    .slice(0, args.limit);
  if (rows.length === 0) {
    return [];
  }
  const latest = rows[0];
  const latestSurprise = parseNasdaqNumber(latest.percentageSurprise);
  const latestEps = parseNasdaqNumber(latest.eps);
  const latestForecast = parseNasdaqNumber(latest.consensusForecast);
  const surpriseValues = rows
    .map((row) => parseNasdaqNumber(row.percentageSurprise))
    .filter((value): value is number => Number.isFinite(value));
  const averageSurprise =
    surpriseValues.length > 0
      ? surpriseValues.reduce((sum, value) => sum + value, 0) /
        surpriseValues.length
      : undefined;
  const positiveCount = surpriseValues.filter((value) => value > 0).length;
  const negativeCount = surpriseValues.filter((value) => value < 0).length;
  const publishedAt = parseNasdaqDate(latest.dateReported);

  return [
    {
      source: "nasdaq_earnings_surprise",
      sourceType: "company",
      sourceId: `nasdaq:earnings-surprise:${ticker}:${latest.dateReported}`,
      title: `${ticker} earnings surprise history`,
      url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/earnings`,
      publishedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        `Latest reported quarter: ${latest.fiscalQtrEnd ?? "unknown"}`,
        latest.dateReported ? `Date reported: ${latest.dateReported}` : "",
        latestEps !== undefined ? `EPS: ${latestEps}` : "",
        latestForecast !== undefined
          ? `Consensus EPS forecast: ${latestForecast}`
          : "",
        formatPercent(latestSurprise)
          ? `Latest EPS surprise: ${formatPercent(latestSurprise)}`
          : "",
        averageSurprise !== undefined
          ? `Average surprise across ${rows.length} rows: ${formatPercent(averageSurprise)}`
          : "",
        `Surprise trend: ${positiveCount} positive / ${negativeCount} negative`,
        "Recent earnings surprise history helps judge execution momentum and whether current guidance/news is fighting or confirming prior results.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        rows,
        latest,
        latestSurprise,
        latestEps,
        latestForecast,
        averageSurprise,
        positiveCount,
        negativeCount,
      },
      tickers: [ticker],
    },
  ];
}

async function collectNasdaqAnalystAndEarnings(
  entry: UniverseEntry,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const earningsLimit = envNumber(
    "INTEL_NASDAQ_EARNINGS_SURPRISE_LIMIT",
    presetLimit(preset, { fast: 4, deep: 8, exhaustive: 12 }),
  );
  const targetUrl = new URL(
    `/api/analyst/${encodeURIComponent(ticker)}/targetprice`,
    NASDAQ_BASE_URL,
  );
  const surpriseUrl = new URL(
    `/api/company/${encodeURIComponent(ticker)}/earnings-surprise`,
    NASDAQ_BASE_URL,
  );

  const [target, surprise] = await Promise.all([
    fetchJson<NasdaqTargetPriceResponse>(targetUrl, nasdaqHeaders()),
    fetchJson<NasdaqEarningsSurpriseResponse>(surpriseUrl, nasdaqHeaders()),
  ]);
  const fetchedAt = new Date();
  const targetItems = target.data
    ? buildNasdaqAnalystTargetItems({
        response: target.data,
        ticker,
        fetchedAt,
      })
    : [];
  const surpriseItems = surprise.data
    ? buildNasdaqEarningsSurpriseItems({
        response: surprise.data,
        ticker,
        fetchedAt,
        limit: earningsLimit,
      })
    : [];

  return {
    items: [...targetItems, ...surpriseItems],
    diagnostics: [
      makeDiagnostic({
        source: "nasdaq_analyst_target",
        label: `ticker-analyst-target:${ticker}`,
        startedAt,
        status: target.status === 200 ? "ok" : "failed",
        itemCount: targetItems.length,
        message:
          target.status === 200
            ? undefined
            : `HTTP ${target.status}: ${target.text.slice(0, 160)}`,
        metadata: { ticker },
      }),
      makeDiagnostic({
        source: "nasdaq_earnings_surprise",
        label: `ticker-earnings-surprise:${ticker}`,
        startedAt,
        status: surprise.status === 200 ? "ok" : "failed",
        itemCount: surpriseItems.length,
        message:
          surprise.status === 200
            ? undefined
            : `HTTP ${surprise.status}: ${surprise.text.slice(0, 160)}`,
        metadata: {
          ticker,
          limit: earningsLimit,
          returnedRows:
            surprise.data?.data?.earningsSurpriseTable?.rows?.length ?? 0,
        },
      }),
    ],
  };
}

export function buildNasdaqInstitutionalOwnershipItems(args: {
  response: NasdaqOwnershipSummaryResponse;
  ticker: string;
  fetchedAt: Date;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const ownership = args.response.data?.institutionalOwnership;
  if (!ownership) {
    return [];
  }
  const holdingsPct = parseNasdaqNumber(ownership.holdings);
  const holders = parseNasdaqNumber(ownership.holders);
  const sharesHeld = parseNasdaqNumber(ownership.sharesHeld);
  const holdingsValue = parseNasdaqNumber(ownership.holdingsValue);
  const netActivity = parseNasdaqNumber(ownership.netActivity);
  const topHolders = (args.response.data?.top5Holders ?? [])
    .filter((holder) => holder.name)
    .slice(0, 5);

  return [
    {
      source: "nasdaq_institutional_ownership",
      sourceType: "research",
      sourceId: `nasdaq:institutional-ownership:${ticker}:${nowIso().slice(0, 10)}`,
      title: `${ticker} institutional ownership snapshot`,
      url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/institutional-holdings`,
      publishedAt: args.fetchedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        holdingsPct !== undefined
          ? `Institutional ownership: ${holdingsPct.toFixed(2)}%`
          : "",
        holders !== undefined
          ? `Institutional holders: ${formatCompactNumber(holders)}`
          : "",
        sharesHeld !== undefined
          ? `Shares held: ${formatCompactNumber(sharesHeld)}`
          : "",
        holdingsValue !== undefined
          ? `Holdings value: ${formatCompactNumber(holdingsValue)}`
          : "",
        netActivity !== undefined
          ? `Net institutional activity: ${formatCompactNumber(netActivity)} shares`
          : "",
        topHolders.length > 0
          ? `Top holders: ${topHolders
              .map(
                (holder) =>
                  `${holder.name} (${formatCompactNumber(parseNasdaqNumber(holder.shares))})`,
              )
              .join("; ")}`
          : "",
        "Institutional ownership is a sponsorship/liquidity signal; strong net activity can support a thesis but 13F-derived data can lag.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        ownership,
        topHolders,
        holdingsPct,
        holders,
        sharesHeld,
        holdingsValue,
        netActivity,
      },
      tickers: [ticker],
    },
  ];
}

function findNasdaqSummaryRow(
  rows: NasdaqInsiderTradeSummaryRow[] | undefined,
  label: RegExp,
) {
  return rows?.find((row) => label.test(row.insiderTrade ?? ""));
}

function transactionVerb(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("buy")) {
    return "buy";
  }
  if (normalized.includes("sell") || normalized.includes("disposition")) {
    return "sell";
  }
  return "other";
}

export function buildNasdaqInsiderTradeItems(args: {
  response: NasdaqInsiderTradesResponse;
  ticker: string;
  fetchedAt: Date;
  limit: number;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const tradeRows = args.response.data?.numberOfTrades?.rows ?? [];
  const shareRows = args.response.data?.numberOfSharesTraded?.rows ?? [];
  const transactions = (args.response.data?.transactionTable?.table?.rows ?? [])
    .filter((row) => row.insider || row.transactionType)
    .slice(0, args.limit);
  if (
    tradeRows.length === 0 &&
    shareRows.length === 0 &&
    transactions.length === 0
  ) {
    return [];
  }

  const buys3M = parseNasdaqNumber(
    findNasdaqSummaryRow(tradeRows, /open market buys/i)?.months3,
  );
  const sells3M = parseNasdaqNumber(
    findNasdaqSummaryRow(tradeRows, /number of sells/i)?.months3,
  );
  const buys12M = parseNasdaqNumber(
    findNasdaqSummaryRow(tradeRows, /open market buys/i)?.months12,
  );
  const sells12M = parseNasdaqNumber(
    findNasdaqSummaryRow(tradeRows, /number of sells/i)?.months12,
  );
  const sharesBought3M = parseNasdaqNumber(
    findNasdaqSummaryRow(shareRows, /shares bought/i)?.months3,
  );
  const sharesSold3M = parseNasdaqNumber(
    findNasdaqSummaryRow(shareRows, /shares sold/i)?.months3,
  );
  const netActivity3M = parseNasdaqNumber(
    findNasdaqSummaryRow(shareRows, /net activity/i)?.months3,
  );
  const totalRecords = parseNasdaqNumber(
    args.response.data?.transactionTable?.totalRecords,
  );
  const latestTransaction = transactions[0];
  const latestDate = latestTransaction?.lastDate;
  const latestPublishedAt = latestDate
    ? parseNasdaqDate(latestDate)
    : args.fetchedAt;
  const latestRows = transactions.slice(0, 5);
  const recentSellRows = transactions.filter(
    (row) => transactionVerb(row.transactionType) === "sell",
  ).length;
  const recentBuyRows = transactions.filter(
    (row) => transactionVerb(row.transactionType) === "buy",
  ).length;

  return [
    {
      source: "nasdaq_insider_trades",
      sourceType: "company",
      sourceId: `nasdaq:insider-trades:${ticker}:${latestDate ?? nowIso().slice(0, 10)}`,
      title: `${ticker} insider trading snapshot`,
      url: `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/insider-activity`,
      publishedAt: latestPublishedAt,
      discoveredAt: args.fetchedAt,
      fetchedAt: args.fetchedAt,
      body: [
        buys3M !== undefined || sells3M !== undefined
          ? `3-month trades: ${buys3M ?? 0} buys / ${sells3M ?? 0} sells`
          : "",
        buys12M !== undefined || sells12M !== undefined
          ? `12-month trades: ${buys12M ?? 0} buys / ${sells12M ?? 0} sells`
          : "",
        sharesBought3M !== undefined
          ? `3-month shares bought: ${formatCompactNumber(sharesBought3M)}`
          : "",
        sharesSold3M !== undefined
          ? `3-month shares sold: ${formatCompactNumber(sharesSold3M)}`
          : "",
        netActivity3M !== undefined
          ? `3-month net insider activity: ${formatCompactNumber(netActivity3M)} shares`
          : "",
        totalRecords !== undefined
          ? `Transaction rows available: ${formatCompactNumber(totalRecords)}`
          : "",
        `Latest rows analyzed: ${transactions.length} (${recentBuyRows} buy-like / ${recentSellRows} sell-like)`,
        latestRows.length > 0
          ? `Latest transactions: ${latestRows
              .map(
                (row) =>
                  `${row.lastDate ?? "unknown date"} ${row.insider ?? "unknown insider"} ${row.transactionType ?? "transaction"} ${formatCompactNumber(parseNasdaqNumber(row.sharesTraded))} @ ${row.lastPrice ?? "n/a"}`,
              )
              .join("; ")}`
          : "",
        "Insider activity is an alignment/risk signal; routine automatic sales are weaker than open-market buys or cluster buying.",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        tradeRows,
        shareRows,
        latestRows,
        buys3M,
        sells3M,
        buys12M,
        sells12M,
        sharesBought3M,
        sharesSold3M,
        netActivity3M,
        totalRecords,
        recentBuyRows,
        recentSellRows,
      },
      tickers: [ticker],
    },
  ];
}

async function collectNasdaqOwnershipSignals(
  entry: UniverseEntry,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const insiderLimit = envNumber(
    "INTEL_NASDAQ_INSIDER_TRADES_LIMIT",
    presetLimit(preset, { fast: 20, deep: 60, exhaustive: 120 }),
  );
  const ownershipUrl = new URL(
    `/api/company/${encodeURIComponent(ticker)}/ownership-summary`,
    NASDAQ_BASE_URL,
  );
  const insiderUrl = new URL(
    `/api/company/${encodeURIComponent(ticker)}/insider-trades`,
    NASDAQ_BASE_URL,
  );

  const [ownership, insider] = await Promise.all([
    fetchJson<NasdaqOwnershipSummaryResponse>(ownershipUrl, nasdaqHeaders()),
    fetchJson<NasdaqInsiderTradesResponse>(insiderUrl, nasdaqHeaders()),
  ]);
  const fetchedAt = new Date();
  const ownershipItems = ownership.data
    ? buildNasdaqInstitutionalOwnershipItems({
        response: ownership.data,
        ticker,
        fetchedAt,
      })
    : [];
  const insiderItems = insider.data
    ? buildNasdaqInsiderTradeItems({
        response: insider.data,
        ticker,
        fetchedAt,
        limit: insiderLimit,
      })
    : [];

  return {
    items: [...ownershipItems, ...insiderItems],
    diagnostics: [
      makeDiagnostic({
        source: "nasdaq_institutional_ownership",
        label: `ticker-institutional-ownership:${ticker}`,
        startedAt,
        status: ownership.status === 200 ? "ok" : "failed",
        itemCount: ownershipItems.length,
        message:
          ownership.status === 200
            ? undefined
            : `HTTP ${ownership.status}: ${ownership.text.slice(0, 160)}`,
        metadata: { ticker },
      }),
      makeDiagnostic({
        source: "nasdaq_insider_trades",
        label: `ticker-insider-trades:${ticker}`,
        startedAt,
        status: insider.status === 200 ? "ok" : "failed",
        itemCount: insiderItems.length,
        message:
          insider.status === 200
            ? undefined
            : `HTTP ${insider.status}: ${insider.text.slice(0, 160)}`,
        metadata: {
          ticker,
          limit: insiderLimit,
          returnedRows:
            insider.data?.data?.transactionTable?.table?.rows?.length ?? 0,
        },
      }),
    ],
  };
}

export function buildFinnhubEarningsCalendarItems(args: {
  response: FinnhubEarningsCalendarResponse;
  ticker: string;
  fetchedAt: Date;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  const items = args.response.earningsCalendar ?? [];
  return items
    .filter((item) => normalizeTicker(item.symbol ?? ticker) === ticker)
    .filter((item) => item.date)
    .map((item): IntelRawItemInput => {
      const eventDate = parseDate(item.date);
      const quarter = item.quarter ? `Q${item.quarter}` : "quarter";
      const year = item.year ? String(item.year) : "unknown year";
      const hasReported =
        typeof item.epsActual === "number" ||
        typeof item.revenueActual === "number";
      const timing = item.hour ? ` (${item.hour})` : "";
      const title = hasReported
        ? `${ticker} reported ${year} ${quarter} earnings on ${item.date}${timing}`
        : `${ticker} earnings scheduled for ${item.date}${timing}`;
      return {
        source: "finnhub_earnings_calendar",
        sourceType: "company",
        sourceId: `finnhub:earnings-calendar:${ticker}:${item.date}:${item.year ?? ""}:${item.quarter ?? ""}`,
        title,
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/earnings`,
        publishedAt: eventDate,
        discoveredAt: args.fetchedAt,
        fetchedAt: args.fetchedAt,
        body: [
          `Event date: ${item.date}${timing}`,
          item.year || item.quarter ? `Fiscal period: ${year} ${quarter}` : "",
          formatOptionalNumber("EPS actual", item.epsActual),
          formatOptionalNumber("EPS estimate", item.epsEstimate),
          formatOptionalNumber("Revenue actual", item.revenueActual),
          formatOptionalNumber("Revenue estimate", item.revenueEstimate),
          hasReported
            ? "Reported earnings can drive immediate post-result repricing."
            : "Upcoming earnings are a scheduled catalyst that can drive positioning before and after the release.",
        ]
          .filter(Boolean)
          .join("\n"),
        rawPayload: item,
        tickers: [ticker],
      };
    });
}

async function collectFinnhubEarningsCalendar(
  entry: UniverseEntry,
  horizon: IntelHorizon,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const apiKey = env("FINNHUB_API_KEY");
  const ticker = normalizeTicker(entry.ticker);
  if (!apiKey) {
    return {
      items: [],
      diagnostics: [
        makeDiagnostic({
          source: "finnhub_earnings_calendar",
          label: `ticker-earnings-calendar:${ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: "FINNHUB_API_KEY is not configured",
        }),
      ],
    };
  }

  const range = earningsCalendarDateRange(horizon);
  const url = new URL("/api/v1/calendar/earnings", FINNHUB_BASE_URL);
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("from", yyyyMmDd(range.from));
  url.searchParams.set("to", yyyyMmDd(range.to));
  url.searchParams.set("token", apiKey);
  const result = await fetchJson<FinnhubEarningsCalendarResponse>(url);
  const fetchedAt = new Date();
  const items = result.data
    ? buildFinnhubEarningsCalendarItems({
        response: result.data,
        ticker,
        fetchedAt,
      })
    : [];

  return {
    items,
    diagnostics: [
      makeDiagnostic({
        source: "finnhub_earnings_calendar",
        label: `ticker-earnings-calendar:${ticker}`,
        startedAt,
        status: result.status === 200 ? "ok" : "failed",
        itemCount: items.length,
        message:
          result.status === 200
            ? undefined
            : `HTTP ${result.status}: ${result.text.slice(0, 160)}`,
        metadata: {
          ticker,
          from: yyyyMmDd(range.from),
          to: yyyyMmDd(range.to),
          returned: result.data?.earningsCalendar?.length ?? 0,
        },
      }),
    ],
  };
}

async function collectRss(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const terms = companyTerms(entry);
  const queries = [
    {
      source: "google_news",
      label: `ticker-rss:${ticker}:google`,
      url: new URL(GOOGLE_NEWS_RSS_URL),
      tickers: undefined as string[] | undefined,
    },
    {
      source: "yahoo_finance_rss",
      label: `ticker-rss:${ticker}:yahoo`,
      url: new URL(YAHOO_FINANCE_RSS_URL),
      tickers: [ticker],
    },
  ];
  queries[0].url.searchParams.set(
    "q",
    `(${terms.join(" OR ")}) when:${horizonDays(horizon)}d`,
  );
  queries[0].url.searchParams.set("hl", "en-US");
  queries[0].url.searchParams.set("gl", "US");
  queries[0].url.searchParams.set("ceid", "US:en");
  queries[1].url.searchParams.set("s", ticker);
  queries[1].url.searchParams.set("region", "US");
  queries[1].url.searchParams.set("lang", "en-US");

  const items: IntelRawItemInput[] = [];
  const diagnostics: SourceDiagnostic[] = [];
  const perSourceLimit = presetLimit(preset, {
    fast: 40,
    deep: 100,
    exhaustive: 200,
  });
  for (const query of queries) {
    const result = await fetchText(query.url, {
      "User-Agent": "Eyri market intelligence",
    });
    const rssItems = result.text ? parseRssItems(result.text) : [];
    const fetchedAt = new Date();
    for (const item of rssItems.slice(0, perSourceLimit)) {
      if (!item.title) {
        continue;
      }
      items.push({
        source: query.source,
        sourceType: "news",
        sourceId: `${query.source}:${item.link || item.title}`,
        title: item.title,
        url: item.link || undefined,
        publishedAt: parseDate(item.pubDate),
        fetchedAt,
        body: [item.description, item.source ? `Source: ${item.source}` : ""]
          .filter(Boolean)
          .join("\n"),
        rawPayload: item,
        tickers: query.tickers,
      });
    }
    diagnostics.push(
      makeDiagnostic({
        source: query.source,
        label: query.label,
        startedAt,
        status: result.text ? "ok" : "failed",
        itemCount: rssItems.length,
        message: result.text ? undefined : `HTTP ${result.status}`,
        metadata: { ticker },
      }),
    );
  }

  return { items, diagnostics };
}

export function buildCompanyReleaseRssItems(args: {
  rssItems: RssItem[];
  ticker: string;
  fetchedAt: Date;
  limit: number;
}): IntelRawItemInput[] {
  const ticker = normalizeTicker(args.ticker);
  return args.rssItems
    .filter((item) => item.title)
    .slice(0, args.limit)
    .map(
      (item): IntelRawItemInput => ({
        source: "company_releases",
        sourceType: "company",
        sourceId: `company_releases:${item.link || item.title}`,
        title: item.title,
        url: item.link || undefined,
        publishedAt: parseDate(item.pubDate),
        discoveredAt: args.fetchedAt,
        fetchedAt: args.fetchedAt,
        body: [
          item.description,
          item.source ? `Source: ${item.source}` : "",
          "Release-focused discovery query; verify whether this is a direct company/IR source or a syndicated rewrite.",
        ]
          .filter(Boolean)
          .join("\n"),
        rawPayload: item,
        tickers: [ticker],
      }),
    );
}

async function collectCompanyReleases(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const limit = envNumber(
    "INTEL_COMPANY_RELEASE_RSS_LIMIT",
    presetLimit(preset, { fast: 25, deep: 60, exhaustive: 120 }),
  );
  const url = new URL(GOOGLE_NEWS_RSS_URL);
  url.searchParams.set("q", companyReleaseSearchQuery(entry, horizon));
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const result = await fetchText(url, {
    "User-Agent": "Eyri market intelligence",
  });
  const rssItems = result.text ? parseRssItems(result.text) : [];
  const fetchedAt = new Date();
  const items = buildCompanyReleaseRssItems({
    rssItems,
    ticker,
    fetchedAt,
    limit,
  });

  return {
    items,
    diagnostics: [
      makeDiagnostic({
        source: "company_releases",
        label: `ticker-company-releases:${ticker}`,
        startedAt,
        status: result.text ? "ok" : "failed",
        itemCount: rssItems.length,
        message: result.text ? undefined : `HTTP ${result.status}`,
        metadata: { ticker, limit },
      }),
    ],
  };
}

async function collectSocial(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const ticker = normalizeTicker(entry.ticker);
  const terms = companyTerms(entry);
  const items: IntelRawItemInput[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  const fetchedAt = new Date();
  const redditBearer = env("REDDIT_BEARER_TOKEN");
  if (redditBearer || envBoolean("INTEL_REDDIT_ALLOW_UNAUTH")) {
    const redditUrl = new URL(REDDIT_SEARCH_URL);
    redditUrl.searchParams.set("q", `${terms.join(" OR ")} stock`);
    redditUrl.searchParams.set("sort", "new");
    redditUrl.searchParams.set(
      "t",
      horizon === "1d" ? "day" : horizon === "3d" ? "week" : "month",
    );
    redditUrl.searchParams.set(
      "limit",
      String(
        envNumber(
          "INTEL_REDDIT_LIMIT",
          presetLimit(preset, { fast: 25, deep: 75, exhaustive: 150 }),
        ),
      ),
    );
    const reddit = await fetchJson<{ data?: { children?: RedditChild[] } }>(
      redditUrl,
      {
        "User-Agent": "Eyri market intelligence",
        ...(redditBearer ? { Authorization: `Bearer ${redditBearer}` } : {}),
      },
    );
    const redditChildren = reddit.data?.data?.children ?? [];
    for (const child of redditChildren) {
      const post = child.data;
      if (!post?.title) {
        continue;
      }
      items.push({
        source: "reddit",
        sourceType: "social",
        sourceId: `reddit:${post.id ?? post.permalink ?? post.title}`,
        title: post.title,
        url: post.permalink
          ? `https://www.reddit.com${post.permalink}`
          : post.url,
        publishedAt: parseDate(post.created_utc),
        fetchedAt,
        body: [
          post.selftext,
          post.subreddit ? `Subreddit: ${post.subreddit}` : "",
          `Score: ${toNumber(post.score) ?? 0}; comments: ${
            toNumber(post.num_comments) ?? 0
          }`,
        ]
          .filter(Boolean)
          .join("\n"),
        rawPayload: post,
      });
    }
    diagnostics.push(
      makeDiagnostic({
        source: "reddit",
        label: `ticker-social:${ticker}:reddit`,
        startedAt,
        status: reddit.data ? "ok" : "failed",
        itemCount: redditChildren.length,
        message: reddit.data ? undefined : `HTTP ${reddit.status}`,
        metadata: { ticker, authenticated: Boolean(redditBearer) },
      }),
    );
  } else {
    diagnostics.push(
      makeDiagnostic({
        source: "reddit",
        label: `ticker-social:${ticker}:reddit`,
        startedAt,
        status: "partial",
        itemCount: 0,
        message:
          "Reddit search skipped; configure REDDIT_BEARER_TOKEN or INTEL_REDDIT_ALLOW_UNAUTH",
        metadata: { ticker },
      }),
    );
  }

  const stockTwitsUrl = new URL(
    `/api/2/streams/symbol/${encodeURIComponent(ticker)}.json`,
    STOCKTWITS_SYMBOL_URL,
  );
  stockTwitsUrl.searchParams.set(
    "limit",
    String(
      envNumber(
        "INTEL_STOCKTWITS_LIMIT",
        presetLimit(preset, { fast: 20, deep: 30, exhaustive: 60 }),
      ),
    ),
  );
  const stockTwits = await fetchJson<{ messages?: StockTwitsMessage[] }>(
    stockTwitsUrl,
    { "User-Agent": "Eyri market intelligence" },
  );
  const messages = stockTwits.data?.messages ?? [];
  for (const message of messages) {
    if (!message.body) {
      continue;
    }
    items.push({
      source: "stocktwits",
      sourceType: "social",
      sourceId: `stocktwits:${message.id ?? message.body}`,
      title: `${ticker} StockTwits message`,
      url: message.id
        ? `https://stocktwits.com/symbol/${encodeURIComponent(ticker)}`
        : undefined,
      publishedAt: parseDate(message.created_at),
      fetchedAt,
      body: [
        message.body,
        message.user?.username ? `User: ${message.user.username}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: message,
      tickers: [ticker],
    });
  }
  diagnostics.push(
    makeDiagnostic({
      source: "stocktwits",
      label: `ticker-social:${ticker}:stocktwits`,
      startedAt,
      status: stockTwits.data ? "ok" : "failed",
      itemCount: messages.length,
      message: stockTwits.data ? undefined : `HTTP ${stockTwits.status}`,
      metadata: { ticker },
    }),
  );

  return { items, diagnostics };
}

export async function collectDeepSourceItems(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset = "deep",
): Promise<SourceCollectionResult> {
  const [
    alpaca,
    finnhub,
    analyst,
    earnings,
    chart,
    nasdaq,
    nasdaqAnalyst,
    ownership,
    rss,
    releases,
    social,
  ] = await Promise.all([
    collectAlpacaNews(entry, horizon, preset),
    collectFinnhub(entry, horizon, preset),
    collectFinnhubAnalystSignals(entry, horizon, preset),
    collectFinnhubEarningsCalendar(entry, horizon),
    collectYahooChartContext(entry, horizon),
    collectNasdaqPositioning(entry, preset),
    collectNasdaqAnalystAndEarnings(entry, preset),
    collectNasdaqOwnershipSignals(entry, preset),
    collectRss(entry, horizon, preset),
    collectCompanyReleases(entry, horizon, preset),
    collectSocial(entry, horizon, preset),
  ]);

  return {
    items: [
      ...alpaca.items,
      ...finnhub.items,
      ...analyst.items,
      ...earnings.items,
      ...chart.items,
      ...nasdaq.items,
      ...nasdaqAnalyst.items,
      ...ownership.items,
      ...rss.items,
      ...releases.items,
      ...social.items,
    ],
    diagnostics: [
      ...alpaca.diagnostics,
      ...finnhub.diagnostics,
      ...analyst.diagnostics,
      ...earnings.diagnostics,
      ...chart.diagnostics,
      ...nasdaq.diagnostics,
      ...nasdaqAnalyst.diagnostics,
      ...ownership.diagnostics,
      ...rss.diagnostics,
      ...releases.diagnostics,
      ...social.diagnostics,
    ],
  };
}
