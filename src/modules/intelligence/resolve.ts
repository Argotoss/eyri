import type { IntelRawItem, TickerMention, UniverseEntry } from "./types.ts";

const AMBIGUOUS_TICKERS = new Set([
  "A",
  "AI",
  "ALL",
  "AM",
  "AN",
  "ARE",
  "C",
  "F",
  "HAS",
  "IT",
  "KEY",
  "LIFE",
  "NDAQ",
  "NOW",
  "ON",
  "OR",
  "PM",
  "T",
  "V",
]);

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9$.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemText(item: IntelRawItem) {
  return `${item.title}\n${item.body ?? ""}`
    .split(/\r?\n/)
    .filter((line) => !/^\s*query:\s*ticker:/i.test(line))
    .join("\n");
}

function hasTicker(text: string, ticker: string) {
  const escaped = escapeRegExp(ticker);
  const regex = new RegExp(`(^|[^A-Z0-9.])${escaped}([^A-Z0-9.]|$)`);
  return regex.test(text) || hasCashTicker(text, ticker);
}

function hasCashTicker(text: string, ticker: string) {
  const escaped = escapeRegExp(ticker);
  const regex = new RegExp(`\\$${escaped}([^A-Z0-9.]|$)`, "i");
  return regex.test(text);
}

function hasCompanyName(normalizedText: string, entry: UniverseEntry) {
  const haystack = ` ${normalizedText} `;
  return [entry.name, ...entry.aliases]
    .filter((alias) => alias.length >= 4)
    .some((alias) => haystack.includes(` ${normalizeText(alias)} `));
}

function isExchangeOnlyCompanyMatch(text: string, entry: UniverseEntry) {
  if (entry.ticker !== "NDAQ") {
    return false;
  }

  const explicitCompany = /\bnasdaq\s+(inc|omx|stock market)\b/i.test(text);
  return !explicitCompany && /\bnasdaq\s*:/i.test(text);
}

function mentionConfidence(
  text: string,
  normalizedText: string,
  entry: UniverseEntry,
) {
  const ticker = normalizeTicker(entry.ticker);
  const sourceBoost = entry.priority >= 80 ? 0.05 : 0;
  const companyMatched =
    hasCompanyName(normalizedText, entry) &&
    !isExchangeOnlyCompanyMatch(text, entry);
  const tickerMatched = hasTicker(text, ticker);

  if (companyMatched && tickerMatched) {
    return { confidence: 0.95 + sourceBoost, method: "company" as const };
  }
  if (companyMatched) {
    return { confidence: 0.82 + sourceBoost, method: "company" as const };
  }
  if (tickerMatched && hasCashTicker(text, ticker)) {
    return { confidence: 0.86 + sourceBoost, method: "ticker" as const };
  }
  if (tickerMatched && !AMBIGUOUS_TICKERS.has(ticker)) {
    return { confidence: 0.72 + sourceBoost, method: "ticker" as const };
  }

  return null;
}

export function resolveRawItemMentions(
  item: IntelRawItem,
  universe: UniverseEntry[],
): TickerMention[] {
  const text = itemText(item);
  const normalizedText = normalizeText(text);
  const sourceTickers = (item.tickers ?? []).map(normalizeTicker);
  const byTicker = new Map<string, TickerMention>();

  for (const ticker of sourceTickers) {
    byTicker.set(ticker, {
      rawItemId: item.id,
      ticker,
      confidence: 1,
      method: "source",
    });
  }

  for (const entry of universe) {
    const ticker = normalizeTicker(entry.ticker);
    if (byTicker.has(ticker)) {
      continue;
    }

    const match = mentionConfidence(text, normalizedText, entry);
    if (!match) {
      continue;
    }

    byTicker.set(ticker, {
      rawItemId: item.id,
      ticker,
      confidence: Math.min(match.confidence, 1),
      method: match.method,
    });
  }

  return [...byTicker.values()].filter((mention) => mention.confidence >= 0.7);
}

export function resolveMentionsForItems(
  items: IntelRawItem[],
  universe: UniverseEntry[],
) {
  return items.flatMap((item) => resolveRawItemMentions(item, universe));
}
