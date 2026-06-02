import { formatDecoratedTicker } from "./decorations.ts";

const ICON_TECH = "\u{1F4BB}";
const ICON_INDEX = "\u{1F310}";
const ICON_STAR = "\u{2B50}";

function assertIncludes(actual: string, expected: string) {
  if (!actual.includes(expected)) {
    throw new Error(`Expected "${actual}" to include "${expected}"`);
  }
}

function assertNotIncludes(actual: string, expected: string) {
  if (actual.includes(expected)) {
    throw new Error(`Expected "${actual}" not to include "${expected}"`);
  }
}

Deno.test("formatDecoratedTicker adds built-in icons and labels", () => {
  const actual = formatDecoratedTicker("MU");

  assertIncludes(actual, ICON_TECH);
  assertIncludes(actual, ">Micron</a>");
});

Deno.test("formatDecoratedTicker uses built-in ETF icons and labels", () => {
  const actual = formatDecoratedTicker("VUAA:LON");

  assertIncludes(actual, ICON_INDEX);
  assertIncludes(actual, ">SP500</a>");
  assertIncludes(actual, "https://www.google.com/finance/beta/quote/VUAA:LON");
});

Deno.test("formatDecoratedTicker defaults bare tickers to exchange-qualified links", () => {
  assertIncludes(
    formatDecoratedTicker("MU"),
    "https://www.google.com/finance/beta/quote/MU:NASDAQ",
  );
});

Deno.test("formatDecoratedTicker keeps exchange-qualified links literal", () => {
  assertIncludes(
    formatDecoratedTicker("IBM:NYSE"),
    "https://www.google.com/finance/beta/quote/IBM:NYSE",
  );
});

Deno.test("formatDecoratedTicker allows link overrides", () => {
  assertIncludes(
    formatDecoratedTicker("MU", undefined, undefined, { MU: "MU:NYSE" }),
    "https://www.google.com/finance/beta/quote/MU:NYSE",
  );
});

Deno.test("formatDecoratedTicker lets saved decorations override built-in icons", () => {
  const actual = formatDecoratedTicker("MU", {
    MU: [{ tgEmoji: ICON_STAR, text: ICON_STAR, isCustomEmoji: false }],
  });

  assertIncludes(actual, ICON_STAR);
  assertNotIncludes(actual, ICON_TECH);
});

Deno.test("formatDecoratedTicker matches saved decorations by base ticker", () => {
  assertIncludes(
    formatDecoratedTicker("MU:NASDAQ", {
      MU: [{ tgEmoji: ICON_STAR, text: ICON_STAR, isCustomEmoji: false }],
    }),
    ICON_STAR,
  );
});

Deno.test("formatDecoratedTicker matches saved labels and links by base ticker", () => {
  const actual = formatDecoratedTicker(
    "MU:NASDAQ",
    undefined,
    { MU: "Micron Override" },
    { MU: "MU:NYSE" },
  );

  assertIncludes(actual, ">Micron Override</a>");
  assertIncludes(actual, "https://www.google.com/finance/beta/quote/MU:NYSE");
});
