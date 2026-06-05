import type {
  DirectionHint,
  EvidencePacket,
  IntelHorizon,
  IntelRawItem,
  ItemDistillation,
  SignalTier,
  TickerMention,
  UniverseEntry,
} from "./types.ts";
import { sourceQualityScore } from "./source_registry.ts";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9$%.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemText(item: IntelRawItem) {
  return `${item.title}\n${item.body ?? ""}`;
}

function ageHours(item: IntelRawItem) {
  return Math.max(0, (Date.now() - item.publishedAt.getTime()) / 3_600_000);
}

function noveltyScore(item: IntelRawItem, horizon: IntelHorizon) {
  const hours = ageHours(item);
  if (hours <= 3) {
    return 95;
  }
  if (hours <= 12) {
    return 85;
  }
  if (hours <= 24) {
    return horizon === "1d" ? 75 : 80;
  }
  if (hours <= 72) {
    return horizon === "1d" ? 45 : 70;
  }
  return horizon === "14d" ? 55 : 30;
}

function inferDirection(text: string): DirectionHint {
  const value = normalizeText(text);
  const positive =
    /\b(beat|beats|raise|raises|raised|upgrade|upgraded|strong|growth|surge|rally|record|improve|improved|approval|wins|winner|bullish|target raised|demand)\b/.test(
      value,
    );
  const negative =
    /\b(miss|misses|cut|cuts|downgrade|downgraded|weak|falls|plunge|lawsuit|probe|investigation|delay|ban|bearish|target cut|shortage|risk)\b/.test(
      value,
    );
  if (positive && negative) {
    return "mixed";
  }
  if (positive) {
    return "positive";
  }
  if (negative) {
    return "negative";
  }
  return "unknown";
}

function topicFor(text: string, sourceType: string) {
  const value = normalizeText(text);
  if (
    /\b(earnings|eps|quarter|q[1-4]|results|guidance|outlook)\b/.test(value)
  ) {
    return "earnings_guidance";
  }
  if (
    /\b(upgrade|downgrade|price target|analyst|rating|estimate|recommendation)\b/.test(
      value,
    )
  ) {
    return "analyst_estimates";
  }
  if (
    /\b(demand|supply|pricing|inventory|capacity|margin|shortage|memory|chip)\b/.test(
      value,
    )
  ) {
    return "supply_demand";
  }
  if (/\b(contract|customer|partnership|order|award|deal)\b/.test(value)) {
    return "customer_contracts";
  }
  if (/\b(product|launch|approval|platform|technology|roadmap)\b/.test(value)) {
    return "products_technology";
  }
  if (
    /\b(lawsuit|probe|investigation|regulator|ban|tariff|sanction|china|macro|fed|rate)\b/.test(
      value,
    )
  ) {
    return "legal_macro_risk";
  }
  if (
    sourceType === "social" ||
    /\b(reddit|stocktwits|sentiment|social)\b/.test(value)
  ) {
    return "social_sentiment";
  }
  if (
    /\b(volume|premarket|after hours|rallies|jumps|falls|slides|volatility|shares|stock)\b/.test(
      value,
    )
  ) {
    return "market_reaction";
  }
  if (
    sourceType === "sec_filing" ||
    /\b(8-k|10-q|10-k|form 4|13d|13g|filed)\b/.test(value)
  ) {
    return "sec_filings";
  }
  return "other";
}

function catalystStrength(text: string, sourceType: string) {
  const value = normalizeText(text);
  let score =
    sourceType === "news"
      ? 35
      : sourceType === "sec_filing"
        ? 32
        : sourceType === "company"
          ? 30
          : sourceType === "research"
            ? 25
            : 20;
  if (
    /\b(earnings|guidance|outlook|raised forecast|cut forecast)\b/.test(value)
  ) {
    score += 35;
  }
  if (/\b(upgrade|downgrade|price target|estimate revision)\b/.test(value)) {
    score += 24;
  }
  if (
    /\b(acquisition|merger|contract|major customer|partnership)\b/.test(value)
  ) {
    score += 28;
  }
  if (/\b(demand|supply|pricing|margin|inventory|capacity)\b/.test(value)) {
    score += 22;
  }
  if (/\b(lawsuit|investigation|ban|sanction|regulator)\b/.test(value)) {
    score += 24;
  }
  if (/\b(form 4|statement of changes in beneficial ownership)\b/.test(value)) {
    score -= 25;
  }
  return clamp(score, 0, 100);
}

