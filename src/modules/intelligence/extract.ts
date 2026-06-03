import type {
  DirectionHint,
  EventType,
  EventUrgency,
  IntelEventCandidate,
  IntelHorizon,
  IntelRawItem,
  TickerMention,
} from "./types.ts";
import { recordModelUsage } from "./model_usage.ts";

type OpenRouterMessage = {
  role: "system" | "user";
  content: string;
};

type ModelEvent = {
  ticker?: unknown;
  title?: unknown;
  eventType?: unknown;
  directionHint?: unknown;
  urgency?: unknown;
  horizon?: unknown;
  summary?: unknown;
  evidenceItemIds?: unknown;
  confidence?: unknown;
};

type ModelResponse = {
  events?: ModelEvent[];
};

const EVENT_TYPES: EventType[] = [
  "earnings",
  "guidance",
  "analyst_action",
  "sec_filing",
  "m_and_a",
  "legal_regulatory",
  "management_change",
  "major_contract",
  "product_launch",
  "supply_chain",
  "macro_sector",
  "unusual_price_volume",
  "other",
];

const DIRECTIONS: DirectionHint[] = [
  "positive",
  "negative",
  "mixed",
  "unknown",
];
const URGENCIES: EventUrgency[] = ["low", "medium", "high"];

const GENERIC_EVENT_SUMMARIES = [
  "potential market-moving event",
  "market-moving event",
  "potential catalyst",
  "stock-market catalyst",
  "no summary",
];

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function textForItem(item: IntelRawItem) {
  return `${item.title}\n${item.body ?? ""}`.toLowerCase();
}

export function isGenericEventSummary(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
  return (
    normalized.length < 18 ||
    GENERIC_EVENT_SUMMARIES.some((generic) => normalized.includes(generic))
  );
}

export function classifyEventType(text: string): EventType {
  const value = text.toLowerCase();
  if (/\b(earnings|eps|quarterly results|q[1-4] results)\b/.test(value)) {
    return "earnings";
  }
  if (
    /\b(guidance|outlook|forecast|raises forecast|cuts forecast)\b/.test(value)
  ) {
    return "guidance";
  }
  if (/\b(upgrade|downgrade|price target|initiates|analyst)\b/.test(value)) {
    return "analyst_action";
  }
  if (/\b(8-k|10-q|10-k|s-1|sc 13|form 4|filed)\b/.test(value)) {
    return "sec_filing";
  }
  if (/\b(acquire|acquisition|merger|takeover|buyout|m&a)\b/.test(value)) {
    return "m_and_a";
  }
  if (
    /\b(lawsuit|probe|investigation|sec investigation|ftc|doj|regulator|ban|tariff|sanction)\b/.test(
      value,
    )
  ) {
    return "legal_regulatory";
  }
  if (/\b(ceo|cfo|resigns|steps down|appoints|management)\b/.test(value)) {
    return "management_change";
  }
  if (/\b(contract|deal|partnership|customer|order|award)\b/.test(value)) {
    return "major_contract";
  }
  if (
    /\b(launch|product|approval|fda approval|release|chip|model)\b/.test(value)
  ) {
    return "product_launch";
  }
  if (/\b(shortage|supply|demand|inventory|pricing|capacity)\b/.test(value)) {
    return "supply_chain";
  }
  if (
    /\b(fed|cpi|inflation|rates|jobs report|treasury|oil|sector)\b/.test(value)
  ) {
    return "macro_sector";
  }
  if (
    /\b(volume|surges|jumps|plunges|rallies|slides|premarket|after-hours)\b/.test(
      value,
    )
  ) {
    return "unusual_price_volume";
  }
  return "other";
}

