import {
  buildCompanyReleaseRssItems,
  buildFinnhubEarningsCalendarItems,
  companyReleaseSearchQuery,
} from "./deep.ts";

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

Deno.test("company release query targets announcement and IR language", () => {
  const query = companyReleaseSearchQuery(
    {
      ticker: "MU",
      name: "Micron Technology",
      aliases: ["Micron"],
      sources: ["target"],
      priority: 100,
    },
    "3d",
  );

  assert(query.includes('"Micron Technology"'), "expected company name");
  assert(query.includes('"press release"'), "expected press release term");
  assert(query.includes('"investor relations"'), "expected IR term");
  assert(query.includes("when:3d"), "expected horizon filter");
});

Deno.test("company release RSS rows become company source evidence", () => {
  const fetchedAt = new Date("2026-06-04T10:00:00.000Z");
  const items = buildCompanyReleaseRssItems({
    ticker: "MU",
    fetchedAt,
    limit: 1,
    rssItems: [
      {
        title: "Micron announces new HBM product availability",
        link: "https://investors.micron.com/news/example",
        description:
          "Micron Technology announced availability of a new HBM product for AI data centers.",
        pubDate: "Thu, 04 Jun 2026 09:30:00 GMT",
        source: "Micron Technology",
      },
      {
        title: "Extra item should be limited out",
        link: "https://example.com/extra",
        description: "Extra",
        pubDate: "Thu, 04 Jun 2026 09:35:00 GMT",
        source: "Example",
      },
    ],
  });

  assert(items.length === 1, "expected limit to apply");
  assert(items[0].source === "company_releases", "expected source key");
  assert(items[0].sourceType === "company", "expected company source type");
  assert(items[0].tickers?.includes("MU"), "expected ticker tag");
  assert(
    items[0].body?.includes(
      "verify whether this is a direct company/IR source",
    ),
    "expected verification warning",
  );
});