function riskSeverity(
  text: string,
  sourceType: string,
  direction: DirectionHint,
) {
  const value = normalizeText(text);
  let score =
    direction === "negative"
      ? 38
      : direction === "mixed"
        ? 28
        : sourceType === "sec_filing"
          ? 18
          : 8;
  if (
    /\b(lawsuit|probe|investigation|regulator|ban|sanction|tariff|recall|default|bankruptcy|fraud)\b/.test(
      value,
    )
  ) {
    score += 42;
  }
  if (
    /\b(cut|cuts|downgrade|downgraded|miss|misses|weak|delay)\b/.test(value)
  ) {
    score += 28;
  }
  if (
    /\b(short interest|short seller|short report|bearish|puts?)\b/.test(value)
  ) {
    score += 22;
  }
  if (/\b(china|export control|macro|fed|rate|inflation)\b/.test(value)) {
    score += 16;
  }
  if (/\b(form 4|automatic sale|10b5-1)\b/.test(value)) {
    score += 10;
  }
  if (direction === "positive" && score < 35) {
    score = Math.max(0, score - 10);
  }
  return clamp(score, 0, 100);
}

function relevanceScore(
  item: IntelRawItem,
  mention: TickerMention | undefined,
  entry: UniverseEntry,
) {
  if (!mention) {
    return 0;
  }
  const text = normalizeText(itemText(item));
  let score = Math.round(mention.confidence * 75);
  if (mention.method === "source") {
    score += 20;
  }
  if (text.includes(normalizeText(entry.name))) {
    score += 14;
  }
  if (entry.aliases.some((alias) => text.includes(normalizeText(alias)))) {
    score += 8;
  }
  if (text.includes(`$${entry.ticker.toLowerCase()}`)) {
    score += 8;
  }
  return clamp(score, 0, 100);
}

function timeSensitivity(
  item: IntelRawItem,
  strength: number,
): IntelHorizon | "low" {
  const hours = ageHours(item);
  if (strength >= 70 && hours <= 24) {
    return "1d";
  }
  if (strength >= 55 && hours <= 72) {
    return "3d";
  }
  if (strength >= 40) {
    return "14d";
  }
  return "low";
}

function firstUsefulSentence(text: string) {
  return (
    text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .find((part) => part.trim().length >= 28)
      ?.trim()
      .slice(0, 420) ?? text.replace(/\s+/g, " ").trim().slice(0, 260)
  );
}

function keyFacts(text: string) {
  const matches =
    text.match(
      /\b(?:\$?\d+(?:\.\d+)?%?|\d+(?:\.\d+)?\s?(?:billion|million|days?|weeks?|months?|quarters?|x))\b[^.]{0,100}/gi,
    ) ?? [];
  return unique(matches.map((value) => value.trim()).filter(Boolean)).slice(
    0,
    5,
  );
}

function noiseReason(args: {
  relevance: number;
  sourceQuality: number;
  catalystStrength: number;
  riskSeverity: number;
  topic: string;
}) {
  if (args.relevance < 50) {
    return "low ticker relevance";
  }
  if (args.sourceQuality < 50 && args.catalystStrength < 60) {
    return "weak low-quality source";
  }
  if (args.topic === "social_sentiment" && args.catalystStrength < 55) {
    return "social chatter without concrete catalyst";
  }
  if (args.topic === "sec_filings" && args.catalystStrength < 50) {
    return "routine SEC filing";
  }
  if (args.catalystStrength < 35 && args.riskSeverity < 55) {
    return "no clear market-moving catalyst";
  }
  return undefined;
}

function signalScore(args: {
  relevance: number;
  novelty: number;
  sourceQuality: number;
  catalystStrength: number;
  riskSeverity: number;
}) {
  return Math.round(
    args.relevance * 0.31 +
      args.catalystStrength * 0.27 +
      args.sourceQuality * 0.18 +
      args.novelty * 0.14 +
      args.riskSeverity * 0.1,
  );
}

