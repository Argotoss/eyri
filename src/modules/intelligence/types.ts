import type { User } from "../database/user.ts";

export const INTEL_HORIZONS = ["1d", "3d", "14d"] as const;

export type IntelHorizon = (typeof INTEL_HORIZONS)[number];

export type UniverseSource = "portfolio" | "watchlist" | "sp500" | "target";

export const DEEP_RESEARCH_PRESETS = ["fast", "deep", "exhaustive"] as const;

export type DeepResearchPreset = (typeof DEEP_RESEARCH_PRESETS)[number];

export type UniverseEntry = {
  ticker: string;
  name: string;
  aliases: string[];
  sector?: string;
  cik?: string;
  sources: UniverseSource[];
  priority: number;
};

export type UniverseSettings = {
  chatId: string;
  sp500Enabled: boolean;
};

export type IntelligenceRunArgs = {
  database: import("../database/setup.ts").Database;
  chatId: string | number;
  user: User;
  horizon: IntelHorizon;
};

export type SourceType = "news" | "sec_filing" | "market";
export type DeepResearchSourceType =
  | SourceType
  | "social"
  | "research"
  | "company";

export type IntelRawItemInput = {
  source: string;
  sourceType: DeepResearchSourceType;
  sourceId: string;
  title: string;
  url?: string;
  publishedAt: Date;
  discoveredAt?: Date;
  fetchedAt?: Date;
  body?: string;
  rawPayload?: unknown;
  tickers?: string[];
};

