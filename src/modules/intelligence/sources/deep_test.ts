import {
  buildCompanyReleaseRssItems,
  buildFinnhubEarningsCalendarItems,
  buildFinnhubPriceTargetItems,
  buildFinnhubUpgradeDowngradeItems,
  buildNasdaqAnalystTargetItems,
  buildNasdaqEarningsSurpriseItems,
  buildNasdaqOptionsItems,
  buildNasdaqShortInterestItems,
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

Deno.test("Nasdaq short interest rows become positioning evidence", () => {
  const fetchedAt = new Date("2026-06-04T12:00:00.000Z");
  const items = buildNasdaqShortInterestItems({
    ticker: "MU",
    fetchedAt,
    response: {
      data: {
        symbol: "MU",
        shortInterestTable: {
          rows: [
            {
              settlementDate: "05/15/2026",
              interest: "35,235,443",
              avgDailyShareVolume: "54,391,136",
              daysToCover: 1,
            },
            {
              settlementDate: "04/30/2026",
              interest: "37,273,548",
              avgDailyShareVolume: "36,277,062",
              daysToCover: 1.027469,
            },
          ],
        },
      },
    },
  });

  assert(items.length === 1, "expected one short-interest item");
  assert(
    items[0].source === "nasdaq_short_interest",
    "expected short-interest source",
  );
  assert(items[0].sourceType === "research", "expected research source type");
  assert(
    items[0].body?.includes("Short interest: 35.24M shares"),
    "expected latest interest",
  );
  assert(
    items[0].body?.includes("Change vs previous settlement: -5.47%"),
    "expected short-interest change",
  );
  assert(
    items[0].publishedAt.toISOString().startsWith("2026-05-15"),
    "expected settlement date",
  );
});

Deno.test("Nasdaq options rows become aggregate positioning evidence", () => {
  const fetchedAt = new Date("2026-06-04T12:00:00.000Z");
  const items = buildNasdaqOptionsItems({
    ticker: "MU",
    fetchedAt,
    limit: 3,
    response: {
      data: {
        totalRecord: 4,
        lastTrade: "LAST TRADE: $996 (AS OF JUN 4, 2026)",
        table: {
          rows: [
            {
              expirygroup: "June 5, 2026",
              strike: null,
            },
            {
              expiryDate: "Jun 5",
              strike: "900.00",
              c_Volume: "120",
              c_Openinterest: "1,000",
              p_Volume: "60",
              p_Openinterest: "500",
            },
            {
              expiryDate: "Jun 5",
              strike: "1,000.00",
              c_Volume: "80",
              c_Openinterest: "600",
              p_Volume: "140",
              p_Openinterest: "1,200",
            },
            {
              expiryDate: "Jun 12",
              strike: "1,050.00",
              c_Volume: "20",
              c_Openinterest: "300",
              p_Volume: "--",
              p_Openinterest: "100",
            },
          ],
        },
      },
    },
  });

  assert(items.length === 1, "expected one options item");
  assert(items[0].source === "nasdaq_options", "expected options source");
  assert(items[0].sourceType === "market", "expected market source type");
  assert(items[0].body?.includes("Rows analyzed: 3 / 4 total"), "expected cap");
  assert(items[0].body?.includes("Call volume: 220"), "expected call volume");
  assert(items[0].body?.includes("Put volume: 200"), "expected put volume");
  assert(
    items[0].body?.includes("Put/call volume ratio: 0.91"),
    "expected put/call volume ratio",
  );
  assert(
    items[0].body?.includes("Top put open interest: Jun 5 1000.00"),
    "expected top put open interest",
  );
});

Deno.test("Nasdaq analyst targets become consensus research evidence", () => {
  const fetchedAt = new Date("2026-06-04T12:00:00.000Z");
  const items = buildNasdaqAnalystTargetItems({
    ticker: "MU",
    fetchedAt,
    response: {
      data: {
        symbol: "mu",
        consensusOverview: {
          lowPriceTarget: 400,
          highPriceTarget: 1750,
          priceTarget: 860.2,
          buy: 26,
          hold: 3,
          sell: 0,
        },
        historicalConsensus: [
          {
            z: {
              buy: 24,
              hold: 3,
              sell: 0,
              date: "05/01/2026",
              consensus: "Buy",
            },
            y: 820,
          },
          {
            z: {
              buy: 26,
              hold: 3,
              sell: 0,
              date: "06/01/2026",
              consensus: "Buy",
            },
            y: 860.2,
          },
        ],
      },
    },
  });

  assert(items.length === 1, "expected one analyst target item");
  assert(
    items[0].source === "nasdaq_analyst_target",
    "expected analyst target source",
  );
  assert(items[0].sourceType === "research", "expected research source type");
  assert(
    items[0].body?.includes("Consensus price target: 860.20"),
    "expected price target",
  );
  assert(
    items[0].body?.includes("26 buy / 3 hold / 0 sell"),
    "expected ratings mix",
  );
  assert(
    items[0].body?.includes(
      "Historical target change vs previous point: +4.90%",
    ),
    "expected target change",
  );
});

Deno.test("Nasdaq earnings surprise rows become execution evidence", () => {
  const fetchedAt = new Date("2026-06-04T12:00:00.000Z");
  const items = buildNasdaqEarningsSurpriseItems({
    ticker: "MU",
    fetchedAt,
    limit: 2,
    response: {
      data: {
        symbol: "MU",
        earningsSurpriseTable: {
          rows: [
            {
              fiscalQtrEnd: "Feb 2026",
              dateReported: "3/18/2026",
              eps: 12.08,
              consensusForecast: "8.64",
              percentageSurprise: "39.81",
            },
            {
              fiscalQtrEnd: "Nov 2025",
              dateReported: "12/17/2025",
              eps: 4.61,
              consensusForecast: "3.67",
              percentageSurprise: "25.61",
            },
            {
              fiscalQtrEnd: "Aug 2025",
              dateReported: "9/23/2025",
              percentageSurprise: "-5.00",
            },
          ],
        },
      },
    },
  });

  assert(items.length === 1, "expected one earnings surprise item");
  assert(
    items[0].source === "nasdaq_earnings_surprise",
    "expected earnings surprise source",
  );
  assert(items[0].sourceType === "company", "expected company source type");
  assert(
    items[0].body?.includes("Latest EPS surprise: +39.81%"),
    "expected latest surprise",
  );
  assert(
    items[0].body?.includes("Average surprise across 2 rows: +32.71%"),
    "expected average surprise",
  );
  assert(
    items[0].publishedAt.toISOString().startsWith("2026-03-18"),
    "expected reported date",
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
