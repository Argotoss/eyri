import { buildIntelReport, intelReportFileName } from "./report.ts";
import type {
  IntelEventCluster,
  IntelRawItem,
  MarketSnapshot,
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
        fetchedAt: now,
      },
    ];

    const report = await buildIntelReport({
      horizon: "1d",
      universe,
      universeSummary: "watchlist 1",
      rawItems,
      events,
      snapshots,
    });

    assert(report.telegramSummary.includes("MU"), "summary should include MU");
    assert(
      report.html.includes("Micron raises guidance"),
      "HTML should include event",
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
