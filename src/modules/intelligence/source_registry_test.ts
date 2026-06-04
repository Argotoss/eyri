import {
  getSourceProfile,
  sourceCoverageGaps,
  sourceQualityScore,
} from "./source_registry.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("source registry exposes quality and metadata", () => {
  const sec = getSourceProfile("sec");
  const stocktwits = getSourceProfile("stocktwits");
  const unknown = getSourceProfile("custom_feed");

  assert(sec.reliability === "primary", "SEC should be primary");
  assert(sec.qualityScore > stocktwits.qualityScore, "primary beats social");
  assert(sourceQualityScore("alpaca_news") >= 80, "expected API news quality");
  assert(
    sourceQualityScore("finnhub_earnings_calendar") >= 80,
    "expected earnings calendar quality",
  );
  assert(
    sourceQualityScore("company_releases") >= 75,
    "expected company release discovery quality",
  );
  assert(
    sourceQualityScore("finnhub_upgrade_downgrade") >= 80,
    "expected analyst revision quality",
  );
  assert(
    sourceQualityScore("yahoo_chart") >= 80,
    "expected chart context quality",
  );
  assert(
    sourceQualityScore("nasdaq_short_interest") >= 80,
    "expected short-interest quality",
  );
  assert(
    getSourceProfile("nasdaq_options").category === "market_positioning",
    "expected positioning category",
  );
  assert(
    getSourceProfile("finnhub_price_target").category === "analyst_research",
    "expected analyst category",
  );
  assert(unknown.category === "unknown", "unknown sources get fallback");
});

Deno.test("source registry reports coverage gaps", () => {
  const gaps = sourceCoverageGaps({
    rawSources: ["google_news", "stocktwits"],
    diagnosticSources: ["prices"],
  });

  assert(
    gaps.includes("No fundamentals source completed."),
    "expected fundamentals gap",
  );
  assert(
    gaps.includes("No primary filing source completed."),
    "expected primary filing gap",
  );
  assert(
    !gaps.includes("No market-data source completed."),
    "prices should satisfy market data",
  );
});
