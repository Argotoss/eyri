import { buildEvidencePackets, buildItemDistillations } from "./distill.ts";
import type { IntelRawItem, TickerMention, UniverseEntry } from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("distillation ranks relevant catalyst evidence and rejects noise", () => {
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
      source: "alpaca_news",
      sourceType: "news",
      sourceId: "1",
      title: "Micron demand improves as memory pricing rises",
      publishedAt: now,
      fetchedAt: now,
      body: "Micron Technology demand improved as memory pricing rose 12% and analysts raised near-term margin expectations.",
      rawHash: "1",
    },
    {
      id: 2,
      source: "stocktwits",
      sourceType: "social",
      sourceId: "2",
      title: "Random trader likes another chip stock",
      publishedAt: now,
      fetchedAt: now,
      body: "A trader posted general market chatter without mentioning Micron.",
      rawHash: "2",
    },
  ];
  const mentions: TickerMention[] = [
    {
      rawItemId: 1,
      ticker: "MU",
      confidence: 0.98,
      method: "source",
    },
  ];

  const distillations = buildItemDistillations({
    rawItems,
    mentions,
    entry,
    horizon: "1d",
  });
  const packets = buildEvidencePackets({
    ticker: "MU",
    distillations,
    rawItems,
  });

  assert(
    distillations.some((item) => item.rawItemId === 2 && item.noiseReason),
    "expected unrelated item to be rejected as noise",
  );
  assert(
    distillations.some(
      (item) => item.rawItemId === 1 && item.signalTier === "high",
    ),
    "expected catalyst evidence to be high signal",
  );
  assert(
    distillations.every((item) => item.signalReasons.length > 0),
    "expected signal reasons",
  );
  assert(packets.length === 1, "expected one signal packet");
  assert(packets[0].topic === "supply_demand", "expected supply/demand packet");
  assert(packets[0].evidenceItemIds.includes(1), "expected signal evidence");
});
