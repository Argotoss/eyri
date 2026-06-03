import type { IntelRawItemInput } from "./types.ts";

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const param of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "guccounter",
    ]) {
      url.searchParams.delete(param);
    }
    return url.toString().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|and|or|to|of|in|on|for|with|after|before)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rawItemDedupeKey(item: IntelRawItemInput) {
  if (item.url) {
    return `url:${normalizeUrl(item.url)}`;
  }
  if (item.sourceId) {
    return `source:${item.source}:${item.sourceId}`;
  }
  return `title:${normalizeTitle(item.title)}:${item.publishedAt.toISOString().slice(0, 10)}`;
}

export function dedupeRawItemInputs(items: IntelRawItemInput[]) {
  const seen = new Set<string>();
  const deduped: IntelRawItemInput[] = [];
  let duplicateCount = 0;
  for (const item of items) {
    const key = rawItemDedupeKey(item);
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return { items: deduped, duplicateCount };
}
