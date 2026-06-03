import type {
  DeepResearchData,
  DeepResearchTheme,
  DeepResearchPreset,
  DirectionHint,
  EvidencePacket,
  FundamentalSnapshot,
  IntelEventCluster,
  IntelHorizon,
  IntelRawItem,
  ItemDistillation,
  MarketSnapshot,
  RunItemDelta,
  SourceDiagnostic,
  StockConfidence,
  UniverseEntry,
} from "./types.ts";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function eventLabel(value: string) {
  return value.replaceAll("_", " ");
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemText(item: IntelRawItem | undefined) {
  return `${item?.title ?? ""}\n${item?.body ?? ""}`;
}

function themeKeyFor(event: IntelEventCluster, evidence: IntelRawItem[]) {
  const text = normalizeText(
    `${event.title}\n${event.summary}\n${evidence.map(itemText).join("\n")}`,
  );
  if (/\b(earnings|eps|quarter|q[1-4]|results|guidance|outlook)\b/.test(text)) {
    return "earnings_guidance";
  }
  if (
    /\b(upgrade|downgrade|price target|analyst|rating|estimate)\b/.test(text)
  ) {
    return "analyst_estimates";
  }
  if (
    /\b(demand|supply|pricing|inventory|capacity|shortage|margin)\b/.test(text)
  ) {
    return "supply_demand";
  }
  if (/\b(contract|customer|partnership|order|award|deal)\b/.test(text)) {
    return "customer_contracts";
  }
  if (/\b(product|launch|approval|chip|platform|technology)\b/.test(text)) {
    return "products_technology";
  }
  if (
    /\b(lawsuit|probe|investigation|regulator|ban|tariff|sanction|china)\b/.test(
      text,
    )
  ) {
    return "legal_macro_risk";
  }
  if (/\b(reddit|stocktwits|sentiment|social)\b/.test(text)) {
    return "social_sentiment";
  }
  if (
    /\b(volume|premarket|after hours|rallies|jumps|falls|slides|volatility)\b/.test(
      text,
    )
  ) {
    return "market_reaction";
  }
  if (event.eventType === "sec_filing") {
    return "sec_filings";
  }
  return event.eventType;
}

function themeTitle(key: string) {
  const titles: Record<string, string> = {
    earnings_guidance: "Earnings, Guidance, And Estimates",
    analyst_estimates: "Analysts, Ratings, And Price Targets",
    supply_demand: "Supply, Demand, Pricing, And Margins",
    customer_contracts: "Customers, Contracts, And Partnerships",
    products_technology: "Products, Technology, And Roadmap",
    legal_macro_risk: "Legal, Regulatory, Macro, And Policy Risk",
    social_sentiment: "Social Sentiment And Retail Attention",
    market_reaction: "Market Reaction, Volume, And Volatility",
    sec_filings: "SEC Filings And Ownership",
  };
  return titles[key] ?? eventLabel(key);
}

function directionFor(events: IntelEventCluster[]): DirectionHint {
  const counts: Record<DirectionHint, number> = {
    positive: 0,
    negative: 0,
    mixed: 0,
    unknown: 0,
  };
  for (const event of events) {
    counts[event.directionHint] += 1;
  }
  if (counts.mixed > 0 && counts.positive > 0 && counts.negative > 0) {
    return "mixed";
  }
  if (counts.positive > counts.negative && counts.positive > counts.unknown) {
    return "positive";
  }
  if (counts.negative > counts.positive && counts.negative > counts.unknown) {
    return "negative";
  }
  return counts.mixed > 0 ? "mixed" : "unknown";
}

function confidenceFor(score: number, sourceCount: number): StockConfidence {
  if (score >= 75 && sourceCount >= 5) {
    return "high";
  }
  if (score >= 55 && sourceCount >= 2) {
    return "medium";
  }
  return "low";
}

function firstSentences(values: string[], count: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const sentence = value
      .split(/(?<=[.!?])\s+/)
      .find((part) => part.trim().length >= 30)
      ?.trim();
    if (!sentence) {
      continue;
    }
    const normalized = normalizeText(sentence);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(sentence);
    if (result.length >= count) {
      break;
    }
  }
  return result;
}

function keyFactsFor(
  events: IntelEventCluster[],
  rawItems: Map<number, IntelRawItem>,
) {
  const values = events.flatMap((event) => [
    event.summary,
    ...event.evidenceItemIds.map((id) => rawItems.get(id)?.body ?? ""),
  ]);
  const numericFacts = values
    .flatMap(
      (value) =>
        value.match(
          /\b(?:\$?\d+(?:\.\d+)?%?|\d+(?:\.\d+)?\s?(?:billion|million|days?|weeks?|months?|quarters?))\b[^.]{0,120}/gi,
        ) ?? [],
    )
    .map((value) => value.trim())
    .filter((value) => value.length >= 8);
  return firstSentences([...numericFacts, ...values], 5);
}

