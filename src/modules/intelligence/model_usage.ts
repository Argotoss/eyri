import type { ModelUsage } from "./types.ts";

type UsagePayload = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  cost?: unknown;
  cost_usd?: unknown;
};

const pendingUsages: ModelUsage[] = [];

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function modelPricing(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.includes("deepseek/deepseek-v4-flash")) {
    return { inputPerMillion: 0.0983, outputPerMillion: 0.1966 };
  }
  if (normalized.includes("openai/gpt-5.4-mini")) {
    return { inputPerMillion: 0.75, outputPerMillion: 4.5 };
  }
  return null;
}

function estimatedCostUsd(model: string, usage: UsagePayload) {
  const pricing = modelPricing(model);
  const inputTokens = toNumber(usage.prompt_tokens);
  const outputTokens = toNumber(usage.completion_tokens);
  if (!pricing || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

export function recordModelUsage(args: {
  stage: string;
  model: string;
  usage?: UsagePayload | null;
}) {
  if (!args.usage) {
    return;
  }

  const inputTokens = toNumber(args.usage.prompt_tokens);
  const outputTokens = toNumber(args.usage.completion_tokens);
  const totalTokens =
    toNumber(args.usage.total_tokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const costUsd =
    toNumber(args.usage.cost_usd) ??
    toNumber(args.usage.cost) ??
    estimatedCostUsd(args.model, args.usage);

  pendingUsages.push({
    stage: args.stage,
    model: args.model,
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    createdAt: new Date(),
  });
}

export function consumeModelUsages() {
  return pendingUsages.splice(0, pendingUsages.length);
}
