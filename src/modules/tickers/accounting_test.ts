import {
  calculatePurchase,
  summarizePortfolio,
  summarizeTransactions,
} from "./accounting.ts";

function assertEquals<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function assertAlmostEquals(actual: number, expected: number, epsilon = 1e-9) {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

Deno.test("calculatePurchase adds buy commission to cost basis", () => {
  const result = calculatePurchase({
    ticker: "NVDA:NASDAQ",
    unitPrice: 100,
    amount: 10,
    commissionPercent: 0.3,
  });

  assertEquals(result.kind, "buy");
  assertAlmostEquals(result.commissionAmount, 3);
  assertAlmostEquals(result.costBasisAfter, 1003);
  assertAlmostEquals(result.sharesAfter, 10);
});

Deno.test("calculatePurchase locks realized P/L on sell", () => {
  const buy = calculatePurchase({
    ticker: "NVDA:NASDAQ",
    unitPrice: 100,
    amount: 10,
    commissionPercent: 0,
  });
  const sell = calculatePurchase(
    {
      ticker: "NVDA:NASDAQ",
      unitPrice: 120,
      amount: -4,
      commissionPercent: 0.5,
    },
    {
      amount: buy.sharesAfter,
      cost: buy.costBasisAfter,
      oldestDate: new Date("2026-01-01T00:00:00Z"),
      realizedPl: 0,
      realizedCostBasis: 0,
    },
  );

  assertEquals(sell.kind, "sell");
  assertAlmostEquals(sell.commissionAmount, 2.4);
  assertAlmostEquals(sell.realizedPl, 77.6);
  assertAlmostEquals(sell.costBasisAfter, 600);
  assertAlmostEquals(sell.sharesAfter, 6);
});

Deno.test("summaries exclude closed positions and keep realized P/L", () => {
  const transactions = [
    {
      ticker: "IBM:NYSE",
      amount: 2,
      price: 200,
      grossValue: 200,
      commissionAmount: 0,
      date: new Date("2026-01-01T00:00:00Z"),
    },
    {
      ticker: "IBM:NYSE",
      amount: -2,
      price: 250,
      unitPrice: 125,
      grossValue: 250,
      commissionAmount: 0,
      realizedPl: 50,
      costBasisBefore: 200,
      costBasisAfter: 0,
      date: new Date("2026-02-01T00:00:00Z"),
    },
  ];

  const summaries = summarizeTransactions(transactions);
  const portfolio = summarizePortfolio(transactions);

  assertAlmostEquals(summaries["IBM:NYSE"].amount, 0);
  assertAlmostEquals(summaries["IBM:NYSE"].realizedPl, 50);
  assertAlmostEquals(portfolio.openCostBasis, 0);
  assertAlmostEquals(portfolio.realizedPl, 50);
});
