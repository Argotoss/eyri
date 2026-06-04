export type SourceReliability = "primary" | "high" | "medium" | "low";

export type SourceCategory =
  | "market_data"
  | "fundamentals"
  | "event_calendar"
  | "analyst_research"
  | "market_positioning"
  | "primary_filings"
  | "company_release"
  | "news"
  | "news_discovery"
  | "social"
  | "fulltext"
  | "model"
  | "unknown";

export type SourceProfile = {
  key: string;
  displayName: string;
  category: SourceCategory;
  reliability: SourceReliability;
  qualityScore: number;
  evidenceWeight: number;
  cost: "free" | "configured_api" | "web_fetch" | "model_tokens";
  rateLimit: string;
  freshness: string;
  coverage: string;
  limitations: string;
};

const SOURCE_REGISTRY: Record<string, SourceProfile> = {
  prices: {
    key: "prices",
    displayName: "Quote Providers",
    category: "market_data",
    reliability: "high",
    qualityScore: 86,
    evidenceWeight: 0.9,
    cost: "configured_api",
    rateLimit: "provider dependent",
    freshness: "near real time when provider supports it",
    coverage: "price, move, volume, day range, provider symbol mapping",
    limitations: "after-hours and delayed-provider behavior can vary",
  },
  fundamentals: {
    key: "fundamentals",
    displayName: "SEC Company Facts",
    category: "fundamentals",
    reliability: "primary",
    qualityScore: 90,
    evidenceWeight: 0.9,
    cost: "free",
    rateLimit: "SEC polite usage limits",
    freshness: "filing dependent",
    coverage: "revenue, net income, EPS, balance-sheet facts",
    limitations: "not a live valuation feed; period selection can be imperfect",
  },
  sec: {
    key: "sec",
    displayName: "SEC EDGAR",
    category: "primary_filings",
    reliability: "primary",
    qualityScore: 94,
    evidenceWeight: 1,
    cost: "free",
    rateLimit: "SEC polite usage limits",
    freshness: "near real time after filing acceptance",
    coverage: "primary company filings, ownership forms, material disclosures",
    limitations: "routine filings are often weak standalone catalysts",
  },
  alpaca_news: {
    key: "alpaca_news",
    displayName: "Alpaca / Benzinga News",
    category: "news",
    reliability: "high",
    qualityScore: 84,
    evidenceWeight: 0.86,
    cost: "configured_api",
    rateLimit: "Alpaca API account limits",
    freshness: "fast market-news feed",
    coverage: "ticker-tagged market news",
    limitations: "coverage depends on account entitlements",
  },
  finnhub_news: {
    key: "finnhub_news",
    displayName: "Finnhub News",
    category: "news",
    reliability: "high",
    qualityScore: 82,
    evidenceWeight: 0.84,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "fast market-news feed",
    coverage: "ticker news and company headlines",
    limitations: "article depth is limited without full-text enrichment",
  },
  finnhub_metrics: {
    key: "finnhub_metrics",
    displayName: "Finnhub Metrics",
    category: "fundamentals",
    reliability: "high",
    qualityScore: 86,
    evidenceWeight: 0.82,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "provider dependent",
    coverage: "financial metrics and ratios",
    limitations: "provider fields can be stale or unavailable",
  },
  finnhub_recommendations: {
    key: "finnhub_recommendations",
    displayName: "Finnhub Recommendations",
    category: "analyst_research",
    reliability: "medium",
    qualityScore: 78,
    evidenceWeight: 0.72,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "provider dependent",
    coverage: "analyst recommendation trends",
    limitations: "summary-level analyst data, not full research notes",
  },
  finnhub_price_target: {
    key: "finnhub_price_target",
    displayName: "Finnhub Price Targets",
    category: "analyst_research",
    reliability: "medium",
    qualityScore: 80,
    evidenceWeight: 0.76,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "provider dependent",
    coverage: "analyst target high, low, mean, median, and update timestamp",
    limitations:
      "consensus target snapshots lag real research notes and need revision context",
  },
  finnhub_upgrade_downgrade: {
    key: "finnhub_upgrade_downgrade",
    displayName: "Finnhub Rating Revisions",
    category: "analyst_research",
    reliability: "high",
    qualityScore: 83,
    evidenceWeight: 0.82,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "provider dependent",
    coverage:
      "analyst firm upgrades, downgrades, initiations, and rating changes",
    limitations:
      "does not include the full analyst note or detailed price-target rationale",
  },
  finnhub_earnings_calendar: {
    key: "finnhub_earnings_calendar",
    displayName: "Finnhub Earnings Calendar",
    category: "event_calendar",
    reliability: "high",
    qualityScore: 84,
    evidenceWeight: 0.86,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "provider dependent",
    coverage:
      "upcoming and historical earnings dates, EPS, revenue estimates, and reported results",
    limitations:
      "calendar data identifies timing but needs news/transcript confirmation for thesis quality",
  },
  finnhub_social: {
    key: "finnhub_social",
    displayName: "Finnhub Social Sentiment",
    category: "social",
    reliability: "medium",
    qualityScore: 58,
    evidenceWeight: 0.45,
    cost: "configured_api",
    rateLimit: "Finnhub API plan limits",
    freshness: "provider dependent",
    coverage: "social sentiment snapshots",
    limitations: "weak as a standalone catalyst",
  },
  yahoo_finance_rss: {
    key: "yahoo_finance_rss",
    displayName: "Yahoo Finance RSS",
    category: "news",
    reliability: "medium",
    qualityScore: 76,
    evidenceWeight: 0.72,
    cost: "free",
    rateLimit: "unofficial RSS behavior",
    freshness: "headline-feed dependent",
    coverage: "finance headlines and syndicated articles",
    limitations: "can contain syndicated duplicates",
  },
  yahoo_chart: {
    key: "yahoo_chart",
    displayName: "Yahoo Chart Context",
    category: "market_data",
    reliability: "high",
    qualityScore: 82,
    evidenceWeight: 0.8,
    cost: "free",
    rateLimit: "unofficial Yahoo endpoint behavior",
    freshness: "near real time or exchange delayed",
    coverage:
      "daily OHLC context, recent returns, volume, exchange metadata, and 52-week range position",
    limitations:
      "technical context only; it explains market reaction but not the underlying catalyst",
  },
  nasdaq_short_interest: {
    key: "nasdaq_short_interest",
    displayName: "Nasdaq Short Interest",
    category: "market_positioning",
    reliability: "high",
    qualityScore: 82,
    evidenceWeight: 0.78,
    cost: "free",
    rateLimit: "unofficial Nasdaq endpoint behavior",
    freshness: "settlement-date dependent",
    coverage:
      "short interest, average daily share volume, days to cover, and change versus previous settlement",
    limitations:
      "short interest is delayed by settlement/reporting schedule and is not intraday positioning",
  },
  nasdaq_options: {
    key: "nasdaq_options",
    displayName: "Nasdaq Options Chain",
    category: "market_positioning",
    reliability: "medium",
    qualityScore: 74,
    evidenceWeight: 0.68,
    cost: "free",
    rateLimit: "unofficial Nasdaq endpoint behavior",
    freshness: "provider dependent",
    coverage:
      "option-chain volume, open interest, put/call ratios, and crowded strikes",
    limitations:
      "chain rows are capped and do not include full flow, sweeps, Greeks, or trade direction",
  },
  google_news: {
    key: "google_news",
    displayName: "Google News RSS",
    category: "news_discovery",
    reliability: "medium",
    qualityScore: 70,
    evidenceWeight: 0.66,
    cost: "free",
    rateLimit: "unofficial RSS behavior",
    freshness: "news-discovery dependent",
    coverage: "broad web news discovery",
    limitations: "publisher quality varies and duplicates are common",
  },
  company_releases: {
    key: "company_releases",
    displayName: "Company Release Discovery",
    category: "company_release",
    reliability: "medium",
    qualityScore: 79,
    evidenceWeight: 0.78,
    cost: "free",
    rateLimit: "Google News RSS behavior",
    freshness: "news-discovery dependent",
    coverage:
      "release-focused company announcements, investor-relations syndications, and corporate news discovery",
    limitations:
      "not a direct IR feed; results can include syndications, rewrites, or unrelated announcement articles",
  },
  gdelt: {
    key: "gdelt",
    displayName: "GDELT",
    category: "news_discovery",
    reliability: "medium",
    qualityScore: 64,
    evidenceWeight: 0.62,
    cost: "free",
    rateLimit: "one request every 5 seconds; 429s expected under bursts",
    freshness: "broad web crawl discovery",
    coverage: "global article discovery and recency signals",
    limitations: "seen date is not always true publish date",
  },
  reddit: {
    key: "reddit",
    displayName: "Reddit Search",
    category: "social",
    reliability: "low",
    qualityScore: 44,
    evidenceWeight: 0.34,
    cost: "free",
    rateLimit: "requires bearer token unless unauth override is enabled",
    freshness: "social discussion dependent",
    coverage: "retail discussion and sentiment",
    limitations: "high noise and weak as standalone evidence",
  },
  stocktwits: {
    key: "stocktwits",
    displayName: "StockTwits",
    category: "social",
    reliability: "low",
    qualityScore: 42,
    evidenceWeight: 0.32,
    cost: "free",
    rateLimit: "public endpoint limits",
    freshness: "fast social chatter",
    coverage: "retail market chatter and attention",
    limitations: "very noisy and catalyst-poor without corroboration",
  },
  fulltext: {
    key: "fulltext",
    displayName: "Article Full Text",
    category: "fulltext",
    reliability: "medium",
    qualityScore: 74,
    evidenceWeight: 0.75,
    cost: "web_fetch",
    rateLimit: "bounded by INTEL_FULLTEXT_* limits",
    freshness: "depends on linked publisher",
    coverage: "publisher article body and publish-date extraction",
    limitations: "many publishers block or truncate article text",
  },
  deep_extract: {
    key: "deep_extract",
    displayName: "Cheap Extraction Model",
    category: "model",
    reliability: "medium",
    qualityScore: 68,
    evidenceWeight: 0.6,
    cost: "model_tokens",
    rateLimit: "OpenRouter/provider dependent",
    freshness: "run time",
    coverage: "event extraction and summarization",
    limitations: "model output must be grounded by source evidence",
  },
  deep_report: {
    key: "deep_report",
    displayName: "Report Model",
    category: "model",
    reliability: "medium",
    qualityScore: 66,
    evidenceWeight: 0.55,
    cost: "model_tokens",
    rateLimit: "OpenRouter/provider dependent",
    freshness: "run time",
    coverage: "narrative synthesis",
    limitations:
      "wording layer only; deterministic dossier remains source of truth",
  },
};

