import { clusterEvents } from "./dedupe.ts";
import { buildDeepResearchData } from "./deep_research.ts";
import { buildDeepIntelReport } from "./deep_report.ts";
import { buildEvidencePackets, buildItemDistillations } from "./distill.ts";
import { extractEvents, extractEventsForDeepResearch } from "./extract.ts";
import { dedupeRawItemInputs } from "./items.ts";
import { consumeModelUsages } from "./model_usage.ts";
import { buildIntelReport } from "./report.ts";
import { resolveMentionsForItems } from "./resolve.ts";
import { rankEvents } from "./score.ts";
import { reviewItemSignals } from "./signal_review.ts";
import { collectDeepSourceItems } from "./sources/deep.ts";
import { collectFundamentals } from "./sources/fundamentals.ts";
import { enrichItemsWithFullText } from "./sources/fulltext.ts";
import { collectGdeltItems } from "./sources/gdelt.ts";
import { collectGdeltItemsForTicker } from "./sources/gdelt.ts";
import { collectMarketSnapshots } from "./sources/prices.ts";
import { collectSecItems } from "./sources/sec.ts";
import { collectSecItemsForTicker } from "./sources/sec.ts";
import { buildStockIntel } from "./stock.ts";
import {
  createSourceRun,
  finishSourceRun,
  getRunItemDelta,
  saveMarketSnapshots,
  saveEvidencePackets,
  saveItemDistillations,
  saveModelUsages,
  saveRawItems,
  saveReport,
  saveRunTimings,
  saveSourceDiagnostics,
  saveTickerMentions,
} from "./storage.ts";
import type {
  DeepResearchPreset,
  IntelRawItemInput,
  IntelligenceRunArgs,
  RunTiming,
  SourceDiagnostic,
  UniverseEntry,
} from "./types.ts";
import { buildUniverse, summarizeUniverse } from "./universe.ts";

function uniqueRawItems(items: IntelRawItemInput[]) {
  return dedupeRawItemInputs(items).items;
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

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function researchTickerFor(ticker: string) {
  return normalizeTicker(ticker).split(":", 1)[0];
}

function targetEntryFor(
  ticker: string,
  universe: UniverseEntry[],
  snapshots: Awaited<ReturnType<typeof collectMarketSnapshots>>,
): UniverseEntry {
  const normalizedTicker = normalizeTicker(ticker);
  const existing = universe.find((entry) => entry.ticker === normalizedTicker);
  const snapshot = snapshots.find((item) => item.ticker === normalizedTicker);
  const name = snapshot?.companyName ?? existing?.name ?? normalizedTicker;
  return {
    ticker: normalizedTicker,
    name,
    aliases: [
      ...new Set(
        [
          ...(existing?.aliases ?? []),
          existing?.name,
          snapshot?.companyName,
          name,
        ].filter((value): value is string =>
          Boolean(value && value.length >= 3),
        ),
      ),
    ],
    sector: existing?.sector,
    cik: existing?.cik,
    sources: [...new Set([...(existing?.sources ?? []), "target" as const])],
    priority: Math.max(existing?.priority ?? 0, 100),
  };
}

function sourceDiagnostic(args: {
  source: string;
  label: string;
  startedAt: Date;
  status: SourceDiagnostic["status"];
  itemCount: number;
  message?: string;
  metadata?: Record<string, unknown>;
}): SourceDiagnostic {
  return {
    source: args.source,
    label: args.label,
    status: args.status,
    itemCount: args.itemCount,
    startedAt: args.startedAt,
    completedAt: new Date(),
    message: args.message,
    metadata: args.metadata,
  };
}

async function timed<T>(
  timings: RunTiming[],
  stage: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
) {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    timings.push({
      stage,
      durationMs: performance.now() - startedAt,
      metadata,
    });
  }
}

