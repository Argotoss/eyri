import { Composer, InputFile } from "grammy";
import type { CustomContext } from "../bot/types.ts";
import {
  addWatchlistTicker,
  listWatchlistTickers,
  removeWatchlistTicker,
  setSp500Enabled,
} from "./storage.ts";
import { runIntelligenceReport } from "./orchestrator.ts";
import { INTEL_HORIZONS, type IntelHorizon } from "./types.ts";
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

function parseHorizon(input: string | undefined): IntelHorizon | null {
  const value = input?.trim().split(/\s+/, 1)[0] || "1d";
  return INTEL_HORIZONS.includes(value as IntelHorizon)
    ? (value as IntelHorizon)
    : null;
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

  const horizon = parseHorizon(ctx.match);
  if (!horizon) {
    await ctx.reply(
      "Use <code>/intel</code>, <code>/intel 1d</code>, <code>/intel 3d</code>, or <code>/intel 14d</code>.",
      htmlReplyOptions,
    );
    return;
  }

  const progressMessage = await ctx.reply(
    `Building ${escapeHtml(horizon)} market intel report...`,
    htmlReplyOptions,
  );

  try {
    const report = await runIntelligenceReport({
      database: ctx.db,
      chatId: ctx.chat.id,
      user: ctx.dbEntities.user,
      horizon,
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
