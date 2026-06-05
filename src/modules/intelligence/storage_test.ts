import { Database } from "@db/sqlite";
import {
  createSourceRun,
  ensureIntelligenceSchema,
  finishSourceRun,
  getIntelStatus,
  getLatestIntelDiagnostics,
  getLatestIntelReport,
  getRunItemDelta,
  saveReport,
  saveItemDistillations,
  saveModelUsages,
  saveRawItems,
  saveRunTimings,
  saveSourceDiagnostics,
} from "./storage.ts";
import type { IntelRawItemInput } from "./types.ts";
import type { IntelReport } from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("intelligence storage exposes status, latest report, and diagnostics", () => {
  const database = new Database(":memory:");
  try {
    ensureIntelligenceSchema(database);
    const now = new Date();
    const runId = createSourceRun(database, "chat-1", "1d");
    saveSourceDiagnostics(database, runId, [
      {
        source: "gdelt",
        label: "ticker-deep:MU:latest",
        status: "failed",
        itemCount: 0,
        message: "HTTP 429",
        startedAt: now,
        completedAt: now,
      },
      {
        source: "sec",
        label: "ticker-sec-filings:MU",
        status: "ok",
        itemCount: 2,
        startedAt: now,
        completedAt: now,
      },
    ]);
    saveRunTimings(database, runId, [
      { stage: "source-fetch", durationMs: 1200 },
      { stage: "build-report", durationMs: 300 },
    ]);
    saveModelUsages(database, runId, [
      {
        stage: "deep_report",
        model: "openai/gpt-5.4-mini",
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        costUsd: 0.00165,
        createdAt: now,
      },
    ]);
    finishSourceRun(database, runId, "complete", {
      mode: "deep",
      preset: "fast",
      ticker: "MU",
      rawItemCount: 10,
      relevantItemCount: 7,
      eventCount: 3,
      themeCount: 2,
      reportId: 1,
    });
    database
      .prepare(`
        INSERT INTO intel_reports (
          chat_id,
          horizon,
          universe_summary,
          summary_text,
          html,
          file_path,
          file_bytes,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        "chat-1",
        "1d",
        "portfolio 1",
        "Deep Intel MU",
        "<html>report</html>",
        "data/reports/test.html",
        19,
        now.toISOString(),
      );

    const status = getIntelStatus(database, "chat-1");
    const report = getLatestIntelReport(database, "chat-1");
    const diagnostics = getLatestIntelDiagnostics(database, "chat-1", "MU");

    assert(status.runCount === 1, "expected one run");
    assert(status.reportCount === 1, "expected one report");
    assert(status.recentRuns[0].details.ticker === "MU", "expected ticker");
    assert(report?.summaryText === "Deep Intel MU", "expected latest report");
    assert(diagnostics?.steps.length === 2, "expected source diagnostics");
    assert(diagnostics?.steps[0].status === "failed", "failed sources first");
    assert(diagnostics?.timings[0].stage === "source-fetch", "slowest first");
    assert(diagnostics?.usages[0].totalTokens === 1200, "expected usage");
  } finally {
    database.close();
  }
});

Deno.test("intelligence storage persists item signal tiers", async () => {
  const database = new Database(":memory:");
  try {
    ensureIntelligenceSchema(database);
    const now = new Date();
    const runId = createSourceRun(database, "chat-1", "1d");
    const [item] = await saveRawItems(
      database,
      [
        {
          source: "finnhub_news",
          sourceType: "news",
          sourceId: "signal-1",
          title: "Micron demand improves",
          publishedAt: now,
          fetchedAt: now,
        },
      ],
      runId,
    );
    saveItemDistillations(database, [
      {
        rawItemId: item.id,
        ticker: "MU",
        topic: "supply_demand",
        signalTier: "high",
        signalScore: 83,
        signalReasons: ["high ticker relevance", "high-quality source"],
        relevance: 95,
        novelty: 90,
        sourceQuality: 82,
        catalystStrength: 65,
        riskSeverity: 10,
        direction: "positive",
        timeSensitivity: "1d",
        summary: "Memory demand improved.",
        whyItMatters: "Concrete catalyst.",
        keyFacts: ["Pricing rose 12%."],
        createdAt: now,
      },
    ]);

    const row = database
      .prepare(`
        SELECT signal_tier, signal_score, signal_reasons, risk_severity
        FROM intel_item_distillations
        WHERE raw_item_id = ?
      `)
      .get(item.id) as
      | {
          signal_tier: string;
          signal_score: number;
          signal_reasons: string;
          risk_severity: number;
        }
      | undefined;

    assert(row?.signal_tier === "high", "expected signal tier");
    assert(row?.signal_score === 83, "expected signal score");
    assert(
      row?.signal_reasons.includes("high-quality source"),
      "expected signal reasons",
    );
    assert(row?.risk_severity === 10, "expected risk severity");
  } finally {
    database.close();
  }
});

Deno.test("intelligence storage writes evaluator packet sidecar", async () => {
  const database = new Database(":memory:");
  const previousReportsDir = Deno.env.get("EYRI_REPORTS_DIR");
  const reportsDir = await Deno.makeTempDir();
  try {
    Deno.env.set("EYRI_REPORTS_DIR", reportsDir);
    ensureIntelligenceSchema(database);
    const now = new Date();
    const report: IntelReport = {
      horizon: "1d",
      generatedAt: now,
      universeSummary: "deep research MU",
      telegramSummary: "Deep Intel MU",
      executiveSummary: "Summary",
      html: "<html>report</html>",
      stocks: [],
      events: [],
      evaluatorPacket: {
        version: 1,
        generatedAt: now.toISOString(),
        ticker: "MU",
        companyName: "Micron Technology",
        horizon: "1d",
        preset: "fast",
        verdict: {
          score: 70,
          confidence: "medium",
          label: "Watch catalyst",
          thesis: "Evidence packet exists.",
        },
        decisionDossier: {
          setupType: "catalyst watch",
          timeWindow: "1-3 trading days",
          catalystClock: "fresh",
          edgeSummary: "Potential edge",
          topCatalysts: ["earnings"],
          invalidation: ["price fades"],
          missingData: ["transcript"],
          humanChecks: ["read source"],
        },
        actionReadiness: {
          label: "watch closely",
          score: 62,
          freshnessScore: 90,
          corroborationScore: 60,
          marketConfirmationScore: 50,
          dataCompletenessScore: 70,
          reasons: ["fresh evidence"],
          blockers: ["single-source packet"],
          nextChecks: ["read source"],
        },
        signalCounts: {
          critical: 1,
          high: 0,
          medium: 0,
          low: 0,
          noise: 0,
        },
        topSignals: [],
        evidencePackets: [],
        sourceCoverage: [],
        dataQuality: [],
        sourceDiagnostics: [],
      },
    };

    const saved = saveReport(database, "chat-1", report);
    const stored = getLatestIntelReport(database, "chat-1");
    const evaluatorFile = saved.evaluatorFile;

    if (!evaluatorFile?.path) {
      throw new Error("expected evaluator file path");
    }
    assert(stored?.evaluatorFilePath, "expected stored evaluator file path");
    assert(stored?.evaluatorJson?.ticker === "MU", "expected stored JSON");
    assert(
      (await Deno.readTextFile(evaluatorFile.path)).includes('"ticker": "MU"'),
      "expected evaluator sidecar content",
    );
  } finally {
    database.close();
    if (previousReportsDir) {
      Deno.env.set("EYRI_REPORTS_DIR", previousReportsDir);
    } else {
      Deno.env.delete("EYRI_REPORTS_DIR");
    }
    await Deno.remove(reportsDir, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("intelligence storage tracks run raw-item deltas", async () => {
  const database = new Database(":memory:");
  try {
    ensureIntelligenceSchema(database);
    const now = new Date();
    const item = (
      source: string,
      sourceId: string,
      title: string,
    ): IntelRawItemInput => ({
      source,
      sourceType: "news",
      sourceId,
      title,
      url: `https://example.com/${sourceId}`,
      publishedAt: now,
      fetchedAt: now,
    });

    const firstRunId = createSourceRun(database, "chat-1", "1d");
    await saveRawItems(
      database,
      [
        item("sec", "a", "First primary item"),
        item("google_news", "b", "Shared news item"),
      ],
      firstRunId,
    );
    finishSourceRun(database, firstRunId, "complete", {
      mode: "deep",
      ticker: "MU",
    });

    const secondRunId = createSourceRun(database, "chat-1", "1d");
    await saveRawItems(
      database,
      [
        item("google_news", "b", "Shared news item"),
        item("stocktwits", "c", "New social item"),
      ],
      secondRunId,
    );
    finishSourceRun(database, secondRunId, "complete", {
      mode: "deep",
      ticker: "MU",
    });

    const baseline = getRunItemDelta(database, firstRunId, "MU");
    const delta = getRunItemDelta(database, secondRunId, "MU");

    assert(baseline.previousRunId === undefined, "first run is baseline");
    assert(baseline.cacheNewItemCount === 2, "baseline items are cache-new");
    assert(delta.previousRunId === firstRunId, "expected previous run");
    assert(delta.currentItemCount === 2, "expected two current items");
    assert(delta.previousItemCount === 2, "expected two previous items");
    assert(delta.newItemCount === 1, "expected one new item");
    assert(delta.reusedItemCount === 1, "expected one reused item");
    assert(delta.cacheNewItemCount === 1, "expected one cache-new item");
    assert(delta.droppedItemCount === 1, "expected one dropped item");
    assert(delta.newItems[0].title === "New social item", "expected new item");
    assert(
      delta.droppedItems[0].title === "First primary item",
      "expected dropped item",
    );
    assert(delta.newSources.includes("stocktwits"), "expected new source");
    assert(delta.droppedSources.includes("sec"), "expected dropped source");
  } finally {
    database.close();
  }
});