export async function runIntelligenceReport({
  database,
  chatId,
  user,
  horizon,
}: IntelligenceRunArgs) {
  const runId = createSourceRun(database, chatId, horizon);
  const timings: RunTiming[] = [];
  consumeModelUsages();
  try {
    console.log(`[intel] run ${runId} started (${horizon}) chat=${chatId}`);
    const universe = await timed(timings, "build-universe", () =>
      buildUniverse(database, chatId, user),
    );
    const universeSummary = summarizeUniverse(universe);
    const [secResult, gdeltResult] = await timed(timings, "source-fetch", () =>
      Promise.all([
        collectSecItems(universe, horizon),
        collectGdeltItems(universe, horizon),
      ]),
    );
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
    const rawItems = await timed(timings, "save-raw-items", () =>
      saveRawItems(
        database,
        uniqueRawItems([...secResult.items, ...gdeltResult.items]),
        runId,
      ),
    );
    const mentions = await timed(timings, "resolve-mentions", async () =>
      resolveMentionsForItems(rawItems, universe),
    );
    saveTickerMentions(database, mentions);
    const extractedEvents = await timed(timings, "extract-events", () =>
      extractEvents(rawItems, mentions, horizon),
    );
    const clusters = await timed(timings, "cluster-events", async () =>
      clusterEvents(extractedEvents, rawItems),
    );
    const tickers = candidateSnapshotTickers(
      universe,
      clusters.map((cluster) => cluster.ticker),
    );
    const priceStartedAt = new Date();
    const snapshots = await timed(timings, "prices", () =>
      collectMarketSnapshots(tickers, horizon),
    );
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

    const rankedEvents = await timed(timings, "rank-events", async () =>
      rankEvents(clusters, universe, snapshots).slice(0, 30),
    );
    const fundamentals = await timed(timings, "fundamentals", () =>
      collectFundamentals(
        [...new Set(rankedEvents.map((event) => event.ticker))],
        snapshots,
      ),
    );
    const stocks = await timed(timings, "build-stock-intel", async () =>
      buildStockIntel({
        events: rankedEvents,
        universe,
        snapshots,
        fundamentals,
      }).slice(0, 15),
    );
    const report = await timed(timings, "build-report", () =>
      buildIntelReport({
        horizon,
        universe,
        universeSummary,
        rawItems,
        events: rankedEvents,
        stocks,
        snapshots,
      }),
    );
    const savedReport = await timed(timings, "save-report", async () =>
      saveReport(database, chatId, report),
    );
    saveRunTimings(database, runId, timings);
    saveModelUsages(database, runId, consumeModelUsages());
    finishSourceRun(database, runId, "complete", {
      rawItemCount: rawItems.length,
      mentionCount: mentions.length,
      eventCount: rankedEvents.length,
      stockCount: stocks.length,
      timings: timings.map((timing) => ({
        stage: timing.stage,
        durationMs: Math.round(timing.durationMs),
      })),
      sourceDiagnostics: [...sourceDiagnostics, priceDiagnostic].map(
        (diagnostic) => ({
          source: diagnostic.source,
          label: diagnostic.label,
          status: diagnostic.status,
          itemCount: diagnostic.itemCount,
          message: diagnostic.message,
        }),
      ),
      reportId: savedReport.id,
    });
    console.log(
      `[intel] run ${runId} complete raw=${rawItems.length} mentions=${mentions.length} events=${rankedEvents.length} report=${savedReport.id}`,
    );

    return { ...report, id: savedReport.id, file: savedReport.file };
  } catch (error) {
    console.error(
      `[intel] run ${runId} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    saveRunTimings(database, runId, timings);
    saveModelUsages(database, runId, consumeModelUsages());
    finishSourceRun(database, runId, "failed", {
      timings: timings.map((timing) => ({
        stage: timing.stage,
        durationMs: Math.round(timing.durationMs),
      })),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runDeepIntelligenceReport({
  database,
  chatId,
  user,
  horizon,
  ticker,
  preset = "deep",
}: IntelligenceRunArgs & { ticker: string; preset?: DeepResearchPreset }) {
  const normalizedTicker = normalizeTicker(ticker);
  const researchTicker = researchTickerFor(ticker);
  const runId = createSourceRun(database, chatId, horizon);
  const timings: RunTiming[] = [];
  consumeModelUsages();
  try {
    console.log(
      `[intel] deep run ${runId} started (${horizon}/${preset}) chat=${chatId} ticker=${normalizedTicker}`,
    );
    const universe = await timed(timings, "build-universe", () =>
      buildUniverse(database, chatId, user),
    );

    const priceStartedAt = new Date();
    const snapshots = await timed(timings, "prices", () =>
      collectMarketSnapshots([normalizedTicker], horizon),
    );
    saveMarketSnapshots(database, snapshots);
    const priceDiagnostic = sourceDiagnostic({
      source: "prices",
      label: `ticker-market-snapshot:${normalizedTicker}`,
      startedAt: priceStartedAt,
      status: snapshots.length > 0 ? "ok" : "failed",
      itemCount: snapshots.length,
      metadata: {
        requestedTickers: [normalizedTicker],
        returnedTickers: snapshots.map((snapshot) => snapshot.ticker),
      },
    });

    const reportSnapshots = snapshots.map((snapshot) => ({
      ...snapshot,
      ticker: researchTicker,
    }));
    const entry = targetEntryFor(researchTicker, universe, reportSnapshots);
    const fundamentalsStartedAt = new Date();
    const fundamentals = await timed(timings, "fundamentals", () =>
      collectFundamentals([entry.ticker], reportSnapshots),
    );
    const fundamentalsDiagnostic = sourceDiagnostic({
      source: "fundamentals",
      label: `ticker-fundamentals:${entry.ticker}`,
      startedAt: fundamentalsStartedAt,
      status: fundamentals.length > 0 ? "ok" : "failed",
      itemCount: fundamentals.length,
      metadata: { ticker: entry.ticker },
    });

    const [secResult, gdeltResult, deepSourceResult] = await timed(
      timings,
      "source-fetch",
      () =>
        Promise.all([
          collectSecItemsForTicker(entry, horizon),
          collectGdeltItemsForTicker(entry, horizon, preset),
          collectDeepSourceItems(entry, horizon, preset),
        ]),
      { preset },
    );
    const sourceItems = [
      ...secResult.items,
      ...gdeltResult.items,
      ...deepSourceResult.items,
    ];
    const deduped = dedupeRawItemInputs(sourceItems);
    const fullTextResult = await timed(timings, "fulltext", () =>
      enrichItemsWithFullText(deduped.items, preset),
    );
    const allDiagnostics = [
      priceDiagnostic,
      fundamentalsDiagnostic,
      ...secResult.diagnostics,
      ...gdeltResult.diagnostics,
      ...deepSourceResult.diagnostics,
      ...fullTextResult.diagnostics,
    ];
    saveSourceDiagnostics(database, runId, allDiagnostics);
    console.log(
      `[intel] deep run ${runId} sources: ${allDiagnostics
        .map(
          (diagnostic) =>
            `${diagnostic.source}/${diagnostic.label}=${diagnostic.status}:${diagnostic.itemCount}`,
        )
        .join(", ")}`,
    );

    const rawItems = await timed(timings, "save-raw-items", () =>
      saveRawItems(database, fullTextResult.items, runId),
    );
    const changeSummary = await timed(
      timings,
      "build-change-summary",
      async () => getRunItemDelta(database, runId, entry.ticker),
    );
    const mentions = await timed(timings, "resolve-mentions", async () =>
      resolveMentionsForItems(rawItems, [entry]),
    );
    saveTickerMentions(database, mentions);
    const relevantItemIds = [
      ...new Set(
        mentions
          .filter((mention) => mention.ticker === entry.ticker)
          .map((mention) => mention.rawItemId),
      ),
    ];
    const relevantIdSet = new Set(relevantItemIds);
    const relevantRawItems = rawItems.filter((item) =>
      relevantIdSet.has(item.id),
    );
    const relevantMentions = mentions.filter((mention) =>
      relevantIdSet.has(mention.rawItemId),
    );
    const distillations = await timed(timings, "distill-items", async () => {
      const ruleBased = buildItemDistillations({
        rawItems,
        mentions,
        entry,
        horizon,
      });
      return await reviewItemSignals({
        distillations: ruleBased,
        rawItems,
        ticker: entry.ticker,
        horizon,
      });
    });
    saveItemDistillations(database, distillations);
    const evidencePackets = await timed(
      timings,
      "build-evidence-packets",
      async () =>
        buildEvidencePackets({
          ticker: entry.ticker,
          distillations,
          rawItems,
        }),
    );
    saveEvidencePackets(database, runId, evidencePackets);
    const extractedEvents = await timed(timings, "extract-events", () =>
      extractEventsForDeepResearch(relevantRawItems, relevantMentions, horizon),
    );
    const rankedEvents = await timed(timings, "rank-events", async () => {
      const clusters = clusterEvents(extractedEvents, relevantRawItems);
      return rankEvents(clusters, [entry], reportSnapshots).slice(0, 80);
    });
    const stocks = await timed(timings, "build-stock-intel", async () =>
      buildStockIntel({
        events: rankedEvents,
        universe: [entry],
        snapshots: reportSnapshots,
        fundamentals,
      }),
    );
    const stock =
      stocks[0] ??
      ({
        ticker: entry.ticker,
        companyName: snapshots[0]?.companyName ?? entry.name,
        sector: entry.sector,
        sources: entry.sources,
        score: 0,
        confidence: "low",
        verdict: "No actionable catalyst extracted",
        thesis:
          "The deep scan collected source material, but no specific catalyst survived extraction.",
        bullCase: ["No strong bullish catalyst extracted."],
        bearCase: ["No strong bearish catalyst extracted."],
        risks: ["Extraction found no actionable theme."],
        scoreBreakdown: {
          catalyst: 0,
          market: 0,
          relevance: 0,
          fundamentals: fundamentals.length > 0 ? 5 : 0,
          riskPenalty: 0,
        },
        market: reportSnapshots[0],
        fundamentals: fundamentals[0],
        events: [],
        evidenceItemIds: [],
        sourceCount: 0,
      } satisfies ReturnType<typeof buildStockIntel>[number]);
    const research = buildDeepResearchData({
      entry,
      horizon,
      preset,
      rawItems,
      relevantItemIds,
      duplicateItemCount: deduped.duplicateCount,
      distillations,
      evidencePackets,
      changeSummary,
      events: rankedEvents,
      diagnostics: allDiagnostics,
      market: reportSnapshots[0],
      fundamentals: fundamentals[0],
    });
    const report = await timed(timings, "build-report", () =>
      buildDeepIntelReport({
        entry,
        horizon,
        rawItems,
        relevantItemIds,
        events: rankedEvents,
        stock,
        research,
      }),
    );
    const savedReport = await timed(timings, "save-report", async () =>
      saveReport(database, chatId, report),
    );
    saveRunTimings(database, runId, timings);
    saveModelUsages(database, runId, consumeModelUsages());
    finishSourceRun(database, runId, "complete", {
      mode: "deep",
      preset,
      ticker: entry.ticker,
      rawItemCount: rawItems.length,
      relevantItemCount: relevantItemIds.length,
      duplicateItemCount: deduped.duplicateCount,
      cacheNewItemCount: changeSummary.cacheNewItemCount,
      newSincePreviousCount: changeSummary.newItemCount,
      reusedSincePreviousCount: changeSummary.reusedItemCount,
      droppedSincePreviousCount: changeSummary.droppedItemCount,
      previousRunId: changeSummary.previousRunId,
      noiseRejectedCount: research.noiseRejectedCount,
      mentionCount: mentions.length,
      eventCount: rankedEvents.length,
      evidencePacketCount: evidencePackets.length,
      themeCount: research.themes.length,
      timings: timings.map((timing) => ({
        stage: timing.stage,
        durationMs: Math.round(timing.durationMs),
      })),
      sourceDiagnostics: allDiagnostics.map((diagnostic) => ({
        source: diagnostic.source,
        label: diagnostic.label,
        status: diagnostic.status,
        itemCount: diagnostic.itemCount,
        message: diagnostic.message,
      })),
      reportId: savedReport.id,
    });
    console.log(
      `[intel] deep run ${runId} complete raw=${rawItems.length} relevant=${relevantItemIds.length} events=${rankedEvents.length} themes=${research.themes.length} report=${savedReport.id}`,
    );

    return { ...report, id: savedReport.id, file: savedReport.file };
  } catch (error) {
    console.error(
      `[intel] deep run ${runId} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    saveRunTimings(database, runId, timings);
    saveModelUsages(database, runId, consumeModelUsages());
    finishSourceRun(database, runId, "failed", {
      mode: "deep",
      preset,
      ticker: normalizedTicker,
      timings: timings.map((timing) => ({
        stage: timing.stage,
        durationMs: Math.round(timing.durationMs),
      })),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