function signalTier(score: number, reason?: string): SignalTier {
  if (reason) {
    return "noise";
  }
  if (score >= 85) {
    return "critical";
  }
  if (score >= 72) {
    return "high";
  }
  if (score >= 55) {
    return "medium";
  }
  return "low";
}

function signalReasons(args: {
  topic: string;
  relevance: number;
  novelty: number;
  sourceQuality: number;
  catalystStrength: number;
  riskSeverity: number;
  direction: DirectionHint;
  noiseReason?: string;
}) {
  if (args.noiseReason) {
    return [`Rejected: ${args.noiseReason}`];
  }
  const reasons: string[] = [];
  if (args.catalystStrength >= 75) {
    reasons.push("strong catalyst language");
  } else if (args.catalystStrength >= 55) {
    reasons.push("moderate catalyst language");
  }
  if (args.riskSeverity >= 70) {
    reasons.push("high risk severity");
  } else if (args.riskSeverity >= 50) {
    reasons.push("moderate risk severity");
  }
  if (args.relevance >= 85) {
    reasons.push("high ticker relevance");
  }
  if (args.sourceQuality >= 82) {
    reasons.push("high-quality source");
  }
  if (args.novelty >= 85) {
    reasons.push("fresh item");
  }
  if (args.direction !== "unknown") {
    reasons.push(`${args.direction} direction hint`);
  }
  if (args.topic !== "other") {
    reasons.push(`topic: ${args.topic.replaceAll("_", " ")}`);
  }
  return reasons.slice(0, 5);
}

export function buildItemDistillations(args: {
  rawItems: IntelRawItem[];
  mentions: TickerMention[];
  entry: UniverseEntry;
  horizon: IntelHorizon;
}) {
  const mentionsByItemId = new Map(
    args.mentions.map((mention) => [mention.rawItemId, mention]),
  );
  return args.rawItems.map((item) => {
    const text = itemText(item);
    const mention = mentionsByItemId.get(item.id);
    const topic = topicFor(text, item.sourceType);
    const source = sourceQualityScore(item.source);
    const relevance = relevanceScore(item, mention, args.entry);
    const novelty = noveltyScore(item, args.horizon);
    const strength = catalystStrength(text, item.sourceType);
    const direction = inferDirection(text);
    const risk = riskSeverity(text, item.sourceType, direction);
    const summary = firstUsefulSentence(text);
    const facts = keyFacts(text);
    const reason = noiseReason({
      relevance,
      sourceQuality: source,
      catalystStrength: strength,
      riskSeverity: risk,
      topic,
    });
    const score = signalScore({
      relevance,
      novelty,
      sourceQuality: source,
      catalystStrength: strength,
      riskSeverity: risk,
    });
    const distillation = {
      rawItemId: item.id,
      ticker: args.entry.ticker,
      topic,
      signalTier: signalTier(score, reason),
      signalScore: score,
      signalReasons: signalReasons({
        topic,
        relevance,
        novelty,
        sourceQuality: source,
        catalystStrength: strength,
        riskSeverity: risk,
        direction,
        noiseReason: reason,
      }),
      relevance,
      novelty,
      sourceQuality: source,
      catalystStrength: strength,
      riskSeverity: risk,
      direction,
      timeSensitivity: timeSensitivity(item, strength),
      summary,
      whyItMatters:
        score >= 72
          ? "Concrete catalyst or market signal with potential short-term relevance."
          : "Useful background only if it supports stronger evidence.",
      keyFacts: facts,
      noiseReason: reason,
      createdAt: new Date(),
    } satisfies ItemDistillation;
    return distillation;
  });
}

function packetTitle(topic: string) {
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
  return titles[topic] ?? topic.replaceAll("_", " ");
}

function packetDirection(items: ItemDistillation[]): DirectionHint {
  const counts: Record<DirectionHint, number> = {
    positive: 0,
    negative: 0,
    mixed: 0,
    unknown: 0,
  };
  for (const item of items) {
    counts[item.direction] += 1;
  }
  if (counts.positive > counts.negative && counts.positive > counts.unknown) {
    return "positive";
  }
  if (counts.negative > counts.positive && counts.negative > counts.unknown) {
    return "negative";
  }
  if (counts.positive > 0 && counts.negative > 0) {
    return "mixed";
  }
  return counts.mixed > 0 ? "mixed" : "unknown";
}

