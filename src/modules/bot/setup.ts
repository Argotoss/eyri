import { Bot as TelegramBot } from "grammy";

import { startComposer } from "../start/composer.ts";
import { tickersComposer } from "../tickers/composer.ts";
import type { Bot, CustomContext } from "./types.ts";
import { createReplyWithTextFunc } from "./utils.ts";

function extendContext(bot: Bot) {
  bot.use(async (ctx, next) => {
    if (!ctx.chat || !ctx.from) {
      return;
    }

    ctx.text = createReplyWithTextFunc(ctx);

    await next();
  });
}

function parseAdminId(): number {
  const adminId = Number(Deno.env.get("ADMIN_ID"));
  if (!Number.isSafeInteger(adminId)) {
    throw new Error("ADMIN_ID environment variable must be a Telegram user ID");
  }

  return adminId;
}

function restrictToAdmin(bot: Bot, adminId: number) {
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== adminId) {
      return;
    }

    await next();
  });
}

function setupComposers(bot: Bot) {
  bot.use(startComposer);
  bot.use(tickersComposer);
}

export function createBot(): Bot {
  const TOKEN = Deno.env.get("TOKEN");
  if (!TOKEN) {
    throw new Error("TOKEN environment variable is missing");
  }

  const bot = new TelegramBot<CustomContext>(TOKEN);
  const adminId = parseAdminId();

  restrictToAdmin(bot, adminId);
  extendContext(bot);
  setupComposers(bot);

  return bot;
}