const DEFAULT_PROFILE: SourceProfile = {
  key: "unknown",
  displayName: "Unknown Source",
  category: "unknown",
  reliability: "low",
  qualityScore: 55,
  evidenceWeight: 0.45,
  cost: "free",
  rateLimit: "unknown",
  freshness: "unknown",
  coverage: "unknown",
  limitations: "source is not registered yet",
};

export function getSourceProfile(source: string): SourceProfile {
  const key = source.trim().toLowerCase();
  const profile = SOURCE_REGISTRY[key];
  if (profile) {
    return profile;
  }
  return {
    ...DEFAULT_PROFILE,
    key,
    displayName: source.trim() || DEFAULT_PROFILE.displayName,
  };
}

export function listSourceProfiles() {
  return Object.values(SOURCE_REGISTRY).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export function sourceQualityScore(source: string) {
  return getSourceProfile(source).qualityScore;
}

export function sourceDisplayName(source: string) {
  return getSourceProfile(source).displayName;
}

export function sourceCoverageGaps(args: {
  rawSources: string[];
  diagnosticSources?: string[];
}) {
  const profiles = [...args.rawSources, ...(args.diagnosticSources ?? [])].map(
    getSourceProfile,
  );
  const categories = new Set(profiles.map((profile) => profile.category));
  const gaps: string[] = [];
  if (!categories.has("market_data")) {
    gaps.push("No market-data source completed.");
  }
  if (!categories.has("fundamentals")) {
    gaps.push("No fundamentals source completed.");
  }
  if (!categories.has("primary_filings")) {
    gaps.push("No primary filing source completed.");
  }
  if (!categories.has("event_calendar")) {
    gaps.push("No event-calendar source completed.");
  }
  if (!categories.has("company_release")) {
    gaps.push("No company-release or IR-discovery source completed.");
  }
  if (!categories.has("analyst_research")) {
    gaps.push("No analyst research or revision source completed.");
  }
  if (!categories.has("market_positioning")) {
    gaps.push("No options or short-interest positioning source completed.");
  }
  if (!categories.has("news") && !categories.has("news_discovery")) {
    gaps.push("No news source completed.");
  }
  if (!categories.has("fulltext")) {
    gaps.push("No article full-text enrichment completed.");
  }
  if (!categories.has("social")) {
    gaps.push("No social-attention source completed.");
  }
  return gaps;
}