export type SourceDiagnostic = {
  source: string;
  label: string;
  status: "ok" | "partial" | "failed";
  itemCount: number;
  startedAt: Date;
  completedAt: Date;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type SourceCollectionResult = {
  items: IntelRawItemInput[];
  diagnostics: SourceDiagnostic[];
};

export type IntelRawItem = IntelRawItemInput & {
  id: number;
  fetchedAt: Date;
  rawHash: string;
};

export type TickerMention = {
  rawItemId: number;
  ticker: string;
  confidence: number;
  method: "source" | "ticker" | "company" | "alias";
};

export type EventType =
  | "earnings"
  | "guidance"
  | "analyst_action"
  | "sec_filing"
  | "m_and_a"
  | "legal_regulatory"
  | "management_change"
  | "major_contract"
  | "product_launch"
  | "supply_chain"
  | "macro_sector"
  | "unusual_price_volume"
  | "other";

export type DirectionHint = "positive" | "negative" | "mixed" | "unknown";

export type EventUrgency = "low" | "medium" | "high";

export type IntelEventCandidate = {
  ticker: string;
  eventType: EventType;
  directionHint: DirectionHint;
  urgency: EventUrgency;
  horizon: IntelHorizon;
  title: string;
  summary: string;
  evidenceItemIds: number[];
  confidence: number;
};

export type IntelEventCluster = IntelEventCandidate & {
  clusterKey: string;
  sourceCount: number;
  latestPublishedAt: Date;
  score: number;
  scoreReasons: string[];
};

export type MarketSnapshot = {
  ticker: string;
  horizon: IntelHorizon;
  price: number;
  previousPrice?: number;
  closePrice?: number;
  percentChange?: number;
  dayHigh?: number;
  dayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  volume?: number;
  averageVolume?: number;
  volumeRatio?: number;
  companyName?: string;
  provider?: string;
  sourceTicker?: string;
  fetchedAt: Date;
};

export type FundamentalSnapshot = {
  ticker: string;
  cik?: string;
  source: "sec_companyfacts";
  fetchedAt: Date;
  fiscalYear?: number;
  fiscalPeriod?: string;
  revenue?: number;
  revenuePeriod?: string;
  netIncome?: number;
  epsDiluted?: number;
  estimatedPe?: number;
  cash?: number;
  longTermDebt?: number;
  assets?: number;
  liabilities?: number;
  equity?: number;
};

export type StockConfidence = "high" | "medium" | "low";
export type SignalTier = "critical" | "high" | "medium" | "low" | "noise";

export type StockIntel = {
  ticker: string;
  companyName: string;
  sector?: string;
  sources: UniverseSource[];
  score: number;
  confidence: StockConfidence;
  verdict: string;
  thesis: string;
  bullCase: string[];
  bearCase: string[];
  risks: string[];
  scoreBreakdown: {
    catalyst: number;
    market: number;
    relevance: number;
    fundamentals: number;
    riskPenalty: number;
  };
  market?: MarketSnapshot;
  fundamentals?: FundamentalSnapshot;
  events: IntelEventCluster[];
  evidenceItemIds: number[];
  sourceCount: number;
  latestPublishedAt?: Date;
};

export type ItemDistillation = {
  rawItemId: number;
  ticker: string;
  topic: string;
  signalTier: SignalTier;
  signalScore: number;
  signalReasons: string[];
  relevance: number;
  novelty: number;
  sourceQuality: number;
  catalystStrength: number;
  riskSeverity: number;
  direction: DirectionHint;
  timeSensitivity: IntelHorizon | "low";
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  noiseReason?: string;
  createdAt: Date;
};

export type SignalItemSummary = {
  rawItemId: number;
  title: string;
  source: string;
  topic: string;
  signalTier: SignalTier;
  signalScore: number;
  signalReasons: string[];
  summary: string;
};

export type EvidencePacket = {
  id: string;
  ticker: string;
  topic: string;
  title: string;
  direction: DirectionHint;
  score: number;
  evidenceBreadthScore: number;
  riskSeverity: number;
  confidence: StockConfidence;
  summary: string;
  conclusion: string;
  whyItMatters: string;
  keyFacts: string[];
  evidenceItemIds: number[];
  sourceCount: number;
  noiseRejectedCount: number;
};

export type RunItemDelta = {
  previousRunId?: number;
  currentItemCount: number;
  previousItemCount: number;
  newItemCount: number;
  reusedItemCount: number;
  cacheNewItemCount: number;
  droppedItemCount: number;
  newItems: IntelRawItem[];
  droppedItems: IntelRawItem[];
  newSources: string[];
  droppedSources: string[];
};

export type DeepResearchTheme = {
  key: string;
  title: string;
  direction: DirectionHint;
  confidence: StockConfidence;
  score: number;
  summary: string;
  whyItMatters: string;
  keyFacts: string[];
  evidenceItemIds: number[];
  sourceCount: number;
  latestPublishedAt?: Date;
  packetIds?: string[];
};

export type DeepResearchData = {
  ticker: string;
  companyName: string;
  horizon: IntelHorizon;
  preset: DeepResearchPreset;
  rawItemCount: number;
  relevantItemCount: number;
  duplicateItemCount: number;
  noiseRejectedCount: number;
  signalCounts: Record<SignalTier, number>;
  topSignals: SignalItemSummary[];
  sourceCount: number;
  evidencePackets: EvidencePacket[];
  changeSummary?: RunItemDelta;
  themes: DeepResearchTheme[];
  diagnostics: SourceDiagnostic[];
  dataQuality: string[];
};

export type RunTiming = {
  stage: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
};

export type ModelUsage = {
  stage: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  createdAt: Date;
};

export type ReportFile = {
  path: string;
  bytes: number;
};

export type EvaluatorEvidenceItem = {
  rawItemId: number;
  source: string;
  sourceType: DeepResearchSourceType;
  title: string;
  url?: string;
  publishedAt: string;
  discoveredAt?: string;
  signalTier?: SignalTier;
  signalScore?: number;
  signalReasons?: string[];
  text: string;
};

export type EvaluatorPacket = {
  version: 1;
  generatedAt: string;
  ticker: string;
  companyName: string;
  horizon: IntelHorizon;
  preset: DeepResearchPreset;
  verdict: {
    score: number;
    confidence: StockConfidence;
    label: string;
    thesis: string;
  };
  decisionDossier: {
    setupType: string;
    timeWindow: string;
    catalystClock: string;
    edgeSummary: string;
    topCatalysts: string[];
    invalidation: string[];
    missingData: string[];
    humanChecks: string[];
  };
  actionReadiness: {
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
  evidenceBalance: {
    overallDirection: DirectionHint;
    positiveScore: number;
    negativeScore: number;
    mixedScore: number;
    unknownScore: number;
    positivePacketCount: number;
    negativePacketCount: number;
    mixedPacketCount: number;
    unknownPacketCount: number;
    topPositivePackets: string[];
    topNegativePackets: string[];
    topMixedPackets: string[];
    summary: string;
  };
  market?: MarketSnapshot;
  fundamentals?: FundamentalSnapshot;
  signalCounts: Record<SignalTier, number>;
  topSignals: SignalItemSummary[];
  evidencePackets: Array<
    EvidencePacket & {
      evidence: EvaluatorEvidenceItem[];
    }
  >;
  sourceCoverage: Array<{
    category: string;
    sources: string[];
    rawItemCount: number;
    diagnosticItemCount: number;
    okSteps: number;
    partialSteps: number;
    failedSteps: number;
  }>;
  dataQuality: string[];
  sourceDiagnostics: Array<{
    source: string;
    status: SourceDiagnostic["status"];
    itemCount: number;
    message?: string;
  }>;
  changeSummary?: {
    previousRunId?: number;
    currentItemCount: number;
    previousItemCount: number;
    newItemCount: number;
    reusedItemCount: number;
    cacheNewItemCount: number;
    droppedItemCount: number;
    newSources: string[];
    droppedSources: string[];
  };
};

export type IntelReport = {
  id?: number;
  horizon: IntelHorizon;
  generatedAt: Date;
  universeSummary: string;
  telegramSummary: string;
  executiveSummary: string;
  html: string;
  stocks: StockIntel[];
  events: IntelEventCluster[];
  deepResearch?: DeepResearchData;
  evaluatorPacket?: EvaluatorPacket;
  file?: ReportFile;
  evaluatorFile?: ReportFile;
};
