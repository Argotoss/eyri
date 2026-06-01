import { Composer } from "grammy";
import type { CustomContext } from "../bot/types.ts";
import { refreshPersistentPrice } from "../database/price.ts";
import { addPosition } from "../database/user.ts";
import {
  escapeHtml,
  formatTickerDecorations,
  parseDecorateCommand,
  parseLabelCommand,
  readTickerDecorations,
  readTickerLabelPreferences,
  setTickerDecoration,
  setTickerLabelPreference,
} from "./decorations.ts";
import {
  buildHistory,
  buildTickerList,
  parsePriceOverrides,
} from "./portfolio.ts";

export const tickersComposer = new Composer<CustomContext>();

tickersComposer.command("buy", async (ctx) => {
  if (!ctx.dbEntities.user) {
    await ctx.text("start");
    return;
  }

  if (!ctx.match) {
    await ctx.text("buy");
    return;
  }

  const params = ctx.match.split(" ");
  if (params.length !== 4) {
    await ctx.text("buy");
    return;
  }

  const [ticker, price, commission, amount] = params;

  const result = await addPosition({
    database: ctx.db,
    userId: ctx.dbEntities.user.userId,
    ticker,
    price: Number(price) + Number(commission),
    amount: Number(amount),
  });

  if (!result.success) {
    await ctx.text("buy");
    return;
  }

  await ctx.text("bought");
  await refreshPersistentPrice(ctx.db, ticker);
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
  if (!ctx.dbEntities.user || !ctx.from) {
    await ctx.text("start");
    return;
  }

  const tickerDecorations = await readTickerDecorations(ctx.from.id);
  const tickerLabelPreferences = await readTickerLabelPreferences(ctx.from.id);
  const priceList = await buildTickerList({
    database: ctx.db,
    user: ctx.dbEntities.user,
    tickerDecorations,
    tickerLabelPreferences,
  });

  if (priceList.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(priceList, { parse_mode: "HTML" });
});

tickersComposer.command("history", async (ctx) => {
  if (!ctx.dbEntities.user || !ctx.from) {
    await ctx.text("start");
    return;
  }

  const tickerDecorations = await readTickerDecorations(ctx.from.id);
  const tickerLabelPreferences = await readTickerLabelPreferences(ctx.from.id);
  const history = buildHistory({
    user: ctx.dbEntities.user,
    tickerDecorations,
    tickerLabelPreferences,
  });

  if (history.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(history, { parse_mode: "HTML" });
});

tickersComposer.command("when", async (ctx) => {
  if (!ctx.dbEntities.user || !ctx.from) {
    await ctx.text("start");
    return;
  }

  if (!ctx.match) {
    await ctx.text("when");
    return;
  }

  const priceOverrides = parsePriceOverrides(ctx.match);
  if (!priceOverrides) {
    await ctx.text("when");
    return;
  }

  const tickerDecorations = await readTickerDecorations(ctx.from.id);
  const tickerLabelPreferences = await readTickerLabelPreferences(ctx.from.id);
  const priceList = await buildTickerList({
    database: ctx.db,
    user: ctx.dbEntities.user,
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