function confidence(score: number, sourceCount: number) {
  if (score >= 80 && sourceCount >= 3) {
    return "high";
  }
  if (score >= 60 && sourceCount >= 2) {
    return "medium";
  }
  return "low";
}

function evidenceBreadthScore(args: {
  sourceCount: number;
  itemCount: number;
  keyFactCount: number;
}) {
  return clamp(
    Math.round(
      Math.min(args.sourceCount, 5) * 16 +
        Math.min(args.itemCount, 8) * 5 +
        Math.min(args.keyFactCount, 6) * 4,
    ),
    0,
    100,
  );
}

function packetRiskSeverity(items: ItemDistillation[]) {
  if (items.length === 0) {
    return 0;
  }
  const maxRisk = Math.max(...items.map((item) => item.riskSeverity));
  const averageRisk =
    items.reduce((sum, item) => sum + item.riskSeverity, 0) / items.length;
  return clamp(Math.round(maxRisk * 0.65 + averageRisk * 0.35), 0, 100);
}

export function buildEvidencePackets(args: {
  ticker: string;
  distillations: ItemDistillation[];
  rawItems: IntelRawItem[];
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const groups = new Map<string, ItemDistillation[]>();
  for (const item of args.distillations) {
    const list = groups.get(item.topic) ?? [];
    list.push(item);
    groups.set(item.topic, list);
  }

  const packets: EvidencePacket[] = [];
  for (const [topic, items] of groups.entries()) {
    const signalItems = items
      .filter((item) => !item.noiseReason)
      .sort((a, b) => {
        const scoreA =
          a.relevance * 0.35 +
          a.catalystStrength * 0.3 +
          a.sourceQuality * 0.2 +
          a.novelty * 0.15;
        const scoreB =
          b.relevance * 0.35 +
          b.catalystStrength * 0.3 +
          b.sourceQuality * 0.2 +
          b.novelty * 0.15;
        return scoreB - scoreA;
      });
    if (signalItems.length === 0) {
      continue;
    }
    const top = signalItems.slice(0, 8);
    const evidenceItemIds = top.map((item) => item.rawItemId);
    const sources = unique(
      evidenceItemIds.map((id) => rawById.get(id)?.source).filter(Boolean),
    );
    const score = Math.round(
      top.reduce(
        (sum, item) =>
          sum +
          item.relevance * 0.3 +
          item.catalystStrength * 0.27 +
          item.sourceQuality * 0.18 +
          item.novelty * 0.15 +
          item.riskSeverity * 0.1,
        0,
      ) / top.length,
    );
    const direction = packetDirection(top);
    const facts = unique(top.flatMap((item) => item.keyFacts)).slice(0, 8);
    const breadth = evidenceBreadthScore({
      sourceCount: sources.length,
      itemCount: top.length,
      keyFactCount: facts.length,
    });
    const risk = packetRiskSeverity(top);
    const strongest = top[0];
    const title = packetTitle(topic);
    packets.push({
      id: `${args.ticker}:${topic}`,
      ticker: args.ticker,
      topic,
      title,
      direction,
      score,
      evidenceBreadthScore: breadth,
      riskSeverity: risk,
      confidence: confidence(
        Math.round(score * 0.85 + breadth * 0.15),
        sources.length,
      ),
      summary: strongest.summary,
      conclusion:
        score >= 75 && breadth >= 55
          ? `${title} is a strong evidence cluster worth evaluator attention.`
          : score >= 55
            ? `${title} is relevant but needs confirmation.`
            : `${title} is weak supporting context.`,
      whyItMatters: strongest.whyItMatters,
      keyFacts: facts,
      evidenceItemIds,
      sourceCount: sources.length,
      noiseRejectedCount: items.filter((item) => item.noiseReason).length,
    });
  }

  return packets.sort((packetA, packetB) => packetB.score - packetA.score);
}
