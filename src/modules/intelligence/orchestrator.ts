import { clusterEvents } from "./dedupe.ts";
import { buildDeepResearchData } from "./deep_research.ts";
import { buildDeepIntelReport } from "./deep_report.ts";
import { extractEvents, extractEventsForDeepResearch } from "./extract.ts";
import { dedupeRawItemInputs } from "./items.ts";
import { buildIntelReport } from "./report.ts";
import { resolveMentionsForItems } from "./resolve.ts";
import { rankEvents } from "./score.ts";
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
    const fundamentals = await collectFundamentals(
      [...new Set(rankedEvents.map((event) => event.ticker))],
      snapshots,
    );
    const stocks = buildStockIntel({
      events: rankedEvents,
      universe,
      snapshots,
      fundamentals,
    }).slice(0, 15);
    const report = await buildIntelReport({
      horizon,
      universe,
      universeSummary,
      rawItems,
      events: rankedEvents,
      stocks,
      snapshots,
    });
    const reportId = saveReport(database, chatId, report);
    finishSourceRun(database, runId, "complete", {
      rawItemCount: rawItems.length,
      mentionCount: mentions.length,
      eventCount: rankedEvents.length,
      stockCount: stocks.length,
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

export async function runDeepIntelligenceReport({
  database,
  chatId,
  user,
  horizon,
  ticker,
}: IntelligenceRunArgs & { ticker: string }) {
  const normalizedTicker = normalizeTicker(ticker);
  const researchTicker = researchTickerFor(ticker);
  const runId = createSourceRun(database, chatId, horizon);
  try {
    console.log(
      `[intel] deep run ${runId} started (${horizon}) chat=${chatId} ticker=${normalizedTicker}`,
    );
    const universe = await buildUniverse(database, chatId, user);

    const priceStartedAt = new Date();
    const snapshots = await collectMarketSnapshots([normalizedTicker], horizon);
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
    const fundamentals = await collectFundamentals(
      [entry.ticker],
      reportSnapshots,
    );
    const fundamentalsDiagnostic = sourceDiagnostic({
      source: "fundamentals",
      label: `ticker-fundamentals:${entry.ticker}`,
      startedAt: fundamentalsStartedAt,
      status: fundamentals.length > 0 ? "ok" : "failed",
      itemCount: fundamentals.length,
      metadata: { ticker: entry.ticker },
    });

    const [secResult, gdeltResult, deepSourceResult] = await Promise.all([
      collectSecItemsForTicker(entry, horizon),
      collectGdeltItemsForTicker(entry, horizon),
      collectDeepSourceItems(entry, horizon),
    ]);
    const sourceItems = [
      ...secResult.items,
      ...gdeltResult.items,
      ...deepSourceResult.items,
    ];
    const deduped = dedupeRawItemInputs(sourceItems);
    const fullTextResult = await enrichItemsWithFullText(deduped.items);
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

    const rawItems = await saveRawItems(database, fullTextResult.items);
    const mentions = resolveMentionsForItems(rawItems, [entry]);
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
    const extractedEvents = await extractEventsForDeepResearch(
      relevantRawItems,
      relevantMentions,
      horizon,
    );
    const clusters = clusterEvents(extractedEvents, relevantRawItems);
    const rankedEvents = rankEvents(clusters, [entry], reportSnapshots).slice(
      0,
      80,
    );
    const stocks = buildStockIntel({
      events: rankedEvents,
      universe: [entry],
      snapshots: reportSnapshots,
      fundamentals,
    });
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
      rawItems,
      relevantItemIds,
      duplicateItemCount: deduped.duplicateCount,
      events: rankedEvents,
      diagnostics: allDiagnostics,
      market: reportSnapshots[0],
      fundamentals: fundamentals[0],
    });
    const report = await buildDeepIntelReport({
      entry,
      horizon,
      rawItems,
      relevantItemIds,
      events: rankedEvents,
      stock,
      research,
    });
    const reportId = saveReport(database, chatId, report);
    finishSourceRun(database, runId, "complete", {
      mode: "deep",
      ticker: entry.ticker,
      rawItemCount: rawItems.length,
      relevantItemCount: relevantItemIds.length,
      duplicateItemCount: deduped.duplicateCount,
      mentionCount: mentions.length,
      eventCount: rankedEvents.length,
      themeCount: research.themes.length,
      sourceDiagnostics: allDiagnostics.map((diagnostic) => ({
        source: diagnostic.source,
        label: diagnostic.label,
        status: diagnostic.status,
        itemCount: diagnostic.itemCount,
        message: diagnostic.message,
      })),
      reportId,
    });
    console.log(
      `[intel] deep run ${runId} complete raw=${rawItems.length} relevant=${relevantItemIds.length} events=${rankedEvents.length} themes=${research.themes.length} report=${reportId}`,
    );

    return { ...report, id: reportId };
  } catch (error) {
    console.error(
      `[intel] deep run ${runId} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    finishSourceRun(database, runId, "failed", {
      mode: "deep",
      ticker: normalizedTicker,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
