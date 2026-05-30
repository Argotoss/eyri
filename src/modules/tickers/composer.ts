import { Composer } from "grammy";
import type { CustomContext } from "../bot/types.ts";
import { fetchPortfolioPositions } from "../ibkr/client.ts";
import { fetchFlexTrades } from "../ibkr/flex.ts";
import {
  escapeHtml,
  formatTickerDecorations,
  parseDecorateCommand,
  parseLabelCommand,
  readTickerLabelPreferences,
  readTickerDecorations,
  setTickerDecoration,
  setTickerLabelPreference,
} from "./decorations.ts";
import {
  buildPerformanceList,
  buildTickerList,
  buildTradeHistory,
  parsePriceOverrides,
} from "./portfolio.ts";

export const tickersComposer = new Composer<CustomContext>();

async function getPositionsOrReply(ctx: CustomContext) {
  try {
    return await fetchPortfolioPositions();
  } catch (error) {
    console.error("Failed to fetch IBKR portfolio:", error);
    await ctx.text("ibkr_unavailable");
    return null;
  }
}

async function replyTextChunks(
  ctx: CustomContext,
  text: string,
  extra?: Parameters<CustomContext["reply"]>[1],
) {
  const chunks: string[] = [];
  let chunk = "";
  for (const line of text.split("\n")) {
    const nextChunk = chunk ? `${chunk}\n${line}` : line;
    if (nextChunk.length <= 3900) {
      chunk = nextChunk;
      continue;
    }

    if (chunk) {
      chunks.push(chunk);
    }
    chunk = line;
  }

  if (chunk) {
    chunks.push(chunk);
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk, extra);
  }
}

tickersComposer.command("buy", async (ctx) => {
  await ctx.text("buy_unsupported");
});

tickersComposer.command("decorate", async (ctx) => {
  const parsed = parseDecorateCommand(ctx);
  if (!parsed || !ctx.from) {
    await ctx.text("decorate");
    return;
  }

  await setTickerDecoration(ctx.from.id, parsed.ticker, parsed.decorations);
  await ctx.reply(
    `${formatTickerDecorations(parsed.decorations)} ${escapeHtml(
      parsed.ticker,
    )} decorated (${parsed.decorations.length}).`,
    { parse_mode: "HTML" },
  );
});

tickersComposer.command("label", async (ctx) => {
  const parsed = parseLabelCommand(ctx.match || "");
  if (!parsed || !ctx.from) {
    await ctx.text("label");
    return;
  }

  await setTickerLabelPreference(ctx.from.id, parsed.ticker, parsed.showLabel);
  await ctx.reply(
    `${escapeHtml(parsed.ticker)} label ${parsed.showLabel ? "shown" : "hidden"}.`,
    { parse_mode: "HTML" },
  );
});

tickersComposer.command("tickers", async (ctx) => {
  const positions = await getPositionsOrReply(ctx);
  const userId = ctx.from?.id;
  if (!positions || !userId) {
    return;
  }

  const tickerDecorations = await readTickerDecorations(userId);
  const tickerLabelPreferences = await readTickerLabelPreferences(userId);
  const priceList = await buildTickerList({
    positions,
    tickerDecorations,
    tickerLabelPreferences,
  });

  if (priceList.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(priceList, { parse_mode: "HTML" });
});

tickersComposer.command("perf", async (ctx) => {
  const positions = await getPositionsOrReply(ctx);
  const userId = ctx.from?.id;
  if (!positions || !userId) {
    return;
  }

  const tickerDecorations = await readTickerDecorations(userId);
  const tickerLabelPreferences = await readTickerLabelPreferences(userId);
  const performanceList = await buildPerformanceList({
    positions,
    tickerDecorations,
    tickerLabelPreferences,
  });

  if (performanceList.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(performanceList, { parse_mode: "HTML" });
});

tickersComposer.command("history", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  const trades = await fetchFlexTrades().catch((error) => {
    console.error("Failed to fetch IBKR Flex trade history:", error);
    return null;
  });
  if (!trades) {
    await ctx.text("history_unavailable");
    return;
  }

  if (trades.length === 0) {
    await ctx.text("no_trades");
    return;
  }

  const tickerDecorations = await readTickerDecorations(userId);
  const tickerLabelPreferences = await readTickerLabelPreferences(userId);
  const history = buildTradeHistory({
    trades,
    tickerDecorations,
    tickerLabelPreferences,
  });
  if (history.length === 0) {
    await ctx.text("no_trades");
    return;
  }

  await replyTextChunks(ctx, history, { parse_mode: "HTML" });
});

tickersComposer.command("when", async (ctx) => {
  if (!ctx.match) {
    await ctx.text("when");
    return;
  }

  const priceOverrides = parsePriceOverrides(ctx.match);
  if (!priceOverrides) {
    await ctx.text("when");
    return;
  }

  const positions = await getPositionsOrReply(ctx);
  const userId = ctx.from?.id;
  if (!positions || !userId) {
    return;
  }

  const tickerDecorations = await readTickerDecorations(userId);
  const tickerLabelPreferences = await readTickerLabelPreferences(userId);
  const priceList = await buildTickerList({
    positions,
    priceOverrides,
    tickerDecorations,
    tickerLabelPreferences,
  });

  if (priceList.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(priceList, { parse_mode: "HTML" });
});
