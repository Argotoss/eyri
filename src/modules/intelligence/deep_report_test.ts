import { buildDeepIntelReport } from "./deep_report.ts";
import { intelReportFileName } from "./report.ts";
import type {
  DeepResearchData,
  IntelEventCluster,
  IntelRawItem,
  MarketSnapshot,
  SourceDiagnostic,
  StockIntel,
  UniverseEntry,
} from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("buildDeepIntelReport renders stock research report", async () => {
  const previousKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.delete("OPENROUTER_API_KEY");
  try {
    const now = new Date();
    const entry: UniverseEntry = {
      ticker: "MU",
      name: "Micron Technology",
      aliases: ["Micron"],
      sources: ["target"],
      priority: 100,
    };
    const rawItems: IntelRawItem[] = [
      {
        id: 1,
        source: "finnhub_news",
        sourceType: "news",
        sourceId: "1",
        title: "Micron demand improves",
        url: "https://example.com/mu",
        publishedAt: now,
        fetchedAt: now,
        body: "Memory pricing rose 12% and demand improved.",
        rawHash: "1",
      },
    ];
    const market: MarketSnapshot = {
      ticker: "MU",
      horizon: "1d",
      price: 100,
      previousPrice: 90,
      percentChange: 11.1,
      fetchedAt: now,
    };
    const events: IntelEventCluster[] = [
      {
        ticker: "MU",
        eventType: "supply_chain",
        directionHint: "positive",
        urgency: "high",
        horizon: "1d",
        title: "Memory pricing rises",
        summary: "Memory pricing rose 12% and demand improved.",
        evidenceItemIds: [1],
        confidence: 0.9,
        clusterKey: "MU:supply",
        sourceCount: 1,
        latestPublishedAt: now,
        score: 82,
        scoreReasons: ["supply chain"],
      },
    ];
    const stock: StockIntel = {
      ticker: "MU",
      companyName: "Micron Technology",
      sources: ["target"],
      score: 76,
      confidence: "medium",
      verdict: "Actionable catalyst, verify timing",
      thesis: "MU is flagged for memory pricing.",
      bullCase: ["memory pricing improved"],
      bearCase: ["move may be priced in"],
      risks: [],
      scoreBreakdown: {
        catalyst: 38,
        market: 15,
        relevance: 10,
        fundamentals: 8,
        riskPenalty: 0,
      },
      market,
      events,
      evidenceItemIds: [1],
      sourceCount: 1,
      latestPublishedAt: now,
    };
    const diagnostics: SourceDiagnostic[] = [
      {
        source: "finnhub",
        label: "ticker-news:MU",
        status: "ok",
        itemCount: 1,
        startedAt: now,
        completedAt: now,
      },
    ];
    const research: DeepResearchData = {
      ticker: "MU",
      companyName: "Micron Technology",
      horizon: "1d",
      preset: "deep",
      rawItemCount: 1,
      relevantItemCount: 1,
      duplicateItemCount: 0,
      noiseRejectedCount: 0,
      sourceCount: 1,
      evidencePackets: [
        {
          id: "MU:supply_demand",
          ticker: "MU",
          topic: "supply_demand",
          title: "Supply, Demand, Pricing, And Margins",
          direction: "positive",
          score: 78,
          confidence: "low",
          summary: "Memory pricing improved.",
          conclusion:
            "Supply, Demand, Pricing, And Margins is a strong evidence cluster worth evaluator attention.",
          whyItMatters:
            "Concrete catalyst or market signal with potential short-term relevance.",
          keyFacts: ["Memory pricing rose 12%."],
          evidenceItemIds: [1],
          sourceCount: 1,
          noiseRejectedCount: 0,
        },
      ],
      themes: [
        {
          key: "supply_demand",
          title: "Supply, Demand, Pricing, And Margins",
          direction: "positive",
          confidence: "medium",
          score: 75,
          summary: "Memory pricing improved.",
          whyItMatters: "Evidence came from one source.",
          keyFacts: ["Memory pricing rose 12%."],
          evidenceItemIds: [1],
          sourceCount: 1,
          latestPublishedAt: now,
        },
      ],
      diagnostics,
      dataQuality: ["No major data-quality warnings."],
    };

    const report = await buildDeepIntelReport({
      entry,
      horizon: "1d",
      rawItems,
      relevantItemIds: [1],
      events,
      stock,
      research,
    });

    assert(
      report.telegramSummary.includes("Deep Intel MU"),
      "expected summary",
    );
    assert(report.html.includes("Deep Intel MU"), "expected title");
    assert(report.html.includes("Source Diagnostics"), "expected diagnostics");
    assert(report.html.includes("Source Appendix"), "expected source appendix");
    assert(
      intelReportFileName(report).startsWith("deep-intel-MU-1d-"),
      "expected deep filename",
    );
  } finally {
    if (previousKey) {
      Deno.env.set("OPENROUTER_API_KEY", previousKey);
    }
  }
});
