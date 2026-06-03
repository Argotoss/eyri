import type {
  FundamentalSnapshot,
  IntelEventCluster,
  MarketSnapshot,
  StockConfidence,
  StockIntel,
  UniverseEntry,
} from "./types.ts";

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function eventLabel(event: IntelEventCluster) {
  return event.eventType.replaceAll("_", " ");
}

function dedupeText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function marketScore(snapshot?: MarketSnapshot) {
  if (!snapshot) {
    return 0;
  }

  const move = Math.abs(snapshot.percentChange ?? 0);
  const moveScore =
    move >= 20
      ? 18
      : move >= 12
        ? 15
        : move >= 7
          ? 12
          : move >= 4
            ? 8
            : move >= 2
              ? 5
              : 0;
  const volumeRatio = snapshot.volumeRatio ?? 0;
  const volumeScore =
    volumeRatio >= 3 ? 7 : volumeRatio >= 2 ? 5 : volumeRatio >= 1.4 ? 3 : 0;
  return clamp(moveScore + volumeScore, 0, 25);
}

function relevanceScore(entry?: UniverseEntry) {
  if (!entry) {
    return 0;
  }

  let score = 0;
  if (entry.sources.includes("portfolio")) {
    score += 10;
  }
  if (entry.sources.includes("watchlist")) {
    score += 8;
  }
  if (entry.sources.includes("sp500")) {
    score += 3;
  }
  return clamp(score, 0, 15);
}

function fundamentalScore(fundamentals?: FundamentalSnapshot) {
  if (!fundamentals) {
    return 2;
  }

  let score = 6;
  if ((fundamentals.epsDiluted ?? 0) > 0) {
    score += 4;
  }
  if ((fundamentals.netIncome ?? 0) > 0) {
    score += 3;
  }
  if (
    fundamentals.cash !== undefined &&
    fundamentals.longTermDebt !== undefined &&
    fundamentals.cash >= fundamentals.longTermDebt
  ) {
    score += 2;
  }
  return clamp(score, 0, 15);
}

function catalystScore(events: IntelEventCluster[]) {
  const maxEventScore = Math.max(...events.map((event) => event.score), 0);
  const highValueTypes = events.filter((event) =>
    [
      "earnings",
      "guidance",
      "m_and_a",
      "legal_regulatory",
      "major_contract",
      "supply_chain",
      "unusual_price_volume",
    ].includes(event.eventType),
  ).length;
  const sourceCount = unique(
    events.flatMap((event) => event.evidenceItemIds),
  ).length;
  return clamp(
    Math.round(maxEventScore * 0.32) +
      Math.min(8, highValueTypes * 2) +
      Math.min(8, sourceCount),
    0,
    45,
  );
}

function riskPenalty(events: IntelEventCluster[], snapshot?: MarketSnapshot) {
  let penalty = 0;
  const risks: string[] = [];
  const move = Math.abs(snapshot?.percentChange ?? 0);
  if (move >= 15) {
    penalty += 8;
    risks.push(
      `move already extended at ${formatPercent(snapshot?.percentChange)}`,
    );
  }
  if (events.length === 1 && events[0].sourceCount <= 1) {
    penalty += 7;
    risks.push("single-source catalyst");
  }
  if (
    events.every((event) => event.eventType === "sec_filing") &&
    events.some((event) => /\bform\s*4|\b4\b/i.test(event.title))
  ) {
    penalty += 14;
    risks.push("Form 4 activity is usually weak as a standalone catalyst");
  }
  if (!snapshot) {
    penalty += 6;
    risks.push("missing market reaction data");
  }
  return { penalty: clamp(penalty, 0, 25), risks };
}

function confidenceFor(args: {
  score: number;
  sourceCount: number;
  events: IntelEventCluster[];
  snapshot?: MarketSnapshot;
}) {
  const hasMarketReaction = Math.abs(args.snapshot?.percentChange ?? 0) >= 3;
  const hasStrongCatalyst = args.events.some((event) =>
    ["earnings", "guidance", "m_and_a", "legal_regulatory"].includes(
      event.eventType,
    ),
  );
  if (
    args.score >= 80 &&
    args.sourceCount >= 3 &&
    hasMarketReaction &&
    hasStrongCatalyst
  ) {
    return "high" satisfies StockConfidence;
  }
  if (args.score >= 60 && (args.sourceCount >= 2 || hasMarketReaction)) {
    return "medium" satisfies StockConfidence;
  }
  return "low" satisfies StockConfidence;
}

function buildThesis(
  ticker: string,
  events: IntelEventCluster[],
  snapshot?: MarketSnapshot,
) {
  const summaries = dedupeText(events.map((event) => event.summary)).slice(
    0,
    2,
  );
  const eventTypes = unique(events.map(eventLabel)).slice(0, 3).join(", ");
  const market = snapshot
    ? ` Market reaction is ${formatPercent(snapshot.percentChange)} with ${
        snapshot.volumeRatio ? `${snapshot.volumeRatio.toFixed(1)}x` : "unknown"
      } relative volume.`
    : "";
  return `${ticker} is flagged for ${eventTypes || "fresh catalyst flow"}. ${summaries.join(
    " ",
  )}${market}`
    .replace(/\s+/g, " ")
    .trim();
}