function inferDirection(text: string): DirectionHint {
  const value = text.toLowerCase();
  const positive =
    /\b(beat|raises|raised|upgrade|surge|rally|approval|wins|record|strong|growth)\b/.test(
      value,
    );
  const negative =
    /\b(miss|cuts|cut|downgrade|falls|plunge|lawsuit|probe|weak|delay|ban)\b/.test(
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

function inferUrgency(item: IntelRawItem, eventType: EventType): EventUrgency {
  const ageHours = (Date.now() - item.publishedAt.getTime()) / 3_600_000;
  if (
    ageHours <= 12 &&
    [
      "earnings",
      "guidance",
      "legal_regulatory",
      "m_and_a",
      "sec_filing",
      "unusual_price_volume",
    ].includes(eventType)
  ) {
    return "high";
  }
  if (ageHours <= 48 || eventType !== "other") {
    return "medium";
  }
  return "low";
}

function itemMentionsById(mentions: TickerMention[]) {
  const byId = new Map<number, TickerMention[]>();
  for (const mention of mentions) {
    const list = byId.get(mention.rawItemId) ?? [];
    list.push(mention);
    byId.set(mention.rawItemId, list);
  }
  return byId;
}

export function createRuleBasedEvents(
  items: IntelRawItem[],
  mentions: TickerMention[],
  horizon: IntelHorizon,
): IntelEventCandidate[] {
  const mentionsById = itemMentionsById(mentions);
  const events: IntelEventCandidate[] = [];

  for (const item of items) {
    const itemMentions = mentionsById.get(item.id) ?? [];
    if (itemMentions.length === 0) {
      continue;
    }

    const text = textForItem(item);
    const eventType =
      item.sourceType === "sec_filing" ? "sec_filing" : classifyEventType(text);
    const directionHint = inferDirection(text);
    for (const mention of itemMentions) {
      events.push({
        ticker: normalizeTicker(mention.ticker),
        eventType,
        directionHint,
        urgency: inferUrgency(item, eventType),
        horizon,
        title: item.title,
        summary: item.body?.split("\n").find(Boolean) ?? item.title,
        evidenceItemIds: [item.id],
        confidence: Math.min(mention.confidence, 0.9),
      });
    }
  }

  return events;
}

function modelName() {
  return (
    Deno.env.get("INTEL_EXTRACT_MODEL")?.trim() || "deepseek/deepseek-v4-flash"
  );
}

function parseJsonObject(value: string): ModelResponse | null {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as ModelResponse;
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[0]) as ModelResponse;
    } catch {
      return null;
    }
  }
}

async function callOpenRouterJson(
  messages: OpenRouterMessage[],
  stage: string,
) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return null;
  }

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
          "X-Title": "Eyri Market Intelligence",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      },
    );
    if (!response.ok) {
      console.error(`OpenRouter extraction failed ${response.status}`);
      return null;
    }

    const data = await response.json();
    recordModelUsage({ stage, model, usage: data?.usage });
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? parseJsonObject(content) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function compactItems(
  items: IntelRawItem[],
  mentions: TickerMention[],
  limit = 60,
) {
  const mentionsById = itemMentionsById(mentions);
  return items
    .filter((item) => (mentionsById.get(item.id)?.length ?? 0) > 0)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      sourceType: item.sourceType,
      publishedAt: item.publishedAt.toISOString(),
      tickers: (mentionsById.get(item.id) ?? []).map(
        (mention) => mention.ticker,
      ),
      text: `${item.title}\n${item.body ?? ""}`.slice(0, 900),
    }));
}

function validateModelEvent(
  event: ModelEvent,
  itemsById: Map<number, IntelRawItem>,
  horizon: IntelHorizon,
): IntelEventCandidate | null {
  const ticker =
    typeof event.ticker === "string" ? normalizeTicker(event.ticker) : "";
  const eventType =
    typeof event.eventType === "string" &&
    EVENT_TYPES.includes(event.eventType as EventType)
      ? (event.eventType as EventType)
      : "other";
  const directionHint =
    typeof event.directionHint === "string" &&
    DIRECTIONS.includes(event.directionHint as DirectionHint)
      ? (event.directionHint as DirectionHint)
      : "unknown";
  const urgency =
    typeof event.urgency === "string" &&
    URGENCIES.includes(event.urgency as EventUrgency)
      ? (event.urgency as EventUrgency)
      : "medium";
  const evidenceItemIds = Array.isArray(event.evidenceItemIds)
    ? event.evidenceItemIds
        .map((id) => Number(id))
        .filter((id) => itemsById.has(id))
    : [];
  if (!ticker || evidenceItemIds.length === 0) {
    return null;
  }

  const summary =
    typeof event.summary === "string" && event.summary.trim()
      ? event.summary.trim()
      : "";
  if (isGenericEventSummary(summary)) {
    return null;
  }
  const firstEvidenceItem = itemsById.get(evidenceItemIds[0]);
  const title =
    typeof event.title === "string" && !isGenericEventSummary(event.title)
      ? event.title.trim()
      : (firstEvidenceItem?.title ?? summary);
  const confidence = Number(event.confidence);

  return {
    ticker,
    eventType,
    directionHint,
    urgency,
    horizon,
    title,
    summary,
    evidenceItemIds,
    confidence: Number.isFinite(confidence) ? Math.min(confidence, 1) : 0.75,
  };
}

