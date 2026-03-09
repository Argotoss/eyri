import { Composer } from "grammy";
import type { CustomContext } from "../bot/types.ts";
import { refreshPersistentPrice } from "../database/price.ts";
import { addPosition } from "../database/user.ts";
import { buildTickerList, parsePriceOverrides } from "./portfolio.ts";

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

tickersComposer.command("tickers", async (ctx) => {
  if (!ctx.dbEntities.user) {
    await ctx.text("start");
    return;
  }

  const priceList = await buildTickerList({
    database: ctx.db,
    user: ctx.dbEntities.user,
  });

  if (priceList.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(priceList);
});

tickersComposer.command("when", async (ctx) => {
  if (!ctx.dbEntities.user) {
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

  const priceList = await buildTickerList({
    database: ctx.db,
    user: ctx.dbEntities.user,
    priceOverrides,
  });

  if (priceList.length === 0) {
    await ctx.text("no_positions");
    return;
  }

  await ctx.reply(priceList);
});
