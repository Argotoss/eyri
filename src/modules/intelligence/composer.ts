import { Composer, InputFile } from "grammy";
import type { CustomContext } from "../bot/types.ts";
import {
  addWatchlistTicker,
  getIntelStatus,
  getLatestIntelDiagnostics,
  getLatestIntelReport,
  type IntelDiagnosticsOverview,
  type IntelRunOverview,
  type IntelSourceStepOverview,
  listWatchlistTickers,
  removeWatchlistTicker,
  setSp500Enabled,
} from "./storage.ts";
import {
  runDeepIntelligenceReport,
  runIntelligenceReport,
} from "./orchestrator.ts";
import { getSourceProfile } from "./source_registry.ts";
import {
  DEEP_RESEARCH_PRESETS,
  INTEL_HORIZONS,
  type DeepResearchPreset,
  type IntelHorizon,
} from "./types.ts";
import { intelReportFileName } from "./report.ts";

export const intelligenceComposer = new Composer<CustomContext>();

const htmlReplyOptions = {
  parse_mode: "HTML" as const,
  link_preview_options: {
    is_disabled: true,
  },
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseIntelCommand(input: string | undefined) {
  const tokens = (input ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { horizon: "1d" as IntelHorizon };
  }

  const first = tokens[0].toLowerCase();
  if (INTEL_HORIZONS.includes(first as IntelHorizon)) {
    return { horizon: first as IntelHorizon };
  }

  const horizonToken = tokens.find((token) =>
    INTEL_HORIZONS.includes(token.toLowerCase() as IntelHorizon),
  );
  const presetToken = tokens.find((token) =>
    DEEP_RESEARCH_PRESETS.includes(token.toLowerCase() as DeepResearchPreset),
  );
  return {
    ticker: tokens[0].toUpperCase(),
    horizon: (horizonToken?.toLowerCase() as IntelHorizon | undefined) ?? "1d",
    preset:
      (presetToken?.toLowerCase() as DeepResearchPreset | undefined) ?? "deep",
    deep: true,
  };
}

function parseIntelUtilityCommand(input: string | undefined) {
  const tokens = (input ?? "").trim().split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase();
  if (!["status", "last", "sources"].includes(action)) {
    return null;
  }

  return {
    action: action as "status" | "last" | "sources",
    ticker: tokens[1]?.toUpperCase(),
  };
}

function isValidTicker(value: string) {
  return /^[A-Z0-9.:-]{1,24}$/.test(value);
}

function parseWatchCommand(input: string | undefined) {
  const [action, ticker] = (input ?? "").trim().split(/\s+/);
  return {
    action: action?.toLowerCase(),
    ticker: ticker?.toUpperCase(),
  };
}

async function replyWithReportDocument(
  ctx: CustomContext,
  fileName: string,
  html: string,
) {
  const filePath = await Deno.makeTempFile({
    prefix: "eyri-intel-",
    suffix: ".html",
  });

  try {
    await Deno.writeTextFile(filePath, html);
    await ctx.replyWithDocument(new InputFile(filePath, fileName), {
      caption: "Full market intelligence report",
    });
  } finally {
    await Deno.remove(filePath).catch(() => undefined);
  }
}

async function fileExists(path: string) {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

function compactDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function durationLabel(ms: number | undefined) {
  if (ms === undefined || !Number.isFinite(ms)) {
    return "n/a";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

function runDuration(run: IntelRunOverview) {
  const end = run.completedAt ?? new Date();
  return Math.max(0, end.getTime() - run.startedAt.getTime());
}

function detailNumber(run: IntelRunOverview, key: string) {
  const value = run.details[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function detailText(run: IntelRunOverview, key: string) {
  const value = run.details[key];
  return typeof value === "string" ? value : undefined;
}

function formatRunLine(run: IntelRunOverview) {
  const ticker = detailText(run, "ticker");
  const preset = detailText(run, "preset");
  const raw = detailNumber(run, "rawItemCount");
  const relevant = detailNumber(run, "relevantItemCount");
  const events = detailNumber(run, "eventCount");
  const themes = detailNumber(run, "themeCount");
  const reportId = detailNumber(run, "reportId");
  const pieces = [
    `#${run.id}`,
    run.status,
    ticker,
    `${run.horizon}${preset ? `/${preset}` : ""}`,
    raw !== undefined
      ? relevant !== undefined
        ? `${raw} raw/${relevant} rel`
        : `${raw} raw`
      : undefined,
    events !== undefined ? `${events} events` : undefined,
    themes !== undefined ? `${themes} themes` : undefined,
    reportId !== undefined ? `report ${reportId}` : undefined,
    durationLabel(runDuration(run)),
  ].filter(Boolean);
  return pieces.join(" - ");
}

function formatCost(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return "$0.0000";
  }
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function formatSourceStep(step: IntelSourceStepOverview) {
  const duration = step.completedAt.getTime() - step.startedAt.getTime();
  const suffix = step.message ? ` - ${step.message}` : "";
  const profile = getSourceProfile(step.source);
  return `${step.status.toUpperCase()} ${profile.displayName} (${step.source}, q${profile.qualityScore}, ${profile.reliability}): ${step.itemCount} items, ${durationLabel(duration)}${suffix}`;
}

function formatDiagnosticsSummary(diagnostics: IntelDiagnosticsOverview) {
  const failed = diagnostics.steps.filter((step) => step.status === "failed");
  const partial = diagnostics.steps.filter((step) => step.status === "partial");
  const ok = diagnostics.steps.filter((step) => step.status === "ok");
  const cost = diagnostics.usages.reduce(
    (sum, usage) => sum + (usage.costUsd ?? 0),
    0,
  );
  const tokens = diagnostics.usages.reduce(
    (sum, usage) => sum + (usage.totalTokens ?? 0),
    0,
  );
  const timingLines = diagnostics.timings
    .slice(0, 6)
    .map((timing) => `${timing.stage} ${durationLabel(timing.durationMs)}`);
  const usageLines = diagnostics.usages.map(
    (usage) =>
      `${usage.stage} ${usage.model}: ${usage.totalTokens ?? 0} tokens, ${formatCost(usage.costUsd)}`,
  );
  const sourceLines = [...failed, ...partial, ...ok]
    .slice(0, 18)
    .map(formatSourceStep);

  return [
    `Intel sources for run ${formatRunLine(diagnostics.run)}`,
    `Sources: ${ok.length} ok, ${partial.length} partial, ${failed.length} failed`,
    `Models: ${tokens} tokens, ${formatCost(cost)}`,
    "",
    "Source diagnostics:",
    ...(sourceLines.length > 0
      ? sourceLines
      : ["No source diagnostics saved."]),
    "",
    "Slowest stages:",
    ...(timingLines.length > 0 ? timingLines : ["No timing rows saved."]),
    "",
    "Model usage:",
    ...(usageLines.length > 0 ? usageLines : ["No model usage rows saved."]),
  ]
    .join("\n")
    .slice(0, 3900);
}

async function handleIntelUtilityCommand(
  ctx: CustomContext,
  command: NonNullable<ReturnType<typeof parseIntelUtilityCommand>>,
) {
  if (!ctx.chat) {
    return true;
  }

  if (command.action === "status") {
    const status = getIntelStatus(ctx.db, ctx.chat.id);
    const latest = status.recentRuns[0];
    const lines = [
      "Intel status",
      `Runs: ${status.runCount} - Reports: ${status.reportCount} - Raw cache: ${status.rawItemCount}`,
      `Watchlist: ${status.watchlistCount} - S&P 500: ${status.sp500Enabled ? "on" : "off"}`,
      status.latestReport
        ? `Latest report: #${status.latestReport.id} ${status.latestReport.horizon} - ${compactDate(status.latestReport.createdAt)}`
        : "Latest report: none",
      latest ? `Last run: ${formatRunLine(latest)}` : "Last run: none",
      "",
      "Recent runs:",
      ...(status.recentRuns.length > 0
        ? status.recentRuns.map(formatRunLine)
        : ["No intelligence runs yet."]),
    ];
    await ctx.reply(escapeHtml(lines.join("\n")), htmlReplyOptions);
    return true;
  }

  if (command.action === "last") {
    const report = getLatestIntelReport(ctx.db, ctx.chat.id);
    if (!report) {
      await ctx.reply("No saved intelligence report found.", htmlReplyOptions);
      return true;
    }

    const lines = [
      `Last intel report #${report.id}`,
      `${report.horizon} - ${compactDate(report.createdAt)} - ${report.universeSummary}`,
      report.filePath
        ? `File: ${report.filePath}${report.fileBytes ? ` (${report.fileBytes} bytes)` : ""}`
        : "File: not saved",
      "",
      report.summaryText,
    ];
    await ctx.reply(
      escapeHtml(lines.join("\n").slice(0, 3900)),
      htmlReplyOptions,
    );

    if (report.filePath && (await fileExists(report.filePath))) {
      await ctx.replyWithDocument(new InputFile(report.filePath), {
        caption: `Intel report #${report.id}`,
      });
    } else {
      await replyWithReportDocument(
        ctx,
        `intel-report-${report.id}.html`,
        report.html,
      );
    }
    return true;
  }

  if (command.action === "sources") {
    if (command.ticker && !isValidTicker(command.ticker)) {
      await ctx.reply("Ticker format is invalid.", htmlReplyOptions);
      return true;
    }

    const diagnostics = getLatestIntelDiagnostics(
      ctx.db,
      ctx.chat.id,
      command.ticker,
    );
    if (!diagnostics) {
      await ctx.reply(
        command.ticker
          ? `No saved intelligence run found for ${escapeHtml(command.ticker)}.`
          : "No saved intelligence run found.",
        htmlReplyOptions,
      );
      return true;
    }

    await ctx.reply(
      escapeHtml(formatDiagnosticsSummary(diagnostics)),
      htmlReplyOptions,
    );
    return true;
  }

  return false;
}

intelligenceComposer.command("intel", async (ctx) => {
  if (!ctx.chat || !ctx.dbEntities.user) {
    await ctx.text("start");
    return;
  }

  const utilityCommand = parseIntelUtilityCommand(ctx.match);
  if (utilityCommand) {
    await handleIntelUtilityCommand(ctx, utilityCommand);
    return;
  }

  const command = parseIntelCommand(ctx.match);
  if (!command.horizon) {
    await ctx.reply(
      "Use <code>/intel</code>, <code>/intel 1d</code>, <code>/intel MU</code>, <code>/intel MU 3d</code>, or <code>/intel MU 14d deep</code>.",
      htmlReplyOptions,
    );
    return;
  }
  if (command.ticker && !isValidTicker(command.ticker)) {
    await ctx.reply("Ticker format is invalid.", htmlReplyOptions);
    return;
  }

  const progressMessage = await ctx.reply(
    command.ticker
      ? `Building ${escapeHtml(command.horizon)} deep intel report for ${escapeHtml(command.ticker)}...`
      : `Building ${escapeHtml(command.horizon)} market intel report...`,
    htmlReplyOptions,
  );

  try {
    const report = command.ticker
      ? await runDeepIntelligenceReport({
          database: ctx.db,
          chatId: ctx.chat.id,
          user: ctx.dbEntities.user,
          horizon: command.horizon,
          ticker: command.ticker,
          preset: command.preset,
        })
      : await runIntelligenceReport({
          database: ctx.db,
          chatId: ctx.chat.id,
          user: ctx.dbEntities.user,
          horizon: command.horizon,
        });
    await ctx.reply(escapeHtml(report.telegramSummary), htmlReplyOptions);
    await replyWithReportDocument(
      ctx,
      intelReportFileName(report),
      report.html,
    );
  } catch (error) {
    await ctx.reply(
      `Failed to build report: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}`,
      htmlReplyOptions,
    );
  } finally {
    await ctx.api
      .deleteMessage(ctx.chat.id, progressMessage.message_id)
      .catch(() => undefined);
  }
});

intelligenceComposer.command("watch", async (ctx) => {
  if (!ctx.chat) {
    return;
  }

  const { action, ticker } = parseWatchCommand(ctx.match);
  if (action === "add" && ticker) {
    addWatchlistTicker(ctx.db, ctx.chat.id, ticker, ctx.from?.id);
    await ctx.reply(
      `${escapeHtml(ticker)} added to intelligence watchlist.`,
      htmlReplyOptions,
    );
    return;
  }

  if ((action === "remove" || action === "rm") && ticker) {
    removeWatchlistTicker(ctx.db, ctx.chat.id, ticker);
    await ctx.reply(
      `${escapeHtml(ticker)} removed from intelligence watchlist.`,
      htmlReplyOptions,
    );
    return;
  }

  if (action === "list" || !action) {
    const tickers = listWatchlistTickers(ctx.db, ctx.chat.id).map(
      (item) => item.ticker,
    );
    await ctx.reply(
      tickers.length === 0
        ? "Intelligence watchlist is empty."
        : `Intelligence watchlist: ${escapeHtml(tickers.join(", "))}`,
      htmlReplyOptions,
    );
    return;
  }

  await ctx.reply(
    "Use <code>/watch add MU</code>, <code>/watch remove MU</code>, or <code>/watch list</code>.",
    htmlReplyOptions,
  );
});

intelligenceComposer.command("universe", async (ctx) => {
  if (!ctx.chat) {
    return;
  }

  const [preset, state] = (ctx.match ?? "").trim().toLowerCase().split(/\s+/);
  if (preset === "sp500" && ["on", "off"].includes(state)) {
    setSp500Enabled(ctx.db, ctx.chat.id, state === "on");
    await ctx.reply(
      `S&P 500 intelligence preset is now ${state}.`,
      htmlReplyOptions,
    );
    return;
  }

  await ctx.reply(
    "Use <code>/universe sp500 on</code> or <code>/universe sp500 off</code>.",
    htmlReplyOptions,
  );
});