export async function extractEvents(
  items: IntelRawItem[],
  mentions: TickerMention[],
  horizon: IntelHorizon,
) {
  const fallbackEvents = createRuleBasedEvents(items, mentions, horizon);
  const compact = compactItems(items, mentions);
  if (compact.length === 0) {
    return fallbackEvents;
  }

  const modelResponse = await callOpenRouterJson(
    [
      {
        role: "system",
        content:
          'You extract stock-market catalyst events from raw source items. Return strict JSON only: {"events":[...]}. Every event must cite evidenceItemIds from the provided IDs and must include a specific title and summary. Do not make buy/sell recommendations.',
      },
      {
        role: "user",
        content: JSON.stringify({
          horizon,
          allowedEventTypes: EVENT_TYPES,
          allowedDirections: DIRECTIONS,
          allowedUrgencies: URGENCIES,
          items: compact,
        }),
      },
    ],
    "extract",
  );

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const modelEvents = (modelResponse?.events ?? [])
    .map((event) => validateModelEvent(event, itemsById, horizon))
    .filter((event): event is IntelEventCandidate => event !== null);

  return modelEvents.length > 0 ? modelEvents : fallbackEvents;
}

export async function extractEventsForDeepResearch(
  items: IntelRawItem[],
  mentions: TickerMention[],
  horizon: IntelHorizon,
) {
  const fallbackEvents = createRuleBasedEvents(items, mentions, horizon);
  const limit = envNumber("INTEL_DEEP_EXTRACT_ITEM_LIMIT", 180);
  const chunkSize = envNumber("INTEL_DEEP_EXTRACT_CHUNK_SIZE", 35);
  const compact = compactItems(items, mentions, limit);
  if (compact.length === 0) {
    return fallbackEvents;
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const modelEvents: IntelEventCandidate[] = [];
  for (let index = 0; index < compact.length; index += chunkSize) {
    const chunk = compact.slice(index, index + chunkSize);
    const modelResponse = await callOpenRouterJson(
      [
        {
          role: "system",
          content:
            'You extract stock-market catalyst events from one ticker research items. Return strict JSON only: {"events":[...]}. Every event must cite evidenceItemIds from the provided IDs and must include a specific title and summary. Prefer concrete facts, numbers, analyst changes, earnings/guidance, supply/demand, legal/regulatory, product/customer, and market-reaction evidence. Do not make buy/sell recommendations.',
        },
        {
          role: "user",
          content: JSON.stringify({
            horizon,
            allowedEventTypes: EVENT_TYPES,
            allowedDirections: DIRECTIONS,
            allowedUrgencies: URGENCIES,
            items: chunk,
          }),
        },
      ],
      "deep_extract",
    );

    modelEvents.push(
      ...(modelResponse?.events ?? [])
        .map((event) => validateModelEvent(event, itemsById, horizon))
        .filter((event): event is IntelEventCandidate => event !== null),
    );
  }

  if (modelEvents.length === 0) {
    return fallbackEvents;
  }

  const modelEvidence = new Set(
    modelEvents.flatMap((event) => event.evidenceItemIds),
  );
  const uncoveredFallback = fallbackEvents.filter((event) =>
    event.evidenceItemIds.every((id) => !modelEvidence.has(id)),
  );
  return [...modelEvents, ...uncoveredFallback];
}
