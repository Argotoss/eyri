import type { User } from "../database/user.ts";

export const INTEL_HORIZONS = ["1d", "3d", "14d"] as const;

export type IntelHorizon = (typeof INTEL_HORIZONS)[number];

export type UniverseSource = "portfolio" | "watchlist" | "sp500";

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

export type IntelRawItemInput = {
  source: string;
  sourceType: SourceType;
  sourceId: string;
  title: string;
  url?: string;
  publishedAt: Date;
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
  volume?: number;
  averageVolume?: number;
  volumeRatio?: number;
  provider?: string;
  sourceTicker?: string;
  fetchedAt: Date;
};

export type IntelReport = {
  id?: number;
  horizon: IntelHorizon;
  generatedAt: Date;
  universeSummary: string;
  telegramSummary: string;
  executiveSummary: string;
  html: string;
  events: IntelEventCluster[];
};
