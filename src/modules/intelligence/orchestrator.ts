import { clusterEvents } from "./dedupe.ts";
import { extractEvents } from "./extract.ts";
import { buildIntelReport } from "./report.ts";
import { resolveMentionsForItems } from "./resolve.ts";
import { rankEvents } from "./score.ts";
import { collectGdeltItems } from "./sources/gdelt.ts";
import { collectMarketSnapshots } from "./sources/prices.ts";
import { collectSecItems } from "./sources/sec.ts";
import {
  createSourceRun,
  finishSourceRun,
  saveMarketSnapshots,
  saveRawItems,
  saveReport,
  saveSourceDiagnostics,
  saveTickerMentions,
} from "./storage.ts";
import type {
  IntelRawItemInput,
  IntelligenceRunArgs,
  SourceDiagnostic,
  UniverseEntry,
} from "./types.ts";
import { buildUniverse, summarizeUniverse } from "./universe.ts";

function uniqueRawItems(items: IntelRawItemInput[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.sourceId}:${item.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function candidateSnapshotTickers(
  universe: UniverseEntry[],
  candidateTickers: string[],
) {
  const priorityTickers = universe
    .filter(
      (entry) =>
        entry.sources.includes("portfolio") ||
        entry.sources.includes("watchlist"),
    )
    .map((entry) => entry.ticker);
  return [...new Set([...candidateTickers, ...priorityTickers])];
}

export async function runIntelligenceReport({
  database,
  chatId,
  user,
  horizon,
}: IntelligenceRunArgs) {
  const runId = createSourceRun(database, chatId, horizon);
  try {
    console.log(`[intel] run ${runId} started (${horizon}) chat=${chatId}`);
    const universe = await buildUniverse(database, chatId, user);
    const universeSummary = summarizeUniverse(universe);
    const [secResult, gdeltResult] = await Promise.all([
      collectSecItems(universe, horizon),
      collectGdeltItems(universe, horizon),
    ]);
    const sourceDiagnostics = [
      ...secResult.diagnostics,
      ...gdeltResult.diagnostics,
    ];
    saveSourceDiagnostics(database, runId, sourceDiagnostics);
    console.log(
      `[intel] run ${runId} sources: ${sourceDiagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.source}/${diagnostic.label}=${diagnostic.status}:${diagnostic.itemCount}`,
        )
        .join(", ")}`,
    );
    const rawItems = await saveRawItems(
      database,
      uniqueRawItems([...secResult.items, ...gdeltResult.items]),
    );
    const mentions = resolveMentionsForItems(rawItems, universe);
    saveTickerMentions(database, mentions);
    const extractedEvents = await extractEvents(rawItems, mentions, horizon);
    const clusters = clusterEvents(extractedEvents, rawItems);
    const tickers = candidateSnapshotTickers(
      universe,
      clusters.map((cluster) => cluster.ticker),
    );
    const priceStartedAt = new Date();
    const snapshots = await collectMarketSnapshots(tickers, horizon);
    saveMarketSnapshots(database, snapshots);
    const priceDiagnostic: SourceDiagnostic = {
      source: "prices",
      label: "candidate-market-snapshots",
      status: snapshots.length === 0 ? "failed" : "ok",
      itemCount: snapshots.length,
      startedAt: priceStartedAt,
      completedAt: new Date(),
      metadata: {
        requestedTickers: tickers,
        returnedTickers: snapshots.map((snapshot) => snapshot.ticker),
      },
    };
    saveSourceDiagnostics(database, runId, [priceDiagnostic]);
    console.log(
      `[intel] run ${runId} prices: ${snapshots.length}/${tickers.length}`,
    );

    const rankedEvents = rankEvents(clusters, universe, snapshots).slice(0, 30);
    const report = await buildIntelReport({
      horizon,
      universe,
      universeSummary,
      rawItems,
      events: rankedEvents,
      snapshots,
    });
    const reportId = saveReport(database, chatId, report);
    finishSourceRun(database, runId, "complete", {
      rawItemCount: rawItems.length,
      mentionCount: mentions.length,
      eventCount: rankedEvents.length,
      sourceDiagnostics: [...sourceDiagnostics, priceDiagnostic].map(
        (diagnostic) => ({
          source: diagnostic.source,
          label: diagnostic.label,
          status: diagnostic.status,
          itemCount: diagnostic.itemCount,
          message: diagnostic.message,
        }),
      ),
      reportId,
    });
    console.log(
      `[intel] run ${runId} complete raw=${rawItems.length} mentions=${mentions.length} events=${rankedEvents.length} report=${reportId}`,
    );

    return { ...report, id: reportId };
  } catch (error) {
    console.error(
      `[intel] run ${runId} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    finishSourceRun(database, runId, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
