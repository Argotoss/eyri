import { clusterEvents } from "./dedupe.ts";
import { rankEvents } from "./score.ts";
import { buildStockIntel } from "./stock.ts";
import type {
  FundamentalSnapshot,
  IntelEventCandidate,
  IntelRawItem,
  MarketSnapshot,
  UniverseEntry,
} from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const now = new Date();

const rawItems: IntelRawItem[] = [
  {
    id: 1,
    source: "gdelt",
    sourceType: "news",
    sourceId: "a",
    title: "Micron raises guidance on memory pricing",
    publishedAt: now,
    fetchedAt: now,
    rawHash: "a",
  },
  {
    id: 2,
    source: "sec",
    sourceType: "sec_filing",
    sourceId: "b",
    title: "MU 8-K - guidance update",
    publishedAt: now,
    fetchedAt: now,
    rawHash: "b",
  },
];

const events: IntelEventCandidate[] = [
  {
    ticker: "MU",
    eventType: "guidance",
    directionHint: "positive",
    urgency: "high",
    horizon: "1d",
    title: "Micron raises guidance on memory pricing",
    summary: "Micron raised guidance.",
    evidenceItemIds: [1],
    confidence: 0.8,
  },
  {
    ticker: "MU",
    eventType: "guidance",
    directionHint: "positive",
    urgency: "medium",
    horizon: "1d",
    title: "Micron raises guidance on memory pricing",
    summary: "Micron filed an update confirming guidance.",
    evidenceItemIds: [2],
    confidence: 0.9,
  },
];

const universe: UniverseEntry[] = [
  {
    ticker: "MU",
    name: "Micron",
    aliases: ["Micron Technology"],
    sources: ["watchlist"],
    priority: 85,
  },
];

const snapshots: MarketSnapshot[] = [
  {
    ticker: "MU",
    horizon: "1d",
    price: 110,
    previousPrice: 100,
    percentChange: 10,
    volumeRatio: 2.5,
    fetchedAt: now,
  },
];

Deno.test("clusterEvents merges duplicate catalyst evidence", () => {
  const clusters = clusterEvents(events, rawItems);

  assert(clusters.length === 1, "expected one cluster");
  assert(clusters[0].sourceCount === 2, "expected merged evidence");
});

Deno.test("rankEvents boosts watchlist names with strong market reaction", () => {
  const ranked = rankEvents(
    clusterEvents(events, rawItems),
    universe,
    snapshots,
  );

  assert(ranked[0].score >= 80, `expected hot score, got ${ranked[0].score}`);
  assert(
    ranked[0].scoreReasons.includes("watchlist"),
    "expected watchlist reason",
  );
});

Deno.test("buildStockIntel aggregates ranked catalysts into stock dossiers", () => {
  const ranked = rankEvents(
    clusterEvents(events, rawItems),
    universe,
    snapshots,
  );
  const fundamentals: FundamentalSnapshot[] = [
    {
      ticker: "MU",
      source: "sec_companyfacts",
      fetchedAt: now,
      fiscalYear: 2025,
      fiscalPeriod: "FY",
      revenue: 25_000_000_000,
      netIncome: 3_000_000_000,
      epsDiluted: 8,
      estimatedPe: 13.75,
      cash: 8_000_000_000,
      longTermDebt: 10_000_000_000,
    },
  ];

  const stocks = buildStockIntel({
    events: ranked,
    universe,
    snapshots,
    fundamentals,
  });

  assert(stocks.length === 1, "expected one stock dossier");
  assert(stocks[0].ticker === "MU", "expected MU stock dossier");
  assert(stocks[0].evidenceItemIds.length === 2, "expected merged evidence");
  assert(
    stocks[0].score >= 70,
    `expected usable score, got ${stocks[0].score}`,
  );
});
