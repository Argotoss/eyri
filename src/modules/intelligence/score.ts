import type {
  EventType,
  IntelEventCluster,
  MarketSnapshot,
  UniverseEntry,
} from "./types.ts";

const EVENT_WEIGHTS: Record<EventType, number> = {
  earnings: 20,
  guidance: 24,
  analyst_action: 12,
  sec_filing: 15,
  m_and_a: 24,
  legal_regulatory: 22,
  management_change: 13,
  major_contract: 18,
  product_launch: 13,
  supply_chain: 17,
  macro_sector: 10,
  unusual_price_volume: 19,
  other: 5,
};

function recencyScore(date: Date) {
  const ageHours = Math.max(0, (Date.now() - date.getTime()) / 3_600_000);
  if (ageHours <= 6) {
    return 20;
  }
  if (ageHours <= 24) {
    return 16;
  }
  if (ageHours <= 72) {
    return 10;
  }
  return 5;
}

function universeBoost(entry?: UniverseEntry) {
  if (!entry) {
    return { score: 0, reasons: [] as string[] };
  }

  const reasons: string[] = [];
  let score = 0;
  if (entry.sources.includes("portfolio")) {
    score += 18;
    reasons.push("portfolio");
  }
  if (entry.sources.includes("watchlist")) {
    score += 14;
    reasons.push("watchlist");
  }
  if (entry.sources.includes("sp500")) {
    score += 5;
  }

  return { score, reasons };
}

function marketBoost(snapshot?: MarketSnapshot) {
  if (!snapshot) {
    return { score: 0, reasons: [] as string[] };
  }

  const reasons: string[] = [];
  let score = 0;
  const move = Math.abs(snapshot.percentChange ?? 0);
  if (move >= 8) {
    score += 18;
    reasons.push(`${snapshot.percentChange?.toFixed(1)}% move`);
  } else if (move >= 4) {
    score += 12;
    reasons.push(`${snapshot.percentChange?.toFixed(1)}% move`);
  } else if (move >= 2) {
    score += 7;
    reasons.push(`${snapshot.percentChange?.toFixed(1)}% move`);
  }

  if ((snapshot.volumeRatio ?? 0) >= 2) {
    score += 10;
    reasons.push(`${snapshot.volumeRatio?.toFixed(1)}x volume`);
  } else if ((snapshot.volumeRatio ?? 0) >= 1.4) {
    score += 5;
    reasons.push(`${snapshot.volumeRatio?.toFixed(1)}x volume`);
  }

  return { score, reasons };
}

export function scoreEvent(
  event: IntelEventCluster,
  universeEntry?: UniverseEntry,
  snapshot?: MarketSnapshot,
) {
  const reasons: string[] = [];
  let score =
    EVENT_WEIGHTS[event.eventType] + recencyScore(event.latestPublishedAt);
  reasons.push(event.eventType.replaceAll("_", " "));

  if (event.urgency === "high") {
    score += 12;
    reasons.push("high urgency");
  } else if (event.urgency === "medium") {
    score += 6;
  }

  if (event.sourceCount >= 3) {
    score += 8;
    reasons.push(`${event.sourceCount} sources`);
  } else if (event.sourceCount === 2) {
    score += 4;
    reasons.push("2 sources");
  }

  score += Math.round(event.confidence * 8);
  const universe = universeBoost(universeEntry);
  score += universe.score;
  reasons.push(...universe.reasons);
  const market = marketBoost(snapshot);
  score += market.score;
  reasons.push(...market.reasons);

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: [...new Set(reasons)].slice(0, 5),
  };
}

export function rankEvents(
  events: IntelEventCluster[],
  universe: UniverseEntry[],
  snapshots: MarketSnapshot[],
) {
  const universeByTicker = new Map(
    universe.map((entry) => [entry.ticker, entry]),
  );
  const snapshotsByTicker = new Map(
    snapshots.map((snapshot) => [snapshot.ticker, snapshot]),
  );

  return events
    .map((event) => {
      const scored = scoreEvent(
        event,
        universeByTicker.get(event.ticker),
        snapshotsByTicker.get(event.ticker),
      );
      return {
        ...event,
        score: scored.score,
        scoreReasons: scored.reasons,
      };
    })
    .sort((eventA, eventB) => {
      if (eventA.score !== eventB.score) {
        return eventB.score - eventA.score;
      }
      return (
        eventB.latestPublishedAt.getTime() - eventA.latestPublishedAt.getTime()
      );
    });
}