function buildBullCase(events: IntelEventCluster[], snapshot?: MarketSnapshot) {
  const points: string[] = [];
  const highImpactTypes = unique(
    events
      .filter((event) => event.score >= 70)
      .map((event) => eventLabel(event)),
  );
  if (highImpactTypes.length > 0) {
    points.push(`high-impact catalyst mix: ${highImpactTypes.join(", ")}`);
  }
  if ((snapshot?.percentChange ?? 0) > 3) {
    points.push(
      `positive price reaction ${formatPercent(snapshot?.percentChange)}`,
    );
  }
  if ((snapshot?.volumeRatio ?? 0) >= 1.4) {
    points.push(
      `volume confirms attention at ${snapshot?.volumeRatio?.toFixed(1)}x`,
    );
  }
  const sourceCount = unique(
    events.flatMap((event) => event.evidenceItemIds),
  ).length;
  if (sourceCount >= 3) {
    points.push(`${sourceCount} supporting source items`);
  }
  return points.length > 0 ? points : ["no strong bullish confirmation yet"];
}

function buildBearCase(
  events: IntelEventCluster[],
  snapshot?: MarketSnapshot,
  fundamentals?: FundamentalSnapshot,
) {
  const points: string[] = [];
  if ((snapshot?.percentChange ?? 0) < -3) {
    points.push(
      `negative price reaction ${formatPercent(snapshot?.percentChange)}`,
    );
  }
  if (Math.abs(snapshot?.percentChange ?? 0) >= 15) {
    points.push("entry risk is elevated after a large immediate move");
  }
  if (events.some((event) => event.directionHint === "negative")) {
    points.push("some evidence has negative direction");
  }
  if (!fundamentals) {
    points.push("fundamental snapshot unavailable");
  }
  return points.length > 0 ? points : ["main risk is catalyst durability"];
}

function verdictFor(score: number, confidence: StockConfidence) {
  if (score >= 85 && confidence === "high") {
    return "Hot catalyst, high confidence";
  }
  if (score >= 75) {
    return "Actionable catalyst, verify timing";
  }
  if (score >= 60) {
    return "Watch closely, medium confidence";
  }
  return "Low confidence / insufficient edge";
}

export function buildStockIntel(args: {
  events: IntelEventCluster[];
  universe: UniverseEntry[];
  snapshots: MarketSnapshot[];
  fundamentals: FundamentalSnapshot[];
}) {
  const universeByTicker = new Map(
    args.universe.map((entry) => [entry.ticker, entry]),
  );
  const snapshotsByTicker = new Map(
    args.snapshots.map((snapshot) => [snapshot.ticker, snapshot]),
  );
  const fundamentalsByTicker = new Map(
    args.fundamentals.map((snapshot) => [snapshot.ticker, snapshot]),
  );
  const eventsByTicker = new Map<string, IntelEventCluster[]>();
  for (const event of args.events) {
    const list = eventsByTicker.get(event.ticker) ?? [];
    list.push(event);
    eventsByTicker.set(event.ticker, list);
  }

  const stocks: StockIntel[] = [];
  for (const [ticker, events] of eventsByTicker.entries()) {
    const sortedEvents = [...events].sort((eventA, eventB) => {
      if (eventA.score !== eventB.score) {
        return eventB.score - eventA.score;
      }
      return (
        eventB.latestPublishedAt.getTime() - eventA.latestPublishedAt.getTime()
      );
    });
    const universeEntry = universeByTicker.get(ticker);
    const market = snapshotsByTicker.get(ticker);
    const fundamentals = fundamentalsByTicker.get(ticker);
    const risk = riskPenalty(sortedEvents, market);
    const breakdown = {
      catalyst: catalystScore(sortedEvents),
      market: marketScore(market),
      relevance: relevanceScore(universeEntry),
      fundamentals: fundamentalScore(fundamentals),
      riskPenalty: risk.penalty,
    };
    const sourceCount = unique(
      sortedEvents.flatMap((event) => event.evidenceItemIds),
    ).length;
    const score = clamp(
      breakdown.catalyst +
        breakdown.market +
        breakdown.relevance +
        breakdown.fundamentals -
        breakdown.riskPenalty,
      0,
      100,
    );
    const confidence = confidenceFor({
      score,
      sourceCount,
      events: sortedEvents,
      snapshot: market,
    });
    stocks.push({
      ticker,
      companyName:
        market?.companyName ??
        universeEntry?.name ??
        fundamentals?.ticker ??
        ticker,
      sector: universeEntry?.sector,
      sources: universeEntry?.sources ?? [],
      score,
      confidence,
      verdict: verdictFor(score, confidence),
      thesis: buildThesis(ticker, sortedEvents, market),
      bullCase: buildBullCase(sortedEvents, market),
      bearCase: buildBearCase(sortedEvents, market, fundamentals),
      risks: unique([
        ...risk.risks,
        ...sortedEvents
          .filter((event) => event.confidence < 0.75)
          .map(() => "low extraction confidence on some evidence"),
      ]),
      scoreBreakdown: breakdown,
      market,
      fundamentals,
      events: sortedEvents,
      evidenceItemIds: unique(
        sortedEvents.flatMap((event) => event.evidenceItemIds),
      ),
      sourceCount,
      latestPublishedAt: sortedEvents
        .map((event) => event.latestPublishedAt)
        .sort((dateA, dateB) => dateB.getTime() - dateA.getTime())[0],
    });
  }

  return stocks.sort((stockA, stockB) => {
    if (stockA.score !== stockB.score) {
      return stockB.score - stockA.score;
    }
    return (
      (stockB.latestPublishedAt?.getTime() ?? 0) -
      (stockA.latestPublishedAt?.getTime() ?? 0)
    );
  });
}