function buildTheme(
  key: string,
  events: IntelEventCluster[],
  rawItems: Map<number, IntelRawItem>,
  packets: EvidencePacket[],
): DeepResearchTheme {
  const evidenceItemIds = unique(
    events.flatMap((event) => event.evidenceItemIds),
  );
  const sourceCount = unique(
    evidenceItemIds.map((id) => rawItems.get(id)?.source).filter(Boolean),
  ).length;
  const latestPublishedAt = evidenceItemIds
    .map((id) => rawItems.get(id)?.publishedAt)
    .filter((date): date is Date => date instanceof Date)
    .sort((dateA, dateB) => dateB.getTime() - dateA.getTime())[0];
  const topScore = Math.max(...events.map((event) => event.score), 0);
  const score = clamp(
    Math.round(topScore * 0.7) +
      Math.min(18, evidenceItemIds.length * 2) +
      Math.min(12, sourceCount * 3),
    0,
    100,
  );
  const summaries = firstSentences(
    events.map((event) => event.summary),
    3,
  );
  const summary =
    summaries.join(" ") ||
    `${events.length} event cluster${events.length === 1 ? "" : "s"} found in this theme.`;

  return {
    key,
    title: themeTitle(key),
    direction: directionFor(events),
    confidence: confidenceFor(score, sourceCount),
    score,
    summary,
    whyItMatters: `${themeTitle(key)} has ${evidenceItemIds.length} evidence item${
      evidenceItemIds.length === 1 ? "" : "s"
    } from ${sourceCount} source${sourceCount === 1 ? "" : "s"}.`,
    keyFacts: keyFactsFor(events, rawItems),
    evidenceItemIds,
    sourceCount,
    latestPublishedAt,
    packetIds: packets
      .filter((packet) => packet.topic === key)
      .map((packet) => packet.id),
  };
}

function dataQualityNotes(args: {
  rawItemCount: number;
  relevantItemCount: number;
  duplicateItemCount: number;
  noiseRejectedCount: number;
  diagnostics: SourceDiagnostic[];
  market?: MarketSnapshot;
  fundamentals?: FundamentalSnapshot;
}) {
  const notes: string[] = [];
  if (args.rawItemCount < 50) {
    notes.push(
      `Source depth is still thin: ${args.rawItemCount} raw items collected.`,
    );
  }
  if (args.relevantItemCount < args.rawItemCount * 0.35) {
    notes.push(
      `Relevance filter kept ${args.relevantItemCount}/${args.rawItemCount} raw items.`,
    );
  }
  if (args.duplicateItemCount > 0) {
    notes.push(
      `${args.duplicateItemCount} duplicate raw items were collapsed.`,
    );
  }
  if (args.noiseRejectedCount > 0) {
    notes.push(
      `${args.noiseRejectedCount} low-signal items were rejected before synthesis.`,
    );
  }
  const failed = args.diagnostics.filter(
    (diagnostic) => diagnostic.status === "failed",
  );
  if (failed.length > 0) {
    notes.push(
      `${failed.length} source step${failed.length === 1 ? "" : "s"} failed or were unavailable.`,
    );
  }
  if (
    args.diagnostics.some((diagnostic) => diagnostic.message?.includes("429"))
  ) {
    notes.push("At least one source was rate-limited during this run.");
  }
  if (!args.market) {
    notes.push("Market snapshot is missing.");
  }
  if (!args.fundamentals) {
    notes.push("Fundamental snapshot is missing.");
  }
  return notes.length > 0 ? notes : ["No major data-quality warnings."];
}

export function buildDeepResearchData(args: {
  entry: UniverseEntry;
  horizon: IntelHorizon;
  preset: DeepResearchPreset;
  rawItems: IntelRawItem[];
  relevantItemIds: number[];
  duplicateItemCount: number;
  distillations: ItemDistillation[];
  evidencePackets: EvidencePacket[];
  changeSummary?: RunItemDelta;
  events: IntelEventCluster[];
  diagnostics: SourceDiagnostic[];
  market?: MarketSnapshot;
  fundamentals?: FundamentalSnapshot;
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const relevantSet = new Set(args.relevantItemIds);
  const noiseRejectedCount = args.distillations.filter(
    (item) => item.noiseReason,
  ).length;
  const eventsByTheme = new Map<string, IntelEventCluster[]>();
  for (const event of args.events) {
    const evidence = event.evidenceItemIds
      .map((id) => rawById.get(id))
      .filter((item): item is IntelRawItem => item !== undefined);
    const key = themeKeyFor(event, evidence);
    const list = eventsByTheme.get(key) ?? [];
    list.push(event);
    eventsByTheme.set(key, list);
  }

  const themes = [...eventsByTheme.entries()]
    .map(([key, events]) =>
      buildTheme(key, events, rawById, args.evidencePackets),
    )
    .sort((themeA, themeB) => {
      if (themeA.score !== themeB.score) {
        return themeB.score - themeA.score;
      }
      return (
        (themeB.latestPublishedAt?.getTime() ?? 0) -
        (themeA.latestPublishedAt?.getTime() ?? 0)
      );
    });

  return {
    ticker: args.entry.ticker,
    companyName: args.market?.companyName ?? args.entry.name,
    horizon: args.horizon,
    preset: args.preset,
    rawItemCount: args.rawItems.length,
    relevantItemCount: relevantSet.size,
    duplicateItemCount: args.duplicateItemCount,
    noiseRejectedCount,
    sourceCount: unique(args.rawItems.map((item) => item.source)).length,
    evidencePackets: args.evidencePackets,
    changeSummary: args.changeSummary,
    themes,
    diagnostics: args.diagnostics,
    dataQuality: dataQualityNotes({
      rawItemCount: args.rawItems.length,
      relevantItemCount: relevantSet.size,
      duplicateItemCount: args.duplicateItemCount,
      noiseRejectedCount,
      diagnostics: args.diagnostics,
      market: args.market,
      fundamentals: args.fundamentals,
    }),
  } satisfies DeepResearchData;
}
