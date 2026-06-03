import { resolveRawItemMentions } from "./resolve.ts";
import type { IntelRawItem, UniverseEntry } from "./types.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const universe: UniverseEntry[] = [
  {
    ticker: "MU",
    name: "Micron Technology",
    aliases: ["Micron"],
    sources: ["watchlist"],
    priority: 85,
  },
  {
    ticker: "AI",
    name: "C3.ai",
    aliases: ["C3 AI"],
    sources: ["sp500"],
    priority: 35,
  },
];

function rawItem(title: string, body = ""): IntelRawItem {
  return {
    id: 1,
    source: "test",
    sourceType: "news",
    sourceId: title,
    title,
    body,
    publishedAt: new Date(),
    fetchedAt: new Date(),
    rawHash: title,
  };
}

Deno.test("resolveRawItemMentions matches company names", () => {
  const mentions = resolveRawItemMentions(
    rawItem("Micron raises outlook on memory demand"),
    universe,
  );

  assert(
    mentions.some((mention) => mention.ticker === "MU"),
    "expected MU",
  );
});

Deno.test("resolveRawItemMentions rejects ambiguous tickers without context", () => {
  const mentions = resolveRawItemMentions(
    rawItem("AI demand lifts semiconductor shares"),
    universe,
  );

  assert(
    !mentions.some((mention) => mention.ticker === "AI"),
    "AI phrase should not become AI ticker",
  );
});

Deno.test("resolveRawItemMentions trusts source tickers", () => {
  const item = rawItem("Company filed 8-K");
  item.tickers = ["AI"];
  const mentions = resolveRawItemMentions(item, universe);

  assert(
    mentions.some(
      (mention) => mention.ticker === "AI" && mention.confidence === 1,
    ),
    "expected source ticker mention",
  );
});
