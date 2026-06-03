import { buildDeepResearchData } from "./deep_research.ts";
import { buildEvidencePackets, buildItemDistillations } from "./distill.ts";
import type {
  IntelEventCluster,
  IntelRawItem,
  SourceDiagnostic,
  TickerMention,
  UniverseEntry,
} from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("buildDeepResearchData aggregates stock evidence into themes", () => {
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
      title: "Micron demand improves as memory pricing rises",
      publishedAt: now,
      fetchedAt: now,
      body: "Memory pricing rose 12% and demand improved.",
      rawHash: "1",
    },
    {
      id: 2,
      source: "alpaca_news",
      sourceType: "news",
      sourceId: "2",
      title: "Analyst lifts Micron price target",
      publishedAt: now,
      fetchedAt: now,
      body: "Analyst raised price target to $120.",
      rawHash: "2",
    },
  ];
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
    {
      ticker: "MU",
      eventType: "analyst_action",
      directionHint: "positive",
      urgency: "medium",
      horizon: "1d",
      title: "Analyst lifts target",
      summary: "Analyst raised price target to $120.",
      evidenceItemIds: [2],
      confidence: 0.86,
      clusterKey: "MU:analyst",
      sourceCount: 1,
      latestPublishedAt: now,
      score: 72,
      scoreReasons: ["analyst action"],
    },
  ];
  const diagnostics: SourceDiagnostic[] = [
    {
      source: "test",
      label: "test",
      status: "ok",
      itemCount: 2,
      startedAt: now,
      completedAt: now,
    },
  ];
  const mentions: TickerMention[] = rawItems.map((item) => ({
    rawItemId: item.id,
    ticker: "MU",
    confidence: 0.98,
    method: "source",
  }));
  const distillations = buildItemDistillations({
    rawItems,
    mentions,
    entry,
    horizon: "1d",
  });
  const evidencePackets = buildEvidencePackets({
    ticker: "MU",
    distillations,
    rawItems,
  });

  const research = buildDeepResearchData({
    entry,
    horizon: "1d",
    preset: "deep",
    rawItems,
    relevantItemIds: [1, 2],
    duplicateItemCount: 0,
    distillations,
    evidencePackets,
    events,
    diagnostics,
  });

  assert(research.evidencePackets.length > 0, "expected evidence packets");
  assert(research.signalCounts.high > 0, "expected high-signal items");
  assert(research.topSignals.length > 0, "expected top signal summaries");
  assert(research.themes.length === 2, "expected two themes");
  assert(
    research.themes.some((theme) => theme.key === "supply_demand"),
    "expected supply-demand theme",
  );
  assert(
    research.themes.some((theme) => theme.key === "analyst_estimates"),
    "expected analyst theme",
  );
});
