import type {
  DeepResearchData,
  DeepResearchTheme,
  DirectionHint,
  EvaluatorPacket,
  FundamentalSnapshot,
  IntelEventCluster,
  IntelHorizon,
  IntelRawItem,
  IntelReport,
  MarketSnapshot,
  SourceDiagnostic,
  StockIntel,
  UniverseEntry,
} from "./types.ts";
import { recordModelUsage } from "./model_usage.ts";
import {
  getSourceProfile,
  sourceCoverageGaps,
  sourceDisplayName,
} from "./source_registry.ts";

type DeepNarrative = {
  executiveSummary?: unknown;
  thesis?: unknown;
  themeNotes?: unknown;
};

type DecisionDossier = {
  setupType: string;
  timeWindow: string;
  catalystClock: string;
  edgeSummary: string;
  topCatalysts: string[];
  invalidation: string[];
  missingData: string[];
  humanChecks: string[];
};

type ActionReadiness = {
  label: string;
  score: number;
  freshnessScore: number;
  corroborationScore: number;
  marketConfirmationScore: number;
  dataCompletenessScore: number;
  reasons: string[];
  blockers: string[];
  nextChecks: string[];
};

type EvidenceBalance = EvaluatorPacket["evidenceBalance"];
type DossierDelta = NonNullable<EvaluatorPacket["dossierDelta"]>;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatMoney(value?: number, digits = 2) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  return `$${value.toFixed(digits)}`;
}

function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(2);
}

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAge(date: Date, now: Date) {
  const minutes = Math.max(0, (now.getTime() - date.getTime()) / 60_000);
  if (minutes < 90) {
    return `${Math.round(minutes)}m ago`;
  }
  const hours = minutes / 60;
  if (hours < 48) {
    return `${hours.toFixed(1)}h ago`;
  }
  return `${(hours / 24).toFixed(1)}d ago`;
}

function sourceTimeLabel(item: IntelRawItem) {
  const now = new Date();
  if (
    item.source === "gdelt" &&
    item.discoveredAt &&
    item.discoveredAt.getTime() === item.publishedAt.getTime()
  ) {
    return `seen by GDELT ${formatAge(item.discoveredAt, now)}`;
  }
  if (item.discoveredAt) {
    return `published ${formatAge(item.publishedAt, now)}; seen ${formatAge(item.discoveredAt, now)}`;
  }
  return `published ${formatAge(item.publishedAt, now)}`;
}

function modelName() {
  return (
    Deno.env.get("INTEL_DEEP_REPORT_MODEL")?.trim() ||
    Deno.env.get("INTEL_REPORT_MODEL")?.trim() ||
    "openai/gpt-5.4-mini"
  );
}

function parseJsonObject(value: string): DeepNarrative | null {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as DeepNarrative;
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[0]) as DeepNarrative;
    } catch {
      return null;
    }
  }
}

function compactEvidence(
  theme: DeepResearchTheme,
  rawById: Map<number, IntelRawItem>,
) {
  return theme.evidenceItemIds.slice(0, 12).map((id) => {
    const item = rawById.get(id);
    return item
      ? {
          id,
          source: item.source,
          title: item.title,
          publishedAt: item.publishedAt.toISOString(),
          text: `${item.title}\n${item.body ?? ""}`.slice(0, 900),
        }
      : { id };
  });
}

async function callDeepNarrativeModel(args: {
  horizon: IntelHorizon;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
}) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return null;
  }

  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const payload = {
    horizon: args.horizon,
    stock: {
      ticker: args.stock.ticker,
      companyName: args.stock.companyName,
      score: args.stock.score,
      confidence: args.stock.confidence,
      verdict: args.stock.verdict,
      market: args.stock.market,
      fundamentals: args.stock.fundamentals,
    },
    sourceDepth: {
      rawItemCount: args.research.rawItemCount,
      relevantItemCount: args.research.relevantItemCount,
      sourceCount: args.research.sourceCount,
      dataQuality: args.research.dataQuality,
    },
    themes: args.research.themes.slice(0, 10).map((theme) => ({
      title: theme.title,
      direction: theme.direction,
      confidence: theme.confidence,
      score: theme.score,
      summary: theme.summary,
      keyFacts: theme.keyFacts,
      evidence: compactEvidence(theme, rawById),
    })),
  };

  try {
    const model = modelName();
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Argotoss/eyri",
          "X-Title": "Eyri Deep Market Intelligence",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You write deep stock research for a human trader. Return strict JSON with executiveSummary, thesis, and themeNotes keyed by theme title. Be specific, concise, and evidence-grounded. Do not issue buy/sell orders.",
            },
            { role: "user", content: JSON.stringify(payload) },
          ],
          temperature: 0.15,
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      },
    );
    if (!response.ok) {
      console.error(`OpenRouter deep report failed ${response.status}`);
      return null;
    }
    const data = await response.json();
    recordModelUsage({ stage: "deep_report", model, usage: data?.usage });
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? parseJsonObject(content) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function fallbackExecutiveSummary(
  stock: StockIntel,
  research: DeepResearchData,
) {
  const topPackets = research.evidencePackets
    .slice(0, 3)
    .map(
      (packet) => `${packet.title} (${packet.score}/100, ${packet.direction})`,
    )
    .join("; ");
  return `${stock.ticker} deep scan collected ${research.rawItemCount} raw items, kept ${research.relevantItemCount} relevant items, rejected ${research.noiseRejectedCount} low-signal items, and produced ${research.evidencePackets.length} evidence packets. Top evidence: ${topPackets || "none"}.`;
}

function timeWindowFor(
  horizon: IntelHorizon,
  confidence: StockIntel["confidence"],
) {
  if (confidence === "low") {
    return "monitor until stronger confirmation";
  }
  if (horizon === "1d") {
    return "1-3 trading days";
  }
  if (horizon === "3d") {
    return "3-7 trading days";
  }
  return "1-2 weeks";
}

function setupTypeFor(stock: StockIntel, research: DeepResearchData) {
  const topPacket = research.evidencePackets[0];
  if (!topPacket || stock.score < 55 || stock.confidence === "low") {
    return "low-conviction monitor";
  }
  if (topPacket.direction === "negative") {
    return "downside catalyst / risk watch";
  }
  if (topPacket.direction === "mixed") {
    return "mixed catalyst requiring confirmation";
  }
  if (
    stock.market?.percentChange !== undefined &&
    Math.abs(stock.market.percentChange) >= 6 &&
    stock.score >= 65
  ) {
    return "momentum plus catalyst watch";
  }

  const topicSetups: Record<string, string> = {
    earnings_guidance: "earnings / guidance catalyst",
    analyst_estimates: "analyst revision catalyst",
    supply_demand: "supply-demand catalyst",
    customer_contracts: "customer / contract catalyst",
    products_technology: "product / technology catalyst",
    legal_macro_risk: "legal or macro risk catalyst",
    social_sentiment: "social attention watch",
    market_reaction: "market reaction catalyst",
    sec_filings: "filing-driven watch",
  };
  return topicSetups[topPacket.topic] ?? "catalyst watch";
}

function latestEvidenceDate(
  research: DeepResearchData,
  rawById: Map<number, IntelRawItem>,
) {
  return research.evidencePackets
    .flatMap((packet) => packet.evidenceItemIds)
    .map((id) => rawById.get(id)?.publishedAt)
    .filter((date): date is Date => date instanceof Date)
    .sort((dateA, dateB) => dateB.getTime() - dateA.getTime())[0];
}

