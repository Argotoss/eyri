import { buildIntelReport, intelReportFileName } from "./report.ts";
import type {
  IntelEventCluster,
  IntelRawItem,
  MarketSnapshot,
  StockIntel,
  UniverseEntry,
} from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("buildIntelReport creates telegram summary and readable HTML", async () => {
  const previousKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.delete("OPENROUTER_API_KEY");
  try {
    const now = new Date();
    const rawItems: IntelRawItem[] = [
      {
        id: 1,
        source: "gdelt",
        sourceType: "news",
        sourceId: "https://example.com/mu",
        title: "Micron raises guidance",
        url: "https://example.com/mu",
        publishedAt: now,
        fetchedAt: now,
        rawHash: "hash",
      },
    ];
    const events: IntelEventCluster[] = [
      {
        ticker: "MU",
        eventType: "guidance",
        directionHint: "positive",
        urgency: "high",
        horizon: "1d",
        title: "Micron raises guidance",
        summary: "Micron raised guidance on memory pricing.",
        evidenceItemIds: [1],
        confidence: 0.9,
        clusterKey: "MU:guidance:micron",
        sourceCount: 1,
        latestPublishedAt: now,
        score: 91,
        scoreReasons: ["guidance", "watchlist"],
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
        dayHigh: 112,
        dayLow: 98,
        fiftyTwoWeekHigh: 140,
        fiftyTwoWeekLow: 72,
        volume: 50_000_000,
        averageVolume: 25_000_000,
        volumeRatio: 2,
        companyName: "Micron Technology",
        fetchedAt: now,
      },
    ];
    const stocks: StockIntel[] = [
      {
        ticker: "MU",
        companyName: "Micron Technology",
        sources: ["watchlist"],
        score: 84,
        confidence: "medium",
        verdict: "Actionable catalyst, verify timing",
        thesis:
          "MU is flagged for guidance. Micron raised guidance on memory pricing.",
        bullCase: ["guidance improved", "positive price reaction +10.0%"],
        bearCase: ["entry risk after immediate move"],
        risks: ["single-source catalyst"],
        scoreBreakdown: {
          catalyst: 42,
          market: 20,
          relevance: 8,
          fundamentals: 12,
          riskPenalty: 0,
        },
        market: snapshots[0],
        fundamentals: {
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
        events,
        evidenceItemIds: [1],
        sourceCount: 1,
        latestPublishedAt: now,
      },
    ];

    const report = await buildIntelReport({
      horizon: "1d",
      universe,
      universeSummary: "watchlist 1",
      rawItems,
      events,
      stocks,
      snapshots,
    });

    assert(report.telegramSummary.includes("MU"), "summary should include MU");
    assert(
      report.telegramSummary.includes("Actionable catalyst"),
      "summary should include stock verdict",
    );
    assert(report.stocks.length === 1, "report should keep stock dossiers");
    assert(
      report.html.includes("Top Stock Setups"),
      "HTML should include stock table",
    );
    assert(
      report.html.includes("Micron Technology"),
      "HTML should include company name",
    );
    assert(report.html.includes("Forward P/E"), "HTML should include metrics");
    assert(
      report.html.includes("Micron raises guidance"),
      "HTML should include catalyst evidence",
    );
    assert(
      report.html.includes("https://example.com/mu"),
      "HTML should include link",
    );
    assert(
      intelReportFileName(report).startsWith("market-intel-1d-"),
      "expected report file name",
    );
  } finally {
    if (previousKey) {
      Deno.env.set("OPENROUTER_API_KEY", previousKey);
    }
  }
});
