import { applySignalReviews } from "./signal_review.ts";
import type { ItemDistillation } from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("applySignalReviews updates valid model-reviewed tiers", () => {
  const now = new Date();
  const base: ItemDistillation[] = [
    {
      rawItemId: 1,
      ticker: "MU",
      topic: "earnings_guidance",
      signalTier: "medium",
      signalScore: 66,
      signalReasons: ["moderate catalyst language"],
      relevance: 90,
      novelty: 80,
      sourceQuality: 82,
      catalystStrength: 60,
      riskSeverity: 5,
      direction: "positive",
      timeSensitivity: "1d",
      summary: "Micron guidance improved.",
      whyItMatters: "Useful background only if it supports stronger evidence.",
      keyFacts: [],
      createdAt: now,
    },
    {
      rawItemId: 2,
      ticker: "MU",
      topic: "social_sentiment",
      signalTier: "low",
      signalScore: 40,
      signalReasons: ["topic: social sentiment"],
      relevance: 70,
      novelty: 90,
      sourceQuality: 42,
      catalystStrength: 25,
      riskSeverity: 8,
      direction: "unknown",
      timeSensitivity: "low",
      summary: "Social chatter.",
      whyItMatters: "Useful background only if it supports stronger evidence.",
      keyFacts: [],
      createdAt: now,
    },
  ];

  const reviewed = applySignalReviews(base, [
    {
      rawItemId: 1,
      signalTier: "critical",
      signalScore: 91,
      reasons: ["specific guidance", "fresh primary catalyst"],
      summary: "Guidance changed enough to matter near term.",
    },
    {
      rawItemId: 2,
      signalTier: "noise",
      signalScore: 18,
      reasons: ["vague chatter"],
      noiseReason: "model rejected vague social chatter",
    },
    {
      rawItemId: 999,
      signalTier: "critical",
      signalScore: 100,
      reasons: ["invalid id"],
    },
  ]);

  assert(reviewed[0].signalTier === "critical", "expected critical upgrade");
  assert(reviewed[0].signalScore === 91, "expected model score");
  assert(
    reviewed[0].signalReasons[0] === "model-reviewed",
    "expected model-reviewed reason marker",
  );
  assert(
    reviewed[0].summary === "Guidance changed enough to matter near term.",
    "expected model summary",
  );
  assert(reviewed[1].signalTier === "noise", "expected noise downgrade");
  assert(
    reviewed[1].noiseReason === "model rejected vague social chatter",
    "expected model noise reason",
  );
});