function horizonFreshHours(horizon: IntelHorizon) {
  if (horizon === "1d") {
    return 24;
  }
  if (horizon === "3d") {
    return 72;
  }
  return 336;
}

function buildActionReadiness(args: {
  horizon: IntelHorizon;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
  dossier: DecisionDossier;
}): ActionReadiness {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const latest = latestEvidenceDate(args.research, rawById);
  const ageHours = latest
    ? Math.max(0, (Date.now() - latest.getTime()) / 3_600_000)
    : Number.POSITIVE_INFINITY;
  const freshHours = horizonFreshHours(args.horizon);
  const freshnessScore = Number.isFinite(ageHours)
    ? clamp(Math.round(100 - (ageHours / freshHours) * 70), 10, 100)
    : 0;

  const coverage = buildSourceCoverage(
    args.rawItems,
    args.research.diagnostics,
  );
  const categoriesWithItems = coverage.filter((row) => row.rawItemCount > 0);
  const categoryCount = categoriesWithItems.length;
  const highSignalCount =
    args.research.signalCounts.critical + args.research.signalCounts.high;
  const topPacket = args.research.evidencePackets[0];
  const corroborationScore = clamp(
    Math.round(
      (topPacket?.sourceCount ?? 0) * 16 +
        Math.min(args.research.evidencePackets.length, 5) * 8 +
        Math.min(highSignalCount, 8) * 5 +
        Math.min(categoryCount, 8) * 4,
    ),
    0,
    100,
  );

  const move = Math.abs(args.stock.market?.percentChange ?? 0);
  const volumeRatio = args.stock.market?.volumeRatio ?? 0;
  const marketConfirmationScore = clamp(
    Math.round(
      Math.min(move, 12) * 5 +
        Math.min(volumeRatio, 3) * 18 +
        (args.stock.market?.price ? 10 : 0),
    ),
    0,
    100,
  );

  const failedSteps = args.research.diagnostics.filter(
    (diagnostic) => diagnostic.status === "failed",
  ).length;
  const partialSteps = args.research.diagnostics.filter(
    (diagnostic) => diagnostic.status === "partial",
  ).length;
  const dataCompletenessScore = clamp(
    Math.round(
      100 -
        failedSteps * 12 -
        partialSteps * 5 -
        Math.max(0, 6 - categoryCount) * 6 -
        (args.stock.market ? 0 : 20) -
        (args.stock.fundamentals ? 0 : 15),
    ),
    0,
    100,
  );

  const score = clamp(
    Math.round(
      freshnessScore * 0.24 +
        corroborationScore * 0.34 +
        marketConfirmationScore * 0.18 +
        dataCompletenessScore * 0.24,
    ),
    0,
    100,
  );
  const label =
    score >= 78 && args.stock.confidence !== "low"
      ? "evaluator-ready"
      : score >= 62
        ? "watch closely"
        : score >= 45
          ? "research only"
          : "insufficient evidence";

  const reasons = uniqueList(
    [
      latest
        ? `Freshness: latest packet evidence is ${formatAge(latest, new Date())}.`
        : "Freshness: no packet evidence timestamp.",
      `Corroboration: ${args.research.evidencePackets.length} packet(s), ${highSignalCount} critical/high signal item(s), ${categoryCount} evidence class(es).`,
      args.stock.market
        ? `Market confirmation: ${formatPercent(args.stock.market.percentChange)} move, ${args.stock.market.volumeRatio ? `${args.stock.market.volumeRatio.toFixed(2)}x relative volume` : "relative volume unavailable"}.`
        : "Market confirmation: market snapshot unavailable.",
      `Data completeness: ${failedSteps} failed and ${partialSteps} partial source step(s).`,
    ],
    6,
  );
  const blockers = uniqueList(
    [
      topPacket && topPacket.sourceCount <= 1
        ? "Top evidence packet is still single-source."
        : "",
      highSignalCount === 0 ? "No critical/high signal items survived." : "",
      args.stock.confidence === "low" ? "Stock-level confidence is low." : "",
      marketConfirmationScore < 45
        ? "Market reaction is weak or missing relative-volume context."
        : "",
      failedSteps > 0
        ? `Some source classes failed: ${args.research.diagnostics
            .filter((diagnostic) => diagnostic.status === "failed")
            .slice(0, 4)
            .map((diagnostic) => diagnostic.source)
            .join(", ")}.`
        : "",
      ...args.dossier.missingData.slice(0, 3),
    ],
    6,
  );
  const nextChecks = uniqueList(
    [
      "Open the top primary or near-primary evidence link and verify the exact fact.",
      "Check whether price and volume still confirm the catalyst after the latest candle.",
      "Look for a contradicting source before treating the setup as actionable.",
      blockers.length > 0
        ? "Resolve the listed blockers before escalating to stronger evaluation."
        : "Send the evaluator packet to stronger bullish/bearish/neutral models.",
    ],
    5,
  );

  return {
    label,
    score,
    freshnessScore,
    corroborationScore,
    marketConfirmationScore,
    dataCompletenessScore,
    reasons,
    blockers,
    nextChecks,
  };
}

function packetDirectionalWeight(
  packet: DeepResearchData["evidencePackets"][number],
) {
  return Math.round(
    packet.score * 0.55 +
      packet.evidenceBreadthScore * 0.25 +
      packet.sourceCount * 4 +
      packet.riskSeverity * (packet.direction === "negative" ? 0.2 : 0.08),
  );
}

function packetLabel(packet: DeepResearchData["evidencePackets"][number]) {
  return `${packet.title}: ${packet.score}/100, breadth ${packet.evidenceBreadthScore}/100, risk ${packet.riskSeverity}/100`;
}

