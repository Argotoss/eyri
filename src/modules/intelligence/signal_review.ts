import { recordModelUsage } from "./model_usage.ts";
import type {
  IntelHorizon,
  IntelRawItem,
  ItemDistillation,
  SignalTier,
} from "./types.ts";

type OpenRouterMessage = {
  role: "system" | "user";
  content: string;
};

type ModelSignalReview = {
  rawItemId?: unknown;
  signalTier?: unknown;
  signalScore?: unknown;
  reasons?: unknown;
  noiseReason?: unknown;
  summary?: unknown;
};

type ModelSignalReviewResponse = {
  reviews?: ModelSignalReview[];
};

const SIGNAL_TIERS: SignalTier[] = [
  "critical",
  "high",
  "medium",
  "low",
  "noise",
];

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envBoolean(name: string, fallback: boolean) {
  const value = Deno.env.get(name)?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value);
}

function modelName() {
  return (
    Deno.env.get("INTEL_SIGNAL_MODEL")?.trim() ||
    Deno.env.get("INTEL_EXTRACT_MODEL")?.trim() ||
    "deepseek/deepseek-v4-flash"
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseJsonObject(value: string): ModelSignalReviewResponse | null {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as ModelSignalReviewResponse;
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[0]) as ModelSignalReviewResponse;
    } catch {
      return null;
    }
  }
}

async function callOpenRouterJson(
  messages: OpenRouterMessage[],
): Promise<ModelSignalReviewResponse | null> {
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
          "X-Title": "Eyri Signal Review",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.05,
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      },
    );
    if (!response.ok) {
      console.error(`OpenRouter signal review failed ${response.status}`);
      return null;
    }
    const data = await response.json();
    recordModelUsage({
      stage: "deep_signal_review",
      model,
      usage: data?.usage,
    });
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? parseJsonObject(content) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function compactCandidates(args: {
  distillations: ItemDistillation[];
  rawItems: IntelRawItem[];
  limit: number;
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  return args.distillations
    .slice()
    .sort((left, right) => right.signalScore - left.signalScore)
    .slice(0, args.limit)
    .map((item) => {
      const raw = rawById.get(item.rawItemId);
      return {
        rawItemId: item.rawItemId,
        title: raw?.title ?? item.summary,
        source: raw?.source ?? "unknown",
        sourceType: raw?.sourceType ?? "unknown",
        publishedAt: raw?.publishedAt.toISOString(),
        topic: item.topic,
        ruleTier: item.signalTier,
        ruleScore: item.signalScore,
        ruleReasons: item.signalReasons,
        text: `${raw?.title ?? ""}\n${raw?.body ?? item.summary}`.slice(0, 900),
      };
    });
}

function validateReview(review: ModelSignalReview, allowedIds: Set<number>) {
  const rawItemId = Number(review.rawItemId);
  if (!Number.isInteger(rawItemId) || !allowedIds.has(rawItemId)) {
    return null;
  }
  const signalTier =
    typeof review.signalTier === "string" &&
    SIGNAL_TIERS.includes(review.signalTier as SignalTier)
      ? (review.signalTier as SignalTier)
      : undefined;
  const signalScore = clamp(Math.round(Number(review.signalScore)), 0, 100);
  if (!signalTier || !Number.isFinite(signalScore)) {
    return null;
  }
  const reasons = Array.isArray(review.reasons)
    ? review.reasons
        .filter((reason): reason is string => typeof reason === "string")
        .map((reason) => reason.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const noiseReason =
    typeof review.noiseReason === "string" && review.noiseReason.trim()
      ? review.noiseReason.trim()
      : undefined;
  const summary =
    typeof review.summary === "string" && review.summary.trim()
      ? review.summary.trim().slice(0, 420)
      : undefined;

  return {
    rawItemId,
    signalTier,
    signalScore,
    reasons,
    noiseReason,
    summary,
  };
}

export function applySignalReviews(
  distillations: ItemDistillation[],
  reviews: ModelSignalReview[],
) {
  const allowedIds = new Set(distillations.map((item) => item.rawItemId));
  const byId = new Map(
    reviews
      .map((review) => validateReview(review, allowedIds))
      .filter((review): review is NonNullable<typeof review> => review !== null)
      .map((review) => [review.rawItemId, review]),
  );

  return distillations.map((item) => {
    const review = byId.get(item.rawItemId);
    if (!review) {
      return item;
    }
    const signalReasons = [
      "model-reviewed",
      ...review.reasons,
      ...item.signalReasons.filter((reason) => reason !== "model-reviewed"),
    ].slice(0, 6);
    return {
      ...item,
      signalTier: review.signalTier,
      signalScore: review.signalScore,
      signalReasons,
      noiseReason:
        review.signalTier === "noise"
          ? (review.noiseReason ??
            item.noiseReason ??
            "model rejected as noise")
          : undefined,
      summary: review.summary ?? item.summary,
      whyItMatters:
        review.signalScore >= 72
          ? "Model-reviewed catalyst or market signal with potential short-term relevance."
          : item.whyItMatters,
    };
  });
}

export async function reviewItemSignals(args: {
  distillations: ItemDistillation[];
  rawItems: IntelRawItem[];
  ticker: string;
  horizon: IntelHorizon;
}) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const enabled = envBoolean("INTEL_SIGNAL_REVIEW_ENABLED", Boolean(apiKey));
  if (!enabled || !apiKey || args.distillations.length === 0) {
    return args.distillations;
  }

  const limit = envNumber("INTEL_SIGNAL_REVIEW_LIMIT", 45);
  const candidates = compactCandidates({
    distillations: args.distillations,
    rawItems: args.rawItems,
    limit,
  });
  if (candidates.length === 0) {
    return args.distillations;
  }

  const response = await callOpenRouterJson([
    {
      role: "system",
      content:
        'You review stock-research raw items for a trader. Return strict JSON only: {"reviews":[...]}. Use only provided item IDs. Assign signalTier as critical, high, medium, low, or noise. Critical/high means concrete near-term evidence; noise means irrelevant, duplicate-like, routine, or vague. Include signalScore 0-100 and 1-5 short reasons. Do not make buy/sell recommendations.',
    },
    {
      role: "user",
      content: JSON.stringify({
        ticker: args.ticker,
        horizon: args.horizon,
        candidates,
      }),
    },
  ]);

  return applySignalReviews(args.distillations, response?.reviews ?? []);
}
