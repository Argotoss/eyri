import type {
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

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
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
  const url = new URL(GDELT_DOC_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("timespan", horizonToTimespan(horizon));
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("sort", "HybridRel");

  try {
    await throttleGdelt();
    const response = await fetch(url, {
      headers: { "User-Agent": "Eyri market intelligence" },
    });
    const text = await response.text();
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${text.slice(0, 180)}`;
      console.error(`[intel:gdelt] ${label} failed: ${message}`);
      return {
        articles: [],
        diagnostic: diagnostic({
          label,
          startedAt,
          status: "failed",
          itemCount: 0,
          message,
          metadata: { query, status: response.status },
        }),
      };
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
    return {
      articles,
      diagnostic: diagnostic({
        label,
        startedAt,
        status: "ok",
        itemCount: articles.length,
        metadata: { query },
      }),
    };
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

function rawItemsFromArticles(
  articles: GdeltArticle[],
  queryLabel: string,
): IntelRawItemInput[] {
  const fetchedAt = new Date();
  return articles
    .filter((article) => article.title && article.url)
    .map((article) => ({
      source: "gdelt",
      sourceType: "news",
      sourceId: sourceIdForArticle(article),
      title: article.title ?? "Untitled article",
      url: article.url,
      publishedAt: parseGdeltDate(article.seendate),
      fetchedAt,
      body: [article.title, article.domain ? `Source: ${article.domain}` : ""]
        .filter(Boolean)
        .join("\n"),
      rawPayload: { ...article, queryLabel },
    }));
}

function directQueryForTicker(entry: UniverseEntry) {
  const name = entry.name === entry.ticker ? "" : entry.name;
  return [name && `"${name}"`, entry.ticker, "stock"].filter(Boolean).join(" ");
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
