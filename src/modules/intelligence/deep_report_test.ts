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
      signalCounts: {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
        noise: 0,
      },
      topSignals: [
        {
          rawItemId: 1,
          title: "Micron demand improves",
          source: "finnhub_news",
          topic: "supply_demand",
          signalTier: "high",
          signalScore: 78,
          signalReasons: ["strong catalyst language", "high-quality source"],
          summary: "Memory pricing improved.",
        },
      ],
      sourceCount: 1,
      evidencePackets: [
        {
          id: "MU:supply_demand",
          ticker: "MU",
          topic: "supply_demand",
          title: "Supply, Demand, Pricing, And Margins",
          direction: "positive",
          score: 78,
          evidenceBreadthScore: 36,
          riskSeverity: 8,
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
      changeSummary: {
        previousRunId: 3,
        currentItemCount: 1,
        previousItemCount: 1,
        newItemCount: 1,
        reusedItemCount: 0,
        cacheNewItemCount: 1,
        droppedItemCount: 1,
        newItems: [rawItems[0]],
        droppedItems: [
          {
            ...rawItems[0],
            id: 2,
            title: "Older Micron headline",
            rawHash: "2",
          },
        ],
        newSources: ["finnhub_news"],
        droppedSources: ["google_news"],
      },
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
      previousReportId: 9,
      previousEvaluatorPacket: {
        verdict: { score: 70 },
        actionReadiness: { score: 55 },
        evidenceBalance: { overallDirection: "negative" },
      },
    });

    assert(
      report.telegramSummary.includes("Deep Intel MU"),
      "expected summary",
    );
    assert(report.html.includes("Deep Intel MU"), "expected title");
    assert(
      report.telegramSummary.includes("Setup:"),
      "expected compact setup line",
    );
    assert(
      report.telegramSummary.includes("Readiness:"),
      "expected readiness summary",
    );
    assert(
      report.telegramSummary.includes("Invalidation:"),
      "expected invalidation summary",
    );
    assert(
      report.telegramSummary.includes("Changes: 1 new"),
      "expected change summary",
    );
    assert(
      report.telegramSummary.includes("Signals:"),
      "expected signal summary",
    );
    assert(
      report.html.includes("Decision Dossier"),
      "expected decision dossier",
    );
    assert(report.html.includes("Action Readiness"), "expected readiness");
    assert(report.html.includes("Evidence Balance"), "expected balance");
    assert(report.html.includes("Dossier Delta"), "expected dossier delta");
    assert(report.html.includes("Time Window"), "expected time window section");
    assert(
      report.html.includes("Invalidation / Risks"),
      "expected invalidation section",
    );
    assert(report.html.includes("Missing Data"), "expected missing data");
    assert(
      report.html.includes("Changed Since Previous Report"),
      "expected change section",
    );
    assert(report.html.includes("New Items"), "expected new items section");
    assert(report.html.includes("Source Coverage"), "expected source coverage");
    assert(report.html.includes("Source Quality"), "expected source quality");
    assert(report.html.includes("Signal Filter"), "expected signal filter");
    assert(
      report.html.includes("Finnhub News"),
      "expected source display name",
    );
    assert(report.html.includes("Source Diagnostics"), "expected diagnostics");
    assert(report.html.includes("Source Appendix"), "expected source appendix");
    assert(report.evaluatorPacket?.ticker === "MU", "expected packet ticker");
    assert(
      report.evaluatorPacket?.actionReadiness.score !== undefined,
      "expected evaluator readiness",
    );
    assert(
      report.evaluatorPacket?.evidenceBalance.overallDirection === "positive",
      "expected evaluator evidence balance",
    );
    assert(
      report.evaluatorPacket?.dossierDelta?.directionChanged === true,
      "expected evaluator dossier delta",
    );
    assert(
      report.evaluatorPacket?.sourceCoverage.some(
        (row) => row.category === "news" && row.rawItemCount === 1,
      ),
      "expected evaluator source coverage",
    );
    assert(
      report.evaluatorPacket?.evidencePackets[0]?.evidenceBreadthScore === 36,
      "expected packet breadth in evaluator packet",
    );
    assert(
      report.evaluatorPacket?.evidencePackets[0]?.riskSeverity === 8,
      "expected packet risk in evaluator packet",
    );
    assert(
      report.evaluatorPacket?.evidencePackets[0]?.evidence[0]?.rawItemId === 1,
      "expected packet evidence item",
    );
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
