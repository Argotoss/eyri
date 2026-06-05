import { connectToDb } from "../src/modules/database/setup.ts";
import { findOrCreateUser } from "../src/modules/database/user.ts";
import { runDeepIntelligenceReport } from "../src/modules/intelligence/orchestrator.ts";
import {
  DEEP_RESEARCH_PRESETS,
  type DeepResearchPreset,
  type IntelHorizon,
  INTEL_HORIZONS,
} from "../src/modules/intelligence/types.ts";

type SourceStepRow = {
  source: string;
  label: string;
  status: string;
  itemCount: number;
  message: string | null;
};

type Args = {
  ticker: string;
  horizon: IntelHorizon;
  preset: DeepResearchPreset;
  databasePath: string;
  reportsDir: string;
  signalReview: boolean;
  minRawItems: number;
  minRelevantItems: number;
};

const REQUIRED_SOURCE_OK = [
  "prices",
  "fundamentals",
  "yahoo_chart",
  "nasdaq_short_interest",
  "nasdaq_options",
  "nasdaq_analyst_target",
  "nasdaq_earnings_surprise",
  "nasdaq_institutional_ownership",
  "nasdaq_insider_trades",
];

function fail(message: string): never {
  throw new Error(`[smoke:intel] ${message}`);
}

function isIntelHorizon(value: string): value is IntelHorizon {
  return INTEL_HORIZONS.includes(value as IntelHorizon);
}

function isDeepResearchPreset(value: string): value is DeepResearchPreset {
  return DEEP_RESEARCH_PRESETS.includes(value as DeepResearchPreset);
}

function argValue(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(): Args {
  const args = Deno.args;
  const ticker = (argValue(args, "--ticker") ?? "MU").trim().toUpperCase();
  const horizonInput = argValue(args, "--horizon") ?? "1d";
  const presetInput = argValue(args, "--preset") ?? "fast";
  if (!isIntelHorizon(horizonInput)) {
    fail(`invalid --horizon ${horizonInput}`);
  }
  if (!isDeepResearchPreset(presetInput)) {
    fail(`invalid --preset ${presetInput}`);
  }
  const id = `${ticker}-${horizonInput}-${presetInput}-${timestamp()}`;
  return {
    ticker,
    horizon: horizonInput,
    preset: presetInput,
    databasePath:
      argValue(args, "--database") ?? `data/smoke-intel-${id}.sqlite`,
    reportsDir: argValue(args, "--reports-dir") ?? "data/smoke-reports",
    signalReview: parseBoolean(argValue(args, "--signal-review"), false),
    minRawItems: parsePositiveInt(
      argValue(args, "--min-raw-items"),
      presetInput === "fast" ? 50 : 100,
    ),
    minRelevantItems: parsePositiveInt(
      argValue(args, "--min-relevant-items"),
      presetInput === "fast" ? 15 : 25,
    ),
  };
}

async function assertFile(path: string | undefined, label: string) {
  if (!path) {
    fail(`${label} path is missing`);
  }
  const stat = await Deno.stat(path).catch(() => null);
  if (!stat?.isFile || stat.size <= 0) {
    fail(`${label} file is missing or empty: ${path}`);
  }
}

function readDiagnostics(database: Awaited<ReturnType<typeof connectToDb>>) {
  return database
    .prepare(`
      SELECT
        source,
        label,
        status,
        item_count AS itemCount,
        message
      FROM intel_source_run_steps
      WHERE run_id = (SELECT MAX(id) FROM intel_source_runs)
      ORDER BY source, label
    `)
    .all() as SourceStepRow[];
}

function assertDiagnostics(rows: SourceStepRow[]) {
  const bySource = new Map(rows.map((row) => [row.source, row]));
  const missing = REQUIRED_SOURCE_OK.filter((source) => !bySource.has(source));
  if (missing.length > 0) {
    fail(`missing source diagnostics: ${missing.join(", ")}`);
  }
  const failedRequired = REQUIRED_SOURCE_OK.filter((source) => {
    const row = bySource.get(source);
    return !row || row.status !== "ok" || row.itemCount < 1;
  });
  if (failedRequired.length > 0) {
    fail(
      `required source diagnostics not ok: ${failedRequired
        .map((source) => {
          const row = bySource.get(source);
          return `${source}=${row?.status ?? "missing"}:${row?.itemCount ?? 0}`;
        })
        .join(", ")}`,
    );
  }
}

const args = parseArgs();
Deno.env.set("EYRI_DATABASE_PATH", args.databasePath);
Deno.env.set("EYRI_REPORTS_DIR", args.reportsDir);
Deno.env.set("INTEL_SIGNAL_REVIEW_ENABLED", String(args.signalReview));

const database = await connectToDb();
try {
  const user = await findOrCreateUser(database, 99_900);
  if (!user) {
    fail("failed to create smoke user");
  }
  const startedAt = performance.now();
  const report = await runDeepIntelligenceReport({
    database,
    chatId: `smoke-${args.ticker}-${args.horizon}-${args.preset}`,
    user,
    horizon: args.horizon,
    ticker: args.ticker,
    preset: args.preset,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const rawItems = report.deepResearch?.rawItemCount ?? 0;
  const relevantItems = report.deepResearch?.relevantItemCount ?? 0;
  if (report.deepResearch?.ticker !== args.ticker) {
    fail(`expected ticker ${args.ticker}, got ${report.deepResearch?.ticker}`);
  }
  if (rawItems < args.minRawItems) {
    fail(`raw item count too low: ${rawItems} < ${args.minRawItems}`);
  }
  if (relevantItems < args.minRelevantItems) {
    fail(
      `relevant item count too low: ${relevantItems} < ${args.minRelevantItems}`,
    );
  }
  await assertFile(report.file?.path, "HTML report");
  await assertFile(report.evaluatorFile?.path, "Evaluator sidecar");

  const diagnostics = readDiagnostics(database);
  assertDiagnostics(diagnostics);

  console.log(
    JSON.stringify(
      {
        ok: true,
        ticker: args.ticker,
        horizon: args.horizon,
        preset: args.preset,
        durationMs,
        rawItems,
        relevantItems,
        reportFile: report.file?.path,
        evaluatorFile: report.evaluatorFile?.path,
        diagnostics: diagnostics.map((row) => ({
          source: row.source,
          status: row.status,
          itemCount: row.itemCount,
          message: row.message,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
