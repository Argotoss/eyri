import { Composer, InputFile } from "grammy";
import type { CustomContext } from "../bot/types.ts";
import {
  addWatchlistTicker,
  listWatchlistTickers,
  removeWatchlistTicker,
  setSp500Enabled,
} from "./storage.ts";
import {
  runDeepIntelligenceReport,
  runIntelligenceReport,
} from "./orchestrator.ts";
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

intelligenceComposer.command("intel", async (ctx) => {
  if (!ctx.chat || !ctx.dbEntities.user) {
    await ctx.text("start");
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
