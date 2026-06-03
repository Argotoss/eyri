import type {
  DeepResearchPreset,
  IntelHorizon,
  IntelRawItemInput,
  SourceDiagnostic,
  SourceCollectionResult,
  UniverseEntry,
} from "../types.ts";

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

const DEFAULT_SP500_FOCUS_TICKERS = new Set([
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "GOOGL",
  "TSLA",
  "AVGO",
  "JPM",
  "LLY",
]);

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

type GdeltFetchResult = {
  articles: GdeltArticle[];
  diagnostic: SourceDiagnostic;
};

let lastGdeltRequestAt = 0;
let gdeltDisabledUntil = 0;
const gdeltCache = new Map<
  string,
  { fetchedAt: number; result: GdeltFetchResult }
>();

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function presetLimit(
  preset: DeepResearchPreset,
  values: { fast: number; deep: number; exhaustive: number },
) {
  return values[preset];
}

function horizonToTimespan(horizon: IntelHorizon) {
  return horizon;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleGdelt() {
  const delayMs = envNumber("INTEL_GDELT_DELAY_MS", 6500);
  const elapsed = Date.now() - lastGdeltRequestAt;
  const waitMs = Math.max(0, delayMs - elapsed);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  lastGdeltRequestAt = Date.now();
}

function cacheTtlMs() {
  return envNumber("INTEL_GDELT_CACHE_TTL_MS", 15 * 60_000);
}

function retryDelayMs(attempt: number) {
  const baseDelay = envNumber("INTEL_GDELT_429_BACKOFF_MS", 90_000);
  return baseDelay * Math.max(1, attempt);
}

function parseGdeltDate(value: string | undefined) {
  if (!value) {
    return new Date();
  }

  const normalized = value.includes("T")
    ? value
    : `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(
        8,
        10,
      )}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function sourceIdForArticle(article: GdeltArticle) {
  return article.url ?? `${article.domain ?? "gdelt"}:${article.title ?? ""}`;
}

export function parseGdeltResponseText(text: string): GdeltResponse | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as GdeltResponse;
  } catch {
    return null;
  }
}

function diagnostic(args: {
  label: string;
  startedAt: Date;
  status: SourceDiagnostic["status"];
  itemCount: number;
  message?: string;
  metadata?: Record<string, unknown>;
}): SourceDiagnostic {
  return {
    source: "gdelt",
    label: args.label,
    status: args.status,
    itemCount: args.itemCount,
    startedAt: args.startedAt,
    completedAt: new Date(),
    message: args.message,
    metadata: args.metadata,
  };
}

async function fetchGdeltArticles(
  label: string,
  query: string,
  horizon: IntelHorizon,
  maxRecords: number,
): Promise<GdeltFetchResult> {
  const startedAt = new Date();
  const cacheKey = `${label}\n${query}\n${horizon}\n${maxRecords}`;
  const cached = gdeltCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < cacheTtlMs()) {
    return {
      articles: cached.result.articles,
      diagnostic: {
        ...cached.result.diagnostic,
        label,
        startedAt,
        completedAt: new Date(),
        metadata: {
          ...(cached.result.diagnostic.metadata ?? {}),
          query,
          cache: "hit",
        },
      },
    };
  }

  if (Date.now() < gdeltDisabledUntil) {
    const waitSeconds = Math.ceil((gdeltDisabledUntil - Date.now()) / 1000);
    return {
      articles: [],
      diagnostic: diagnostic({
        label,
        startedAt,
        status: "failed",
        itemCount: 0,
        message: `GDELT temporarily disabled after rate limiting; retry in ${waitSeconds}s`,
        metadata: { query, disabledUntil: new Date(gdeltDisabledUntil) },
      }),
    };
  }

  const url = new URL(GDELT_DOC_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("timespan", horizonToTimespan(horizon));
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("sort", "HybridRel");

  const maxRetries = envNumber("INTEL_GDELT_MAX_RETRIES", 2);
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await throttleGdelt();
      const response = await fetch(url, {
        headers: { "User-Agent": "Eyri market intelligence" },
      });
      const text = await response.text();
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${text.slice(0, 180)}`;
        console.error(`[intel:gdelt] ${label} failed: ${message}`);
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const disabledMs = Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : retryDelayMs(attempt + 1);
        if (response.status === 429) {
          gdeltDisabledUntil = Date.now() + disabledMs;
        }
        const failed = {
          articles: [],
          diagnostic: diagnostic({
            label,
            startedAt,
            status: "failed",
            itemCount: 0,
            message,
            metadata: { query, status: response.status, attempt },
          }),
        };
        if (response.status !== 429 && attempt < maxRetries) {
          await sleep(Math.min(2000, retryDelayMs(attempt + 1)));
          continue;
        }
        return failed;
      }

      const data = parseGdeltResponseText(text);
      if (!data) {
        const message = `non-JSON response: ${text.slice(0, 180)}`;
        console.error(`[intel:gdelt] ${label} failed: ${message}`);
        return {
          articles: [],
          diagnostic: diagnostic({
            label,
            startedAt,
            status: "failed",
            itemCount: 0,
            message,
            metadata: { query },
          }),
        };
      }

      const articles = data.articles ?? [];
      const result = {
        articles,
        diagnostic: diagnostic({
          label,
          startedAt,
          status: "ok",
          itemCount: articles.length,
          metadata: { query, cache: "miss" },
        }),
      };
      gdeltCache.set(cacheKey, { fetchedAt: Date.now(), result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[intel:gdelt] ${label} failed: ${message}`);
      return {
        articles: [],
        diagnostic: diagnostic({
          label,
          startedAt,
          status: "failed",
          itemCount: 0,
          message,
          metadata: { query },
        }),
      };
    }
  }

  return {
    articles: [],
    diagnostic: diagnostic({
      label,
      startedAt,
      status: "failed",
      itemCount: 0,
      message: "GDELT request exhausted retries",
      metadata: { query },
    }),
  };
}

function rawItemsFromArticles(
  articles: GdeltArticle[],
  queryLabel: string,
): IntelRawItemInput[] {
  const fetchedAt = new Date();
  return articles
    .filter((article) => article.title && article.url)
    .map((article) => {
      const discoveredAt = parseGdeltDate(article.seendate);
      return {
        source: "gdelt",
        sourceType: "news",
        sourceId: sourceIdForArticle(article),
        title: article.title ?? "Untitled article",
        url: article.url,
        publishedAt: discoveredAt,
        discoveredAt,
        fetchedAt,
        body: [article.title, article.domain ? `Source: ${article.domain}` : ""]
          .filter(Boolean)
          .join("\n"),
        rawPayload: { ...article, queryLabel },
      };
    });
}

function directQueryForTicker(entry: UniverseEntry) {
  const name = entry.name === entry.ticker ? "" : entry.name;
  return [name && `"${name}"`, entry.ticker, "stock"].filter(Boolean).join(" ");
}

function deepQueriesForTicker(entry: UniverseEntry) {
  const name = entry.name === entry.ticker ? "" : entry.name;
  const quotedName = name
    ? `"${name.replace(/\b(Inc|Corporation|Corp)\b\.?/gi, "").trim()}"`
    : "";
  const aliases = entry.aliases
    .filter((alias) => alias !== entry.ticker && alias.length >= 4)
    .filter((alias) => alias.toLowerCase() !== name.toLowerCase())
    .slice(0, 1)
    .map((alias) => `"${alias}"`);
  const identity = [
    ...new Set([quotedName, ...aliases, `$${entry.ticker}`, entry.ticker]),
  ]
    .filter(Boolean)
    .join(" OR ");
  const sourceLang = "sourcelang:english";

  return [
    {
      label: `ticker-deep:${entry.ticker}:latest`,
      query: `(${identity}) ${sourceLang}`,
    },
    {
      label: `ticker-deep:${entry.ticker}:market-reaction`,
      query: `(${identity}) (earnings OR guidance OR analyst OR demand OR supply OR shares OR stock OR volume) ${sourceLang}`,
    },
    {
      label: `ticker-deep:${entry.ticker}:industry`,
      query: entry.sector
        ? `(${identity}) ("${entry.sector}" OR industry OR competitor OR pricing) ${sourceLang}`
        : `(${identity}) (industry OR competitor OR pricing) ${sourceLang}`,
    },
  ];
}

export async function collectGdeltItemsForTicker(
  entry: UniverseEntry,
  horizon: IntelHorizon,
  preset: DeepResearchPreset = "deep",
): Promise<SourceCollectionResult> {
  const maxRecords = envNumber(
    "INTEL_GDELT_DEEP_MAX_RECORDS",
    presetLimit(preset, { fast: 40, deep: 100, exhaustive: 200 }),
  );
  const rawItems: IntelRawItemInput[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  const queries = deepQueriesForTicker(entry).slice(
    0,
    presetLimit(preset, { fast: 1, deep: 2, exhaustive: 3 }),
  );
  for (const { label, query } of queries) {
    const result = await fetchGdeltArticles(label, query, horizon, maxRecords);
    diagnostics.push(result.diagnostic);
    rawItems.push(...rawItemsFromArticles(result.articles, label));
  }

  return { items: rawItems, diagnostics };
}

export async function collectGdeltItems(
  universe: UniverseEntry[],
  horizon: IntelHorizon,
): Promise<SourceCollectionResult> {
  const maxBroadRecords = envNumber("INTEL_GDELT_BROAD_MAX_RECORDS", 75);
  const maxDirectRecords = envNumber("INTEL_GDELT_DIRECT_MAX_RECORDS", 15);
  const directLimit = envNumber("INTEL_GDELT_DIRECT_TICKER_LIMIT", 5);
  const sp500FocusLimit = envNumber("INTEL_GDELT_SP500_FOCUS_LIMIT", 8);
  const rawItems: IntelRawItemInput[] = [];
  const diagnostics: SourceDiagnostic[] = [];

  const broadQuery = [
    "(earnings OR guidance OR acquisition OR lawsuit OR upgrade OR downgrade)",
    "(stock OR shares OR revenue)",
    "sourcelang:english",
  ].join(" ");
  const broad = await fetchGdeltArticles(
    "broad-market-catalysts",
    broadQuery,
    horizon,
    maxBroadRecords,
  );
  diagnostics.push(broad.diagnostic);
  rawItems.push(
    ...rawItemsFromArticles(broad.articles, "broad-market-catalysts"),
  );

  const priorityEntries = universe
    .filter(
      (entry) =>
        entry.sources.includes("portfolio") ||
        entry.sources.includes("watchlist"),
    )
    .slice(0, directLimit);
  const priorityTickers = new Set(priorityEntries.map((entry) => entry.ticker));
  const sp500FocusEntries = universe
    .filter(
      (entry) =>
        entry.sources.includes("sp500") &&
        !priorityTickers.has(entry.ticker) &&
        DEFAULT_SP500_FOCUS_TICKERS.has(entry.ticker),
    )
    .slice(0, sp500FocusLimit);

  for (const entry of [...priorityEntries, ...sp500FocusEntries]) {
    const query = directQueryForTicker(entry);
    const label =
      entry.sources.includes("portfolio") || entry.sources.includes("watchlist")
        ? `ticker:${entry.ticker}`
        : `sp500-focus:${entry.ticker}`;
    const result = await fetchGdeltArticles(
      label,
      query,
      horizon,
      maxDirectRecords,
    );
    diagnostics.push(result.diagnostic);
    rawItems.push(...rawItemsFromArticles(result.articles, label));
  }

  return { items: rawItems, diagnostics };
}
