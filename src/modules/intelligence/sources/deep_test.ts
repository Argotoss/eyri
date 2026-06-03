import { buildFinnhubEarningsCalendarItems } from "./deep.ts";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("Finnhub earnings calendar items become company catalyst evidence", () => {
  const fetchedAt = new Date("2026-06-03T12:00:00.000Z");
  const items = buildFinnhubEarningsCalendarItems({
    ticker: "MU",
    fetchedAt,
    response: {
      earningsCalendar: [
        {
          date: "2026-06-25",
          epsEstimate: 1.41,
          hour: "amc",
          quarter: 3,
          revenueEstimate: 8200000000,
          symbol: "MU",
          year: 2026,
        },
        {
          date: "2026-06-25",
          epsEstimate: 2.1,
          symbol: "NVDA",
        },
      ],
    },
  });

  assert(items.length === 1, "expected ticker-specific earnings item");
  assert(
    items[0].source === "finnhub_earnings_calendar",
    "expected registered earnings source",
  );
  assert(items[0].sourceType === "company", "expected company source type");
  assert(
    items[0].title.includes("MU earnings scheduled for 2026-06-25"),
    "expected scheduled earnings title",
  );
  assert(
    items[0].body?.includes("Revenue estimate: 8200000000"),
    "expected revenue estimate in body",
  );
  assert(
    items[0].publishedAt.toISOString().startsWith("2026-06-25"),
    "expected event date as publishedAt",
  );
  assert(
    items[0].fetchedAt?.getTime() === fetchedAt.getTime(),
    "expected fetchedAt preservation",
  );
});
