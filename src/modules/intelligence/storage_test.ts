import { Database } from "@db/sqlite";
import {
  createSourceRun,
  ensureIntelligenceSchema,
  finishSourceRun,
  getIntelStatus,
  getLatestIntelDiagnostics,
  getLatestIntelReport,
  saveModelUsages,
  saveRunTimings,
  saveSourceDiagnostics,
} from "./storage.ts";

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