function buildEvidenceBalance(research: DeepResearchData): EvidenceBalance {
  const groups: Record<DirectionHint, typeof research.evidencePackets> = {
    positive: [],
    negative: [],
    mixed: [],
    unknown: [],
  };
  for (const packet of research.evidencePackets) {
    groups[packet.direction].push(packet);
  }
  const weighted = (direction: DirectionHint) =>
    groups[direction].reduce(
      (sum, packet) => sum + packetDirectionalWeight(packet),
      0,
    );
  const positiveScore = weighted("positive");
  const negativeScore = weighted("negative");
  const mixedScore = weighted("mixed");
  const unknownScore = weighted("unknown");
  const known = [
    ["positive", positiveScore],
    ["negative", negativeScore],
    ["mixed", mixedScore],
  ] as Array<[DirectionHint, number]>;
  known.sort((left, right) => right[1] - left[1]);
  const strongestKnown = known[0];
  const overallDirection =
    strongestKnown[1] === 0
      ? "unknown"
      : strongestKnown[0] === "mixed"
        ? "mixed"
        : positiveScore > 0 &&
            negativeScore > 0 &&
            Math.min(positiveScore, negativeScore) >=
              Math.max(positiveScore, negativeScore) * 0.7
          ? "mixed"
          : strongestKnown[0];
  const sortedLabels = (direction: DirectionHint) =>
    groups[direction]
      .toSorted(
        (left, right) =>
          packetDirectionalWeight(right) - packetDirectionalWeight(left),
      )
      .slice(0, 3)
      .map(packetLabel);
  const summary =
    overallDirection === "mixed"
      ? `Evidence is mixed: positive weight ${positiveScore}, negative weight ${negativeScore}, mixed weight ${mixedScore}.`
      : `Dominant evidence direction is ${overallDirection}: positive ${positiveScore}, negative ${negativeScore}, mixed ${mixedScore}, unknown ${unknownScore}.`;
  return {
    overallDirection,
    positiveScore,
    negativeScore,
    mixedScore,
    unknownScore,
    positivePacketCount: groups.positive.length,
    negativePacketCount: groups.negative.length,
    mixedPacketCount: groups.mixed.length,
    unknownPacketCount: groups.unknown.length,
    topPositivePackets: sortedLabels("positive"),
    topNegativePackets: sortedLabels("negative"),
    topMixedPackets: sortedLabels("mixed"),
    summary,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function directionField(
  record: Record<string, unknown> | undefined,
  key: string,
): DirectionHint | undefined {
  const value = record?.[key];
  return value === "positive" ||
    value === "negative" ||
    value === "mixed" ||
    value === "unknown"
    ? value
    : undefined;
}

function signedChangeLabel(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`;
}

function buildDossierDelta(args: {
  previousEvaluatorPacket?: Record<string, unknown>;
  previousReportId?: number;
  stock: StockIntel;
  actionReadiness: ActionReadiness;
  evidenceBalance: EvidenceBalance;
}): DossierDelta | undefined {
  const previous = args.previousEvaluatorPacket;
  if (!previous) {
    return undefined;
  }
  const previousVerdict = asRecord(previous.verdict);
  const previousReadiness = asRecord(previous.actionReadiness);
  const previousBalance = asRecord(previous.evidenceBalance);
  const previousScore = numberField(previousVerdict, "score");
  const previousReadinessScore = numberField(previousReadiness, "score");
  const previousDirection = directionField(previousBalance, "overallDirection");
  const scoreChange =
    previousScore === undefined ? undefined : args.stock.score - previousScore;
  const readinessScoreChange =
    previousReadinessScore === undefined
      ? undefined
      : args.actionReadiness.score - previousReadinessScore;
  const directionChanged =
    previousDirection !== undefined &&
    previousDirection !== args.evidenceBalance.overallDirection;
  const summary = uniqueList(
    [
      scoreChange !== undefined
        ? `Stock score ${signedChangeLabel(scoreChange)} versus previous report.`
        : "",
      readinessScoreChange !== undefined
        ? `Readiness ${signedChangeLabel(readinessScoreChange)} versus previous report.`
        : "",
      previousDirection
        ? directionChanged
          ? `Direction changed from ${previousDirection} to ${args.evidenceBalance.overallDirection}.`
          : `Direction stayed ${args.evidenceBalance.overallDirection}.`
        : "",
    ],
    4,
  );
  return {
    previousReportId: args.previousReportId,
    scoreChange,
    readinessScoreChange,
    previousOverallDirection: previousDirection,
    currentOverallDirection: args.evidenceBalance.overallDirection,
    directionChanged,
    summary:
      summary.length > 0
        ? summary
        : ["Previous report existed, but comparable fields were missing."],
  };
}

function edgeSummaryFor(stock: StockIntel, research: DeepResearchData) {
  const topPacket = research.evidencePackets[0];
  if (!topPacket) {
    return "No evidence packet survived filtering, so there is no usable edge yet.";
  }
  if (stock.score >= 80 && stock.confidence !== "low") {
    return `Strong candidate edge if ${topPacket.title.toLowerCase()} is still underpriced by the market.`;
  }
  if (stock.score >= 68 && stock.confidence !== "low") {
    return `Possible actionable edge, led by ${topPacket.title.toLowerCase()}, but timing and confirmation still matter.`;
  }
  if (stock.score >= 55) {
    return `Relevant setup, but the evidence is not strong enough to treat as a high-conviction signal.`;
  }
  return "Insufficient edge; useful mainly as background or a watchlist update.";
}

function uniqueList(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.replace(/\s+/g, " ").trim();
    if (!cleaned || seen.has(cleaned.toLowerCase())) {
      continue;
    }
    seen.add(cleaned.toLowerCase());
    result.push(cleaned);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function buildInvalidation(stock: StockIntel, research: DeepResearchData) {
  const topPacket = research.evidencePackets[0];
  const directional =
    topPacket?.direction === "negative"
      ? "Risk case weakens if the negative catalyst is rebutted by primary sources or price recovers on strong volume."
      : "Bull case weakens if price reaction fades, volume normalizes, or primary sources do not confirm the catalyst.";
  return uniqueList(
    [
      ...stock.bearCase,
      ...stock.risks,
      directional,
      "If the next market session ignores the catalyst, treat the setup as lower urgency.",
    ],
    6,
  );
}

function buildMissingData(
  stock: StockIntel,
  research: DeepResearchData,
  rawItems: IntelRawItem[],
) {
  const failedSources = research.diagnostics
    .filter((diagnostic) => diagnostic.status === "failed")
    .map((diagnostic) => diagnostic.source);
  const completedDiagnosticSources = research.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.status !== "failed" && diagnostic.itemCount > 0,
    )
    .map((diagnostic) => diagnostic.source);
  const sourceNames = new Set(rawItems.map((item) => item.source));
  const coverageGaps = sourceCoverageGaps({
    rawSources: [...sourceNames],
    diagnosticSources: completedDiagnosticSources,
  });
  return uniqueList(
    [
      !stock.market ? "Market snapshot is missing." : "",
      !stock.fundamentals ? "Fundamental snapshot is missing." : "",
      failedSources.length > 0
        ? `Failed source steps: ${[...new Set(failedSources)].join(", ")}.`
        : "",
      ...coverageGaps,
      research.evidencePackets.every((packet) => packet.confidence !== "high")
        ? "No high-confidence evidence packet yet."
        : "",
      "Transcripts, options flow, short interest, and analyst estimate revisions are not fully integrated yet.",
      ...research.dataQuality.filter(
        (note) => note !== "No major data-quality warnings.",
      ),
    ],
    7,
  );
}

function buildDecisionDossier(args: {
  horizon: IntelHorizon;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
}): DecisionDossier {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const latest = latestEvidenceDate(args.research, rawById);
  const catalystClock = latest
    ? `Latest packet evidence was ${formatAge(latest, new Date())}.`
    : "No packet evidence timestamp available.";
  const topCatalysts = args.research.evidencePackets
    .slice(0, 5)
    .map(
      (packet) =>
        `${packet.title}: ${packet.score}/100 ${packet.direction}; ${packet.conclusion}`,
    );

  return {
    setupType: setupTypeFor(args.stock, args.research),
    timeWindow: timeWindowFor(args.horizon, args.stock.confidence),
    catalystClock,
    edgeSummary: edgeSummaryFor(args.stock, args.research),
    topCatalysts:
      topCatalysts.length > 0
        ? topCatalysts
        : ["No strong catalyst packet survived filtering."],
    invalidation: buildInvalidation(args.stock, args.research),
    missingData: buildMissingData(args.stock, args.research, args.rawItems),
    humanChecks: [
      "Check whether the move is already priced in before entry.",
      "Read the highest-quality primary or near-primary source before acting.",
      "Compare the setup against sector peers and the current market regime.",
      "Define exit/invalidation before sizing any trade.",
    ],
  };
}

function themeNote(theme: DeepResearchTheme, narrative: DeepNarrative | null) {
  const notes = narrative?.themeNotes as Record<string, unknown> | undefined;
  const note = notes?.[theme.title];
  return typeof note === "string" && note.trim() ? note.trim() : theme.summary;
}

function telegramSummary(args: {
  stock: StockIntel;
  research: DeepResearchData;
  executiveSummary: string;
  dossier: DecisionDossier;
  actionReadiness: ActionReadiness;
  evidenceBalance: EvidenceBalance;
  dossierDelta?: DossierDelta;
}) {
  const change = args.research.changeSummary;
  const changeLine = change
    ? change.previousRunId
      ? `Changes: ${change.newItemCount} new / ${change.reusedItemCount} reused / ${change.droppedItemCount} dropped since run #${change.previousRunId}`
      : `Changes: baseline run, ${change.currentItemCount} current items (${change.cacheNewItemCount} new to cache)`
    : "Changes: not available";
  const topPackets = args.research.evidencePackets
    .slice(0, 3)
    .map(
      (packet, index) =>
        `${index + 1}. ${packet.title}: ${packet.score}/100 ${packet.direction}`,
    )
    .join("\n");
  const signals = args.research.signalCounts;
  const signalLine = `Signals: ${signals.critical} critical / ${signals.high} high / ${signals.medium} medium / ${signals.low} low / ${signals.noise} noise`;

  return [
    `Deep Intel ${args.stock.ticker} - ${args.research.horizon}/${args.research.preset}`,
    `Verdict: ${args.stock.verdict} (${args.stock.score}/100, ${args.stock.confidence})`,
    `Setup: ${args.dossier.setupType} - Window: ${args.dossier.timeWindow}`,
    `Readiness: ${args.actionReadiness.label} (${args.actionReadiness.score}/100)`,
    `Balance: ${args.evidenceBalance.overallDirection} (+${args.evidenceBalance.positiveScore} / -${args.evidenceBalance.negativeScore} / mixed ${args.evidenceBalance.mixedScore})`,
    args.dossierDelta
      ? `Delta: ${args.dossierDelta.summary.join(" ")}`
      : "Delta: baseline or no previous comparable dossier",
    `Edge: ${args.dossier.edgeSummary}`,
    "",
    "Top evidence:",
    topPackets || "No strong evidence packets extracted.",
    "",
    "Invalidation:",
    args.dossier.invalidation
      .slice(0, 2)
      .map((item) => `- ${item}`)
      .join("\n"),
    "",
    `${args.research.rawItemCount} raw / ${args.research.relevantItemCount} relevant / ${args.research.noiseRejectedCount} noise / ${args.research.sourceCount} sources`,
    signalLine,
    changeLine,
    "Full decision dossier attached.",
  ].join("\n");
}

function metric(label: string, value: string) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function marketMetrics(snapshot?: MarketSnapshot) {
  return [
    metric("Price", formatMoney(snapshot?.price)),
    metric("Move", formatPercent(snapshot?.percentChange)),
    metric(
      "Day range",
      `${formatMoney(snapshot?.dayLow)} - ${formatMoney(snapshot?.dayHigh)}`,
    ),
    metric(
      "52w range",
      `${formatMoney(snapshot?.fiftyTwoWeekLow)} - ${formatMoney(snapshot?.fiftyTwoWeekHigh)}`,
    ),
    metric("Volume", formatNumber(snapshot?.volume)),
    metric(
      "Rel volume",
      snapshot?.volumeRatio ? `${snapshot.volumeRatio.toFixed(2)}x` : "n/a",
    ),
  ].join("");
}

function fundamentalMetrics(fundamentals?: FundamentalSnapshot) {
  return [
    metric(
      "P/E",
      fundamentals?.estimatedPe ? fundamentals.estimatedPe.toFixed(1) : "n/a",
    ),
    metric("Revenue", formatMoney(fundamentals?.revenue, 0)),
    metric("Net income", formatMoney(fundamentals?.netIncome, 0)),
    metric("Diluted EPS", fundamentals?.epsDiluted?.toFixed(2) ?? "n/a"),
    metric("Cash", formatMoney(fundamentals?.cash, 0)),
    metric("Long debt", formatMoney(fundamentals?.longTermDebt, 0)),
    metric(
      "FY/period",
      fundamentals?.fiscalYear
        ? `${fundamentals.fiscalYear} ${fundamentals.fiscalPeriod ?? ""}`.trim()
        : "n/a",
    ),
  ].join("");
}

function evidenceList(
  theme: DeepResearchTheme,
  rawById: Map<number, IntelRawItem>,
) {
  return theme.evidenceItemIds
    .slice(0, 20)
    .map((id) => {
      const item = rawById.get(id);
      if (!item) {
        return "";
      }
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<li>${link}<span>${escapeHtml(item.source)} - ${escapeHtml(sourceTimeLabel(item))}</span></li>`;
    })
    .filter(Boolean)
    .join("");
}

function packetCard(
  packet: DeepResearchData["evidencePackets"][number],
  rawById: Map<number, IntelRawItem>,
) {
  const evidence = packet.evidenceItemIds
    .slice(0, 8)
    .map((id) => {
      const item = rawById.get(id);
      if (!item) {
        return "";
      }
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<li>${link}<span>${escapeHtml(item.source)} - ${escapeHtml(sourceTimeLabel(item))}</span></li>`;
    })
    .filter(Boolean)
    .join("");
  const facts = packet.keyFacts.length
    ? `<ul>${packet.keyFacts
        .slice(0, 6)
        .map((fact) => `<li>${escapeHtml(fact)}</li>`)
        .join("")}</ul>`
    : "<p>No concrete numeric facts extracted.</p>";

  return `<section class="packet">
    <div class="theme-head">
      <div>
        <h2>${escapeHtml(packet.title)}</h2>
        <div class="meta">${escapeHtml(packet.direction)} / ${escapeHtml(packet.confidence)} / breadth ${packet.evidenceBreadthScore}/100 / risk ${packet.riskSeverity}/100 / ${packet.sourceCount} source${packet.sourceCount === 1 ? "" : "s"} / ${packet.noiseRejectedCount} rejected</div>
      </div>
      <div class="score">${packet.score}</div>
    </div>
    <p><strong>Conclusion:</strong> ${escapeHtml(packet.conclusion)}</p>
    <p>${escapeHtml(packet.summary)}</p>
    <p class="why">${escapeHtml(packet.whyItMatters)}</p>
    <h3>Key Facts</h3>
    ${facts}
    <h3>Best Evidence</h3>
    <ol class="evidence">${evidence}</ol>
  </section>`;
}

function listBlock(title: string, items: string[], empty: string) {
  const values = items.length > 0 ? items : [empty];
  return `<div class="dossier-box">
    <h3>${escapeHtml(title)}</h3>
    <ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </div>`;
}

function dossierSection(dossier: DecisionDossier, stock: StockIntel) {
  return `<section class="panel dossier">
    <div class="theme-head">
      <div>
        <h2>Decision Dossier</h2>
        <div class="meta">Human decision support, not an automated trade instruction</div>
      </div>
      <div class="score">${stock.score}</div>
    </div>
    <div class="dossier-grid">
      <div class="dossier-box primary">
        <h3>Setup</h3>
        <strong>${escapeHtml(dossier.setupType)}</strong>
        <p>${escapeHtml(dossier.edgeSummary)}</p>
      </div>
      <div class="dossier-box">
        <h3>Time Window</h3>
        <strong>${escapeHtml(dossier.timeWindow)}</strong>
        <p>${escapeHtml(dossier.catalystClock)}</p>
      </div>
      ${listBlock("Top Catalysts", dossier.topCatalysts, "No catalyst packet survived filtering.")}
      ${listBlock("Invalidation / Risks", dossier.invalidation, "No explicit invalidation extracted.")}
      ${listBlock("Missing Data", dossier.missingData, "No major missing-data warning extracted.")}
      ${listBlock("Human Checks", dossier.humanChecks, "Review primary sources before acting.")}
    </div>
  </section>`;
}

function actionReadinessSection(readiness: ActionReadiness) {
  return `<section class="panel dossier">
    <div class="theme-head">
      <div>
        <h2>Action Readiness</h2>
        <div class="meta">Deterministic triage for evaluator escalation, not a trade command</div>
      </div>
      <div class="score">${readiness.score}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>Label</span><strong>${escapeHtml(readiness.label)}</strong></div>
      <div class="stat"><span>Freshness</span><strong>${readiness.freshnessScore}/100</strong></div>
      <div class="stat"><span>Corroboration</span><strong>${readiness.corroborationScore}/100</strong></div>
      <div class="stat"><span>Market confirm</span><strong>${readiness.marketConfirmationScore}/100</strong></div>
      <div class="stat"><span>Data complete</span><strong>${readiness.dataCompletenessScore}/100</strong></div>
    </div>
    <div class="dossier-grid">
      ${listBlock("Why This Score", readiness.reasons, "No readiness reasons available.")}
      ${listBlock("Blockers", readiness.blockers, "No major deterministic blockers.")}
      ${listBlock("Next Checks", readiness.nextChecks, "Review evidence before acting.")}
    </div>
  </section>`;
}

function evidenceBalanceSection(balance: EvidenceBalance) {
  return `<section class="panel dossier">
    <div class="theme-head">
      <div>
        <h2>Evidence Balance</h2>
        <div class="meta">Directional split for evaluator review</div>
      </div>
      <div class="score">${escapeHtml(balance.overallDirection)}</div>
    </div>
    <p>${escapeHtml(balance.summary)}</p>
    <div class="stat-grid">
      <div class="stat"><span>Positive</span><strong>${balance.positiveScore}</strong><span>${balance.positivePacketCount} packet(s)</span></div>
      <div class="stat"><span>Negative</span><strong>${balance.negativeScore}</strong><span>${balance.negativePacketCount} packet(s)</span></div>
      <div class="stat"><span>Mixed</span><strong>${balance.mixedScore}</strong><span>${balance.mixedPacketCount} packet(s)</span></div>
      <div class="stat"><span>Unknown</span><strong>${balance.unknownScore}</strong><span>${balance.unknownPacketCount} packet(s)</span></div>
    </div>
    <div class="dossier-grid">
      ${listBlock("Top Positive Evidence", balance.topPositivePackets, "No positive packet extracted.")}
      ${listBlock("Top Negative Evidence", balance.topNegativePackets, "No negative packet extracted.")}
      ${listBlock("Top Mixed Evidence", balance.topMixedPackets, "No mixed packet extracted.")}
    </div>
  </section>`;
}

function dossierDeltaSection(delta?: DossierDelta) {
  if (!delta) {
    return `<section class="panel">
      <h2>Dossier Delta</h2>
      <p class="meta">No previous comparable deep report was available for this ticker/chat.</p>
    </section>`;
  }
  return `<section class="panel dossier">
    <div class="theme-head">
      <div>
        <h2>Dossier Delta</h2>
        <div class="meta">Compared with previous report${delta.previousReportId ? ` #${delta.previousReportId}` : ""}</div>
      </div>
      <div class="score">${delta.directionChanged ? "changed" : "same"}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><span>Score change</span><strong>${delta.scoreChange === undefined ? "n/a" : signedChangeLabel(delta.scoreChange)}</strong></div>
      <div class="stat"><span>Readiness change</span><strong>${delta.readinessScoreChange === undefined ? "n/a" : signedChangeLabel(delta.readinessScoreChange)}</strong></div>
      <div class="stat"><span>Previous direction</span><strong>${escapeHtml(delta.previousOverallDirection ?? "n/a")}</strong></div>
      <div class="stat"><span>Current direction</span><strong>${escapeHtml(delta.currentOverallDirection)}</strong></div>
    </div>
    ${listBlock("What Changed", delta.summary, "No comparable score fields changed.")}
  </section>`;
}

function themeCard(
  theme: DeepResearchTheme,
  rawById: Map<number, IntelRawItem>,
  narrative: DeepNarrative | null,
) {
  const facts = theme.keyFacts.length
    ? `<ul>${theme.keyFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`
    : "<p>No concrete numeric facts extracted for this theme.</p>";
  return `<section class="theme" id="${escapeHtmlAttribute(theme.key)}">
    <div class="theme-head">
      <div>
        <h2>${escapeHtml(theme.title)}</h2>
        <div class="meta">${escapeHtml(theme.direction)} / ${escapeHtml(theme.confidence)} / ${theme.sourceCount} source${theme.sourceCount === 1 ? "" : "s"}</div>
      </div>
      <div class="score">${theme.score}</div>
    </div>
    <p>${escapeHtml(themeNote(theme, narrative))}</p>
    <p class="why">${escapeHtml(theme.whyItMatters)}</p>
    <h3>Key Facts</h3>
    ${facts}
    <h3>Evidence</h3>
    <ol class="evidence">${evidenceList(theme, rawById)}</ol>
  </section>`;
}

function sourceQualityPanel(
  rawItems: IntelRawItem[],
  diagnostics: SourceDiagnostic[],
) {
  const rawCounts = new Map<string, number>();
  for (const item of rawItems) {
    rawCounts.set(item.source, (rawCounts.get(item.source) ?? 0) + 1);
  }
  const diagnosticCounts = new Map<string, number>();
  const statuses = new Map<string, Set<SourceDiagnostic["status"]>>();
  for (const diagnostic of diagnostics) {
    diagnosticCounts.set(
      diagnostic.source,
      (diagnosticCounts.get(diagnostic.source) ?? 0) + diagnostic.itemCount,
    );
    const sourceStatuses = statuses.get(diagnostic.source) ?? new Set();
    sourceStatuses.add(diagnostic.status);
    statuses.set(diagnostic.source, sourceStatuses);
  }
  const sources = [
    ...new Set([...rawCounts.keys(), ...diagnosticCounts.keys()]),
  ]
    .map((source) => {
      const profile = getSourceProfile(source);
      return {
        source,
        profile,
        rawCount: rawCounts.get(source) ?? 0,
        diagnosticCount: diagnosticCounts.get(source) ?? 0,
        statuses: [...(statuses.get(source) ?? new Set())],
      };
    })
    .sort((left, right) => {
      if (left.profile.qualityScore !== right.profile.qualityScore) {
        return right.profile.qualityScore - left.profile.qualityScore;
      }
      return (
        right.rawCount +
        right.diagnosticCount -
        (left.rawCount + left.diagnosticCount)
      );
    });

  const rows = sources
    .map((source) => {
      const statusLabel =
        source.statuses.length > 0 ? source.statuses.join(", ") : "raw only";
      const itemCount =
        source.rawCount > 0
          ? `${source.rawCount} raw`
          : `${source.diagnosticCount} diag`;
      return `<tr>
        <td><strong>${escapeHtml(source.profile.displayName)}</strong><span>${escapeHtml(source.source)}</span></td>
        <td>${escapeHtml(source.profile.category)}</td>
        <td>${escapeHtml(source.profile.reliability)}</td>
        <td>${source.profile.qualityScore}</td>
        <td>${escapeHtml(itemCount)}</td>
        <td>${escapeHtml(statusLabel)}</td>
        <td>${escapeHtml(source.profile.rateLimit)}</td>
        <td>${escapeHtml(source.profile.limitations)}</td>
      </tr>`;
    })
    .join("");

  return `<section class="panel">
    <h2>Source Quality</h2>
    <p class="meta">Source quality affects packet scoring. Primary and high-reliability sources should outweigh discovery feeds and social chatter.</p>
    <table>
      <thead><tr><th>Source</th><th>Category</th><th>Reliability</th><th>Quality</th><th>Items</th><th>Status</th><th>Rate Limit</th><th>Limitation</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8">No source rows available.</td></tr>'}</tbody>
    </table>
  </section>`;
}

function buildSourceCoverage(
  rawItems: IntelRawItem[],
  diagnostics: SourceDiagnostic[],
) {
  const byCategory = new Map<
    string,
    {
      category: string;
      sources: Set<string>;
      rawItemCount: number;
      diagnosticItemCount: number;
      okSteps: number;
      partialSteps: number;
      failedSteps: number;
    }
  >();

  function getCategoryRow(source: string) {
    const category = getSourceProfile(source).category;
    const existing = byCategory.get(category);
    if (existing) {
      existing.sources.add(source);
      return existing;
    }
    const row = {
      category,
      sources: new Set([source]),
      rawItemCount: 0,
      diagnosticItemCount: 0,
      okSteps: 0,
      partialSteps: 0,
      failedSteps: 0,
    };
    byCategory.set(category, row);
    return row;
  }

  for (const item of rawItems) {
    getCategoryRow(item.source).rawItemCount += 1;
  }
  for (const diagnostic of diagnostics) {
    const row = getCategoryRow(diagnostic.source);
    row.diagnosticItemCount += diagnostic.itemCount;
    if (diagnostic.status === "ok") {
      row.okSteps += 1;
    } else if (diagnostic.status === "partial") {
      row.partialSteps += 1;
    } else {
      row.failedSteps += 1;
    }
  }

  return [...byCategory.values()]
    .map((row) => ({
      ...row,
      sources: [...row.sources].sort(),
    }))
    .sort((left, right) => {
      if (left.failedSteps !== right.failedSteps) {
        return left.failedSteps - right.failedSteps;
      }
      return (
        right.rawItemCount +
        right.diagnosticItemCount -
        (left.rawItemCount + left.diagnosticItemCount)
      );
    });
}

function sourceCoveragePanel(
  rawItems: IntelRawItem[],
  diagnostics: SourceDiagnostic[],
) {
  const coverage = buildSourceCoverage(rawItems, diagnostics);
  const covered = coverage.filter(
    (row) => row.rawItemCount > 0 || row.okSteps > 0,
  ).length;
  const failed = coverage.reduce((sum, row) => sum + row.failedSteps, 0);
  const rows = coverage
    .map(
      (row) => `<tr>
        <td><strong>${escapeHtml(row.category.replaceAll("_", " "))}</strong><span>${escapeHtml(row.sources.map(sourceDisplayName).join(", "))}</span></td>
        <td>${row.sources.length}</td>
        <td>${row.rawItemCount}</td>
        <td>${row.diagnosticItemCount}</td>
        <td>${row.okSteps}</td>
        <td>${row.partialSteps}</td>
        <td>${row.failedSteps}</td>
      </tr>`,
    )
    .join("");
  return `<section class="panel">
    <h2>Source Coverage</h2>
    <p class="meta">Coverage by evidence class. This shows whether the report is supported by primary data, market data, analyst context, positioning, ownership, news, social, and enrichment sources.</p>
    <div class="stat-grid">
      <div class="stat"><span>Covered classes</span><strong>${covered}</strong></div>
      <div class="stat"><span>Coverage rows</span><strong>${coverage.length}</strong></div>
      <div class="stat"><span>Failed steps</span><strong>${failed}</strong></div>
    </div>
    <table>
      <thead><tr><th>Evidence Class</th><th>Sources</th><th>Raw Items</th><th>Diagnostic Items</th><th>OK</th><th>Partial</th><th>Failed</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">No source coverage available.</td></tr>'}</tbody>
    </table>
  </section>`;
}

function signalFilterPanel(research: DeepResearchData) {
  const counts = research.signalCounts;
  const rows = research.topSignals
    .slice(0, 15)
    .map(
      (item) => `<tr>
        <td><strong>${escapeHtml(item.signalTier)}</strong><span>${item.signalScore}/100</span></td>
        <td>${escapeHtml(sourceDisplayName(item.source))}<br><span>${escapeHtml(item.source)}</span></td>
        <td>${escapeHtml(item.topic.replaceAll("_", " "))}</td>
        <td>${escapeHtml(item.title)}<br><span>${escapeHtml(item.summary)}</span></td>
        <td>${escapeHtml(item.signalReasons.join("; "))}</td>
      </tr>`,
    )
    .join("");

  return `<section class="panel">
    <h2>Signal Filter</h2>
    <p class="meta">Raw items are ranked before packet synthesis so the evaluator can focus on the strongest evidence first.</p>
    <div class="stat-grid">
      <div class="stat"><span>Critical</span><strong>${counts.critical}</strong></div>
      <div class="stat"><span>High</span><strong>${counts.high}</strong></div>
      <div class="stat"><span>Medium</span><strong>${counts.medium}</strong></div>
      <div class="stat"><span>Low</span><strong>${counts.low}</strong></div>
      <div class="stat"><span>Noise</span><strong>${counts.noise}</strong></div>
      <div class="stat"><span>Top signal items</span><strong>${research.topSignals.length}</strong></div>
    </div>
    <table>
      <thead><tr><th>Tier</th><th>Source</th><th>Topic</th><th>Item</th><th>Why</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">No non-noise signal items were found.</td></tr>'}</tbody>
    </table>
  </section>`;
}

function compactItemRows(items: IntelRawItem[]) {
  return items
    .slice(0, 12)
    .map((item) => {
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<li>${link}<span>${escapeHtml(sourceDisplayName(item.source))} - ${escapeHtml(sourceTimeLabel(item))}</span></li>`;
    })
    .join("");
}

function changedSincePreviousSection(research: DeepResearchData) {
  const change = research.changeSummary;
  if (!change) {
    return `<section class="panel">
      <h2>Changed Since Previous Report</h2>
      <p>No run-delta metadata was available for this report.</p>
    </section>`;
  }

  const newSources = change.newSources.length
    ? change.newSources.map(sourceDisplayName).join(", ")
    : "none";
  const droppedSources = change.droppedSources.length
    ? change.droppedSources.map(sourceDisplayName).join(", ")
    : "none";
  const headline = change.previousRunId
    ? `${change.newItemCount} new, ${change.reusedItemCount} reused, ${change.droppedItemCount} dropped since run #${change.previousRunId}.`
    : `Baseline run: ${change.currentItemCount} current items, ${change.cacheNewItemCount} new to cache.`;

  return `<section class="panel">
    <h2>Changed Since Previous Report</h2>
    <p>${escapeHtml(headline)}</p>
    <div class="stat-grid">
      <div class="stat"><span>Current items</span><strong>${change.currentItemCount}</strong></div>
      <div class="stat"><span>Previous items</span><strong>${change.previousItemCount}</strong></div>
      <div class="stat"><span>New this run</span><strong>${change.newItemCount}</strong></div>
      <div class="stat"><span>New to cache</span><strong>${change.cacheNewItemCount}</strong></div>
      <div class="stat"><span>Reused</span><strong>${change.reusedItemCount}</strong></div>
      <div class="stat"><span>Dropped</span><strong>${change.droppedItemCount}</strong></div>
    </div>
    <p class="meta">New sources: ${escapeHtml(newSources)}. Dropped sources: ${escapeHtml(droppedSources)}.</p>
    <div class="columns">
      <div>
        <h3>New Items</h3>
        <ol class="evidence">${compactItemRows(change.newItems) || "<li>No new items versus previous run.</li>"}</ol>
      </div>
      <div>
        <h3>Dropped Items</h3>
        <ol class="evidence">${compactItemRows(change.droppedItems) || "<li>No dropped items versus previous run.</li>"}</ol>
      </div>
    </div>
  </section>`;
}

function diagnosticsTable(diagnostics: SourceDiagnostic[]) {
  const rows = diagnostics
    .map(
      (diagnostic) => `<tr>
        <td>${escapeHtml(diagnostic.source)}</td>
        <td>${escapeHtml(diagnostic.label)}</td>
        <td><span class="status ${escapeHtmlAttribute(diagnostic.status)}">${escapeHtml(diagnostic.status)}</span></td>
        <td>${diagnostic.itemCount}</td>
        <td>${escapeHtml(diagnostic.message ?? "")}</td>
      </tr>`,
    )
    .join("");
  return `<details class="panel">
    <summary>Source Diagnostics</summary>
    <h2>Source Diagnostics</h2>
    <table>
      <thead><tr><th>Source</th><th>Step</th><th>Status</th><th>Items</th><th>Message</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function sourceAppendix(rawItems: IntelRawItem[], relevantIds: Set<number>) {
  const rows = rawItems
    .slice()
    .sort(
      (itemA, itemB) =>
        itemB.publishedAt.getTime() - itemA.publishedAt.getTime(),
    )
    .slice(0, 500)
    .map((item) => {
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<tr>
        <td>${relevantIds.has(item.id) ? "yes" : "no"}</td>
        <td>${escapeHtml(sourceDisplayName(item.source))}<br><span>${escapeHtml(item.source)}</span></td>
        <td>${escapeHtml(item.sourceType)}</td>
        <td>${escapeHtml(sourceTimeLabel(item))}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("");

  return `<details class="panel">
    <summary>Source Appendix (${rawItems.length} items)</summary>
    <h2>Source Appendix</h2>
    <table>
      <thead><tr><th>Relevant</th><th>Source</th><th>Type</th><th>Time</th><th>Item</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function buildHtml(args: {
  entry: UniverseEntry;
  horizon: IntelHorizon;
  generatedAt: Date;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
  relevantItemIds: number[];
  executiveSummary: string;
  narrative: DeepNarrative | null;
  dossier: DecisionDossier;
  actionReadiness: ActionReadiness;
  evidenceBalance: EvidenceBalance;
  dossierDelta?: DossierDelta;
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const relevantIds = new Set(args.relevantItemIds);
  const thesis =
    typeof args.narrative?.thesis === "string" && args.narrative.thesis.trim()
      ? args.narrative.thesis.trim()
      : args.stock.thesis;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Deep Intel ${escapeHtml(args.stock.ticker)} ${escapeHtml(args.horizon)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f7fa; color: #161b22; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 60px; }
    h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.1; }
    h2 { margin: 0 0 10px; font-size: 20px; line-height: 1.25; }
    h3 { margin: 18px 0 8px; font-size: 13px; color: #344054; text-transform: uppercase; letter-spacing: .04em; }
    a { color: #0b57d0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #667085; font-size: 13px; }
    .panel, .theme, .packet { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px 18px; margin: 12px 0; }
    .summary { line-height: 1.55; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, .8fr); gap: 14px; align-items: stretch; }
    .stat-grid, .metrics { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 8px; }
    .metric, .stat { background: #f7f8fb; border: 1px solid #eaecf0; border-radius: 6px; padding: 8px 10px; }
    .metric span, .stat span { display: block; color: #667085; font-size: 12px; }
    .metric strong, .stat strong { font-size: 15px; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .dossier-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
    .dossier-box { border: 1px solid #eaecf0; border-radius: 8px; background: #f8fafc; padding: 11px 12px; }
    .dossier-box.primary { background: #eef4ff; border-color: #c7d7fe; }
    .dossier-box strong { display: block; font-size: 16px; margin-bottom: 6px; }
    .dossier-box p { margin: 0; color: #475467; line-height: 1.45; }
    .dossier-box ul { margin-left: 18px; }
    .theme-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .score { min-width: 58px; text-align: center; border-radius: 8px; color: #fff; font-size: 24px; font-weight: 900; padding: 10px 8px; background: #344054; }
    .why { color: #475467; }
    ul { margin: 6px 0 0 20px; padding: 0; line-height: 1.45; }
    .evidence { margin: 6px 0 0 20px; padding: 0; }
    .evidence li { margin: 7px 0; }
    .evidence span { display: block; color: #667085; font-size: 12px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border-bottom: 1px solid #eaecf0; padding: 8px 9px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: #f2f4f7; color: #344054; }
    td span { color: #667085; font-size: 11px; }
    .status.ok { color: #137333; font-weight: 700; }
    .status.partial { color: #b06000; font-weight: 700; }
    .status.failed { color: #b42318; font-weight: 700; }
    summary { cursor: pointer; font-weight: 800; }
    @media (max-width: 820px) {
      .hero, .columns, .dossier-grid { grid-template-columns: 1fr; }
      .stat-grid, .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Deep Intel ${escapeHtml(args.stock.ticker)}</h1>
      <div class="meta">${escapeHtml(args.stock.companyName)} &middot; ${escapeHtml(args.horizon)} &middot; Generated ${escapeHtml(args.generatedAt.toLocaleString())}</div>
    </header>
    <section class="hero">
      <div class="panel summary">
        <h2>${escapeHtml(args.stock.verdict)}</h2>
        <p>${escapeHtml(args.executiveSummary)}</p>
        <p><strong>Thesis:</strong> ${escapeHtml(thesis)}</p>
      </div>
      <div class="panel">
        <div class="stat-grid">
          <div class="stat"><span>Stock score</span><strong>${args.stock.score}/100</strong></div>
          <div class="stat"><span>Confidence</span><strong>${escapeHtml(args.stock.confidence)}</strong></div>
          <div class="stat"><span>Raw items</span><strong>${args.research.rawItemCount}</strong></div>
          <div class="stat"><span>Relevant items</span><strong>${args.research.relevantItemCount}</strong></div>
          <div class="stat"><span>Sources</span><strong>${args.research.sourceCount}</strong></div>
          <div class="stat"><span>Evidence packets</span><strong>${args.research.evidencePackets.length}</strong></div>
          <div class="stat"><span>Noise rejected</span><strong>${args.research.noiseRejectedCount}</strong></div>
          <div class="stat"><span>Critical/high signals</span><strong>${args.research.signalCounts.critical + args.research.signalCounts.high}</strong></div>
          <div class="stat"><span>Preset</span><strong>${escapeHtml(args.research.preset)}</strong></div>
        </div>
      </div>
    </section>
    ${dossierSection(args.dossier, args.stock)}
    ${actionReadinessSection(args.actionReadiness)}
    ${evidenceBalanceSection(args.evidenceBalance)}
    ${dossierDeltaSection(args.dossierDelta)}
    ${changedSincePreviousSection(args.research)}
    <section class="panel">
      <h2>Market And Fundamentals</h2>
      <div class="columns">
        <div><h3>Market</h3><div class="metrics">${marketMetrics(args.stock.market)}</div></div>
        <div><h3>Fundamentals</h3><div class="metrics">${fundamentalMetrics(args.stock.fundamentals)}</div></div>
      </div>
    </section>
    <section class="panel">
      <h2>Data Quality</h2>
      <ul>${args.research.dataQuality.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </section>
    ${sourceCoveragePanel(args.rawItems, args.research.diagnostics)}
    ${signalFilterPanel(args.research)}
    ${sourceQualityPanel(args.rawItems, args.research.diagnostics)}
    <section class="panel">
      <h2>Evidence Packet Summary</h2>
      <p>These are the compact packets the evaluator model should read first. Raw items that looked irrelevant, routine, or weak are excluded from packet synthesis.</p>
    </section>
    ${args.research.evidencePackets
      .slice(0, 10)
      .map((packet) => packetCard(packet, rawById))
      .join("")}
    <details class="panel">
      <summary>Legacy Theme View (${args.research.themes.length} themes)</summary>
      ${args.research.themes.map((theme) => themeCard(theme, rawById, args.narrative)).join("")}
    </details>
    ${diagnosticsTable(args.research.diagnostics)}
    ${sourceAppendix(args.rawItems, relevantIds)}
  </main>
</body>
</html>`;
}

function evidenceText(item: IntelRawItem) {
  return `${item.title}\n${item.body ?? ""}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1400);
}

function buildEvaluatorPacket(args: {
  generatedAt: Date;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
  dossier: DecisionDossier;
  actionReadiness: ActionReadiness;
  evidenceBalance: EvidenceBalance;
  dossierDelta?: DossierDelta;
}): EvaluatorPacket {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const signalById = new Map(
    args.research.topSignals.map((item) => [item.rawItemId, item]),
  );
  const evidencePackets = args.research.evidencePackets
    .slice(0, 12)
    .map((packet) => ({
      ...packet,
      evidence: packet.evidenceItemIds
        .slice(0, 10)
        .map((id) => {
          const raw = rawById.get(id);
          if (!raw) {
            return null;
          }
          const signal = signalById.get(id);
          return {
            rawItemId: raw.id,
            source: raw.source,
            sourceType: raw.sourceType,
            title: raw.title,
            url: raw.url,
            publishedAt: raw.publishedAt.toISOString(),
            discoveredAt: raw.discoveredAt?.toISOString(),
            signalTier: signal?.signalTier,
            signalScore: signal?.signalScore,
            signalReasons: signal?.signalReasons,
            text: evidenceText(raw),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null),
    }));

  const change = args.research.changeSummary;
  return {
    version: 1,
    generatedAt: args.generatedAt.toISOString(),
    ticker: args.stock.ticker,
    companyName: args.stock.companyName,
    horizon: args.research.horizon,
    preset: args.research.preset,
    verdict: {
      score: args.stock.score,
      confidence: args.stock.confidence,
      label: args.stock.verdict,
      thesis: args.stock.thesis,
    },
    decisionDossier: args.dossier,
    actionReadiness: args.actionReadiness,
    evidenceBalance: args.evidenceBalance,
    dossierDelta: args.dossierDelta,
    market: args.stock.market,
    fundamentals: args.stock.fundamentals,
    signalCounts: args.research.signalCounts,
    topSignals: args.research.topSignals.slice(0, 20),
    evidencePackets,
    sourceCoverage: buildSourceCoverage(
      args.rawItems,
      args.research.diagnostics,
    ).map((row) => ({
      category: row.category,
      sources: row.sources,
      rawItemCount: row.rawItemCount,
      diagnosticItemCount: row.diagnosticItemCount,
      okSteps: row.okSteps,
      partialSteps: row.partialSteps,
      failedSteps: row.failedSteps,
    })),
    dataQuality: args.research.dataQuality,
    sourceDiagnostics: args.research.diagnostics.map((diagnostic) => ({
      source: diagnostic.source,
      status: diagnostic.status,
      itemCount: diagnostic.itemCount,
      message: diagnostic.message,
    })),
    changeSummary: change
      ? {
          previousRunId: change.previousRunId,
          currentItemCount: change.currentItemCount,
          previousItemCount: change.previousItemCount,
          newItemCount: change.newItemCount,
          reusedItemCount: change.reusedItemCount,
          cacheNewItemCount: change.cacheNewItemCount,
          droppedItemCount: change.droppedItemCount,
          newSources: change.newSources,
          droppedSources: change.droppedSources,
        }
      : undefined,
  };
}

export async function buildDeepIntelReport(args: {
  entry: UniverseEntry;
  horizon: IntelHorizon;
  rawItems: IntelRawItem[];
  relevantItemIds: number[];
  events: IntelEventCluster[];
  stock: StockIntel;
  research: DeepResearchData;
  previousEvaluatorPacket?: Record<string, unknown>;
  previousReportId?: number;
}) {
  const generatedAt = new Date();
  const narrative = await callDeepNarrativeModel({
    horizon: args.horizon,
    stock: args.stock,
    research: args.research,
    rawItems: args.rawItems,
  });
  const executiveSummary =
    typeof narrative?.executiveSummary === "string" &&
    narrative.executiveSummary.trim()
      ? narrative.executiveSummary.trim()
      : fallbackExecutiveSummary(args.stock, args.research);
  const dossier = buildDecisionDossier({
    horizon: args.horizon,
    stock: args.stock,
    research: args.research,
    rawItems: args.rawItems,
  });
  const actionReadiness = buildActionReadiness({
    horizon: args.horizon,
    stock: args.stock,
    research: args.research,
    rawItems: args.rawItems,
    dossier,
  });
  const evidenceBalance = buildEvidenceBalance(args.research);
  const dossierDelta = buildDossierDelta({
    previousEvaluatorPacket: args.previousEvaluatorPacket,
    previousReportId: args.previousReportId,
    stock: args.stock,
    actionReadiness,
    evidenceBalance,
  });
  const html = buildHtml({
    ...args,
    generatedAt,
    executiveSummary,
    narrative,
    dossier,
    actionReadiness,
    evidenceBalance,
    dossierDelta,
  });
  const evaluatorPacket = buildEvaluatorPacket({
    generatedAt,
    stock: args.stock,
    research: args.research,
    rawItems: args.rawItems,
    dossier,
    actionReadiness,
    evidenceBalance,
    dossierDelta,
  });

  return {
    horizon: args.horizon,
    generatedAt,
    universeSummary: `deep research ${args.entry.ticker}`,
    telegramSummary: telegramSummary({
      stock: args.stock,
      research: args.research,
      executiveSummary,
      dossier,
      actionReadiness,
      evidenceBalance,
      dossierDelta,
    }),
    executiveSummary,
    html,
    stocks: [args.stock],
    events: args.events,
    deepResearch: args.research,
    evaluatorPacket,
  } satisfies IntelReport;
}
