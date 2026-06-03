import type {
  IntelEventCandidate,
  IntelEventCluster,
  IntelRawItem,
} from "./types.ts";

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|and|or|to|of|in|on|for|with|after|before)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join("-");
}

function evidenceKey(event: IntelEventCandidate) {
  return [...new Set(event.evidenceItemIds)].sort((a, b) => a - b).join(",");
}

export function clusterKeyForEvent(event: IntelEventCandidate) {
  return [
    normalizeTicker(event.ticker),
    event.eventType,
    normalizeTitle(event.title || event.summary),
  ].join(":");
}

export function clusterEvents(
  events: IntelEventCandidate[],
  rawItems: IntelRawItem[],
): IntelEventCluster[] {
  const itemsById = new Map(rawItems.map((item) => [item.id, item]));
  const byKey = new Map<string, IntelEventCluster>();

  for (const event of events) {
    const uniqueEvidenceIds = [...new Set(event.evidenceItemIds)];
    const firstItem = itemsById.get(uniqueEvidenceIds[0]);
    const latestPublishedAt = uniqueEvidenceIds
      .map((id) => itemsById.get(id)?.publishedAt)
      .filter((date): date is Date => date instanceof Date)
      .reduce(
        (latest, date) => (date > latest ? date : latest),
        firstItem?.publishedAt ?? new Date(0),
      );
    const key = clusterKeyForEvent(event);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...event,
        ticker: normalizeTicker(event.ticker),
        evidenceItemIds: uniqueEvidenceIds,
        clusterKey: key,
        sourceCount: uniqueEvidenceIds.length,
        latestPublishedAt,
        score: 0,
        scoreReasons: [],
      });
      continue;
    }

    const mergedEvidenceIds = [
      ...new Set([...existing.evidenceItemIds, ...uniqueEvidenceIds]),
    ];
    existing.evidenceItemIds = mergedEvidenceIds;
    existing.sourceCount = mergedEvidenceIds.length;
    existing.confidence = Math.max(existing.confidence, event.confidence);
    existing.latestPublishedAt =
      latestPublishedAt > existing.latestPublishedAt
        ? latestPublishedAt
        : existing.latestPublishedAt;
    if (event.urgency === "high" || existing.urgency === "low") {
      existing.urgency = event.urgency;
    }
    if (event.summary.length > existing.summary.length) {
      existing.summary = event.summary;
    }
  }

  const seen = new Set<string>();
  return [...byKey.values()].filter((event) => {
    const duplicateKey = `${event.ticker}:${event.eventType}:${evidenceKey(
      event,
    )}`;
    if (seen.has(duplicateKey)) {
      return false;
    }
    seen.add(duplicateKey);
    return true;
  });
}
