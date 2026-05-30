import type { Api, Bot as TelegramBot, Context, NextFunction } from "grammy";
import type { Message } from "grammy_types";

type Extra = Parameters<Api["sendMessage"]>[2];

export type Custom = {
  text: (
    text: string,
    templateData?: Record<string, string | number>,
    extra?: Extra,
  ) => Promise<Message.TextMessage>;
};

export type CustomContext = Context & Custom;

export type Bot = TelegramBot<CustomContext>;

export type Handler = (ctx: CustomContext, next?: NextFunction) => void;
