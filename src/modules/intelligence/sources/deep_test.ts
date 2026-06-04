import {
  buildCompanyReleaseRssItems,
  buildFinnhubEarningsCalendarItems,
  buildFinnhubPriceTargetItems,
  buildFinnhubUpgradeDowngradeItems,
  buildYahooChartContextItems,
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

Deno.test("Finnhub price targets become analyst research evidence", () => {
  const fetchedAt = new Date("2026-06-03T12:00:00.000Z");
  const items = buildFinnhubPriceTargetItems({
    ticker: "MU",
    fetchedAt,
    response: {
      symbol: "MU",
      targetHigh: 1450,
      targetLow: 900,
      targetMean: 1125,
      targetMedian: 1100,
      lastUpdated: "2026-06-02",
    },
  });

  assert(items.length === 1, "expected one price target item");
  assert(items[0].source === "finnhub_price_target", "expected source key");
  assert(items[0].sourceType === "research", "expected research source type");
  assert(items[0].body?.includes("Target mean: 1125"), "expected mean target");
  assert(items[0].body?.includes("Target low: 900"), "expected low target");
  assert(
    items[0].publishedAt.toISOString().startsWith("2026-06-02"),
    "expected last updated date",
  );
});

Deno.test("Finnhub rating revisions become analyst action evidence", () => {
  const fetchedAt = new Date("2026-06-03T12:00:00.000Z");
  const items = buildFinnhubUpgradeDowngradeItems({
    ticker: "MU",
    fetchedAt,
    limit: 1,
    response: [
      {
        symbol: "MU",
        company: "Micron Technology",
        firm: "Example Capital",
        fromGrade: "Neutral",
        toGrade: "Buy",
        action: "upgrade",
        gradeTime: "2026-06-03T10:15:00.000Z",
      },
      {
        symbol: "NVDA",
        firm: "Other Firm",
        fromGrade: "Buy",
        toGrade: "Hold",
        action: "downgrade",
        gradeTime: "2026-06-03T10:20:00.000Z",
      },
    ],
  });

  assert(items.length === 1, "expected ticker-specific limited item");
  assert(
    items[0].source === "finnhub_upgrade_downgrade",
    "expected source key",
  );
  assert(items[0].sourceType === "research", "expected research source type");
  assert(items[0].title.includes("Neutral -> Buy"), "expected rating change");
  assert(
    items[0].body?.includes("Firm: Example Capital"),
    "expected analyst firm",
  );
  assert(
    items[0].publishedAt.toISOString() === "2026-06-03T10:15:00.000Z",
    "expected grade time",
  );
});

Deno.test("Yahoo chart rows become market context evidence", () => {
  const fetchedAt = new Date("2026-06-04T12:00:00.000Z");
  const marketTime = Date.parse("2026-06-04T12:00:00.000Z") / 1000;
  const items = buildYahooChartContextItems({
    ticker: "MU",
    fetchedAt,
    horizon: "1d",
    response: {
      chart: {
        result: [
          {
            meta: {
              symbol: "MU",
              currency: "USD",
              fullExchangeName: "NasdaqGS",
              longName: "Micron Technology, Inc.",
              regularMarketTime: marketTime,
              regularMarketPrice: 996,
              regularMarketDayLow: 971.68,
              regularMarketDayHigh: 1036.37,
              regularMarketVolume: 250,
              fiftyTwoWeekLow: 103.38,
              fiftyTwoWeekHigh: 1089.29,
            },
            timestamp: [
              1780257600,
              1780344000,
              1780430400,
              1780516800,
              marketTime,
            ],
            indicators: {
              quote: [
                {
                  close: [900, 925, 960, 980, 996],
                  volume: [100, 100, 100, 100, 250],
                },
              ],
            },
          },
        ],
      },
    },
  });

  assert(items.length === 1, "expected one chart item");
  assert(items[0].source === "yahoo_chart", "expected chart source");
  assert(items[0].sourceType === "market", "expected market source type");
  assert(items[0].body?.includes("1d return: +1.63%"), "expected 1d return");
  assert(
    items[0].body?.includes("Relative volume: 1.92"),
    "expected volume ratio",
  );
  assert(
    items[0].body?.includes("52w range position"),
    "expected range position",
  );
  assert(
    items[0].publishedAt.toISOString() === "2026-06-04T12:00:00.000Z",
    "expected market timestamp",
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
