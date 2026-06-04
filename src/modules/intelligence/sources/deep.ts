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

function formatOptionalNumber(label: string, value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${label}: ${value}`
    : "";
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
  const [alpaca, finnhub, earnings, rss, releases, social] = await Promise.all([
    collectAlpacaNews(entry, horizon, preset),
    collectFinnhub(entry, horizon, preset),
    collectFinnhubEarningsCalendar(entry, horizon),
    collectRss(entry, horizon, preset),
    collectCompanyReleases(entry, horizon, preset),
    collectSocial(entry, horizon, preset),
  ]);

  return {
    items: [
      ...alpaca.items,
      ...finnhub.items,
      ...earnings.items,
      ...rss.items,
      ...releases.items,
      ...social.items,
    ],
    diagnostics: [
      ...alpaca.diagnostics,
      ...finnhub.diagnostics,
      ...earnings.diagnostics,
      ...rss.diagnostics,
      ...releases.diagnostics,
      ...social.diagnostics,
    ],
  };
}
