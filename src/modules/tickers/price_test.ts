import {
  parseStooqCsv,
  toStooqSymbol,
  toUsProviderSymbol,
  toYahooSymbol,
} from "./price.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

Deno.test("provider symbol mapping supports canonical exchange tickers", () => {
  assertEquals(toUsProviderSymbol("NVDA:NASDAQ"), "NVDA");
  assertEquals(toUsProviderSymbol("VUAA:LON"), null);
  assertEquals(toYahooSymbol("VUAA:LON"), "VUAA.L");
  assertEquals(toYahooSymbol("IBM:NYSE"), "IBM");
  assertEquals(toStooqSymbol("SPYL:LON"), "spyl.uk");
  assertEquals(toStooqSymbol("MU"), "mu.us");
});

Deno.test("parseStooqCsv reads close price", () => {
  assertEquals(parseStooqCsv("MU.US,2026-01-01,12:00,1,2,0.5,1.5,100"), 1.5);
});
