import { parseLegacyBuyCommand, parsePurchaseCommand } from "./purchase.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

Deno.test("parsePurchaseCommand accepts optional percent commission", () => {
  const parsed = parsePurchaseCommand("nvda:nasdaq 214.40 2 0.3%");
  if (!parsed) {
    throw new Error("Expected parsed command");
  }

  assertEquals(parsed.ticker, "NVDA:NASDAQ");
  assertEquals(parsed.unitPrice, 214.4);
  assertEquals(parsed.amount, 2);
  assertEquals(parsed.commissionPercent, 0.3);
});

Deno.test("parsePurchaseCommand defaults commission to zero", () => {
  const parsed = parsePurchaseCommand("MU 1000 1");
  if (!parsed) {
    throw new Error("Expected parsed command");
  }

  assertEquals(parsed.ticker, "MU");
  assertEquals(parsed.commissionPercent, 0);
});

Deno.test("parseLegacyBuyCommand preserves old total-price command", () => {
  const parsed = parseLegacyBuyCommand("VUAA:LON 11777.40 10 89.36");
  if (!parsed) {
    throw new Error("Expected parsed command");
  }

  assertEquals(parsed.ticker, "VUAA:LON");
  assertEquals(parsed.amount, 89.36);
  assertEquals(Number(parsed.unitPrice.toFixed(2)), 131.8);
  assertEquals(Number(parsed.commissionPercent.toFixed(4)), 0.0849);
});
