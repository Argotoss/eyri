import type {
  IntelEventCluster,
  IntelHorizon,
  IntelRawItem,
  IntelReport,
  MarketSnapshot,
  StockIntel,
  UniverseEntry,
} from "./types.ts";

type ReportNarrative = {
  executiveSummary?: unknown;
  stockNotes?: unknown;
};

const ICON_FIRE = "\u{1F525}";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function formatSignedPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatMoney(value?: number, digits = 2) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  return `$${value.toFixed(digits)}`;
}

function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(2);
}

function formatAge(date: Date, now: Date) {
  const minutes = Math.max(0, (now.getTime() - date.getTime()) / 60_000);
  if (minutes < 90) {
    return `${Math.round(minutes)}m ago`;
  }
  const hours = minutes / 60;
  if (hours < 48) {
    return `${hours.toFixed(1)}h ago`;
  }
  return `${(hours / 24).toFixed(1)}d ago`;
}

function metric(label: string, value: string) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function confidenceClass(stock: StockIntel) {
  if (stock.confidence === "high") {
    return "high";
  }
  if (stock.confidence === "medium") {
    return "medium";
  }
  return "low";
}

function stockNoteFor(stock: StockIntel, narrative: ReportNarrative | null) {
  const notes = narrative?.stockNotes as Record<string, unknown> | undefined;
  const value = notes?.[stock.ticker];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : stock.thesis;
}

function buildFallbackTelegramSummary(
  horizon: IntelHorizon,
  stocks: StockIntel[],
) {
  const top = stocks.slice(0, 5);
  if (top.length === 0) {
    return `${ICON_FIRE} Market Intel ${horizon}\n\nNo high-confidence stock setups found. Full report attached.`;
  }

  return [
    `${ICON_FIRE} Market Intel ${horizon}`,
    "",
    ...top.map((stock, index) => {
      const move = stock.market
        ? ` ${formatSignedPercent(stock.market.percentChange)}`
        : "";
      return `${index + 1}. ${stock.ticker} ${stock.score}/100${move} - ${stock.verdict}`;
    }),
    "",
    "Full stock report attached.",
  ].join("\n");
}

function buildFallbackExecutiveSummary(stocks: StockIntel[]) {
  if (stocks.length === 0) {
    return "No stock-level setups survived filtering. This usually means the run found weak, duplicated, or low-confidence source items.";
  }

  const top = stocks[0];
  return `${top.ticker} is the top stock-level setup (${top.score}/100, ${top.confidence} confidence): ${top.thesis}`;
}

function modelName() {
  return Deno.env.get("INTEL_REPORT_MODEL")?.trim() || "openai/gpt-5.4-mini";
}

function parseJsonObject(value: string): ReportNarrative | null {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as ReportNarrative;
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[0]) as ReportNarrative;
    } catch {
      return null;
    }
  }
}

async function callReportModel(
  horizon: IntelHorizon,
  stocks: StockIntel[],
  rawItems: IntelRawItem[],
) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey || stocks.length === 0) {
    return null;
  }

  const rawById = new Map(rawItems.map((item) => [item.id, item]));
  const payload = {
    horizon,
    stocks: stocks.slice(0, 8).map((stock) => ({
      ticker: stock.ticker,
      companyName: stock.companyName,
      score: stock.score,
      confidence: stock.confidence,
      verdict: stock.verdict,
      thesis: stock.thesis,
      bullCase: stock.bullCase,
      bearCase: stock.bearCase,
      risks: stock.risks,
      scoreBreakdown: stock.scoreBreakdown,
      market: stock.market,
      fundamentals: stock.fundamentals,
      catalystTypes: [...new Set(stock.events.map((event) => event.eventType))],
      evidence: stock.evidenceItemIds.slice(0, 6).map((id) => {
        const item = rawById.get(id);
        return item
          ? {
              id,
              source: item.source,
              title: item.title,
              url: item.url,
              publishedAt: item.publishedAt,
            }
          : { id };
      }),
    })),
  };

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Argotoss/eyri",
          "X-Title": "Eyri Market Intelligence",
        },
        body: JSON.stringify({
          model: modelName(),
          messages: [
            {
              role: "system",
              content:
                "You write compact stock-level market intelligence. Do not write buy/sell orders. Return strict JSON with executiveSummary and stockNotes keyed by ticker. Be specific and avoid generic finance filler.",
            },
            {
              role: "user",
              content: JSON.stringify(payload),
            },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      },
    );
    if (!response.ok) {
      console.error(`OpenRouter report failed ${response.status}`);
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? parseJsonObject(content) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function topTable(stocks: StockIntel[]) {
  const rows = stocks
    .slice(0, 10)
    .map((stock, index) => {
      const move = formatSignedPercent(stock.market?.percentChange);
      const volume = stock.market?.volumeRatio
        ? `${stock.market.volumeRatio.toFixed(2)}x`
        : "n/a";
      return `<tr>
        <td>${index + 1}</td>
        <td><a href="#${escapeHtmlAttribute(stock.ticker)}">${escapeHtml(stock.ticker)}</a></td>
        <td><strong>${stock.score}</strong></td>
        <td><span class="pill ${confidenceClass(stock)}">${escapeHtml(stock.confidence)}</span></td>
        <td>${escapeHtml(move)}</td>
        <td>${escapeHtml(volume)}</td>
        <td>${escapeHtml(stock.verdict)}</td>
      </tr>`;
    })
    .join("");

  return `<section class="panel">
    <h2>Top Stock Setups</h2>
    <table>
      <thead><tr><th>#</th><th>Ticker</th><th>Score</th><th>Confidence</th><th>Move</th><th>Vol</th><th>Verdict</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">No stock setups found.</td></tr>'}</tbody>
    </table>
  </section>`;
}

function scoreBreakdownHtml(stock: StockIntel) {
  const rows = [
    ["Catalyst", stock.scoreBreakdown.catalyst],
    ["Market", stock.scoreBreakdown.market],
    ["Relevance", stock.scoreBreakdown.relevance],
    ["Fundamentals", stock.scoreBreakdown.fundamentals],
    ["Risk penalty", -stock.scoreBreakdown.riskPenalty],
  ];

  return `<div class="score-grid">${rows
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(String(label))}</span><strong>${Number(value) >= 0 ? "+" : ""}${value}</strong></div>`,
    )
    .join("")}</div>`;
}

function marketMetrics(stock: StockIntel) {
  const market = stock.market;
  return [
    metric("Price", formatMoney(market?.price)),
    metric("Move", formatSignedPercent(market?.percentChange)),
    metric(
      "Day range",
      `${formatMoney(market?.dayLow)} - ${formatMoney(market?.dayHigh)}`,
    ),
    metric(
      "52w range",
      `${formatMoney(market?.fiftyTwoWeekLow)} - ${formatMoney(market?.fiftyTwoWeekHigh)}`,
    ),
    metric("Volume", formatNumber(market?.volume)),
    metric(
      "Rel volume",
      market?.volumeRatio ? `${market.volumeRatio.toFixed(2)}x` : "n/a",
    ),
  ].join("");
}

function fundamentalMetrics(stock: StockIntel) {
  const fundamentals = stock.fundamentals;
  return [
    metric(
      "P/E",
      fundamentals?.estimatedPe ? fundamentals.estimatedPe.toFixed(1) : "n/a",
    ),
    metric("Forward P/E", "n/a"),
    metric("Revenue", formatMoney(fundamentals?.revenue, 0)),
    metric("Net income", formatMoney(fundamentals?.netIncome, 0)),
    metric("Diluted EPS", fundamentals?.epsDiluted?.toFixed(2) ?? "n/a"),
    metric("Cash", formatMoney(fundamentals?.cash, 0)),
    metric("Long debt", formatMoney(fundamentals?.longTermDebt, 0)),
    metric(
      "FY/period",
      fundamentals?.fiscalYear
        ? `${fundamentals.fiscalYear} ${fundamentals.fiscalPeriod ?? ""}`.trim()
        : "n/a",
    ),
  ].join("");
}

function listHtml(items: string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function catalystHtml(stock: StockIntel) {
  return stock.events
    .slice(0, 6)
    .map(
      (event) => `<div class="catalyst">
        <strong>${escapeHtml(event.eventType.replaceAll("_", " "))}</strong>
        <span>${escapeHtml(event.directionHint)} / ${escapeHtml(event.urgency)} / ${event.sourceCount} source${event.sourceCount === 1 ? "" : "s"}</span>
        <p>${escapeHtml(event.summary)}</p>
      </div>`,
    )
    .join("");
}

function evidenceHtml(stock: StockIntel, rawItems: Map<number, IntelRawItem>) {
  return stock.evidenceItemIds
    .slice(0, 10)
    .map((id) => {
      const item = rawItems.get(id);
      if (!item) {
        return "";
      }
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<li>${link}<span>${escapeHtml(item.source)} - ${formatAge(item.publishedAt, new Date())}</span></li>`;
    })
    .filter(Boolean)
    .join("");
}

function stockCardHtml(
  stock: StockIntel,
  rawItems: Map<number, IntelRawItem>,
  narrative: ReportNarrative | null,
) {
  return `<section class="stock" id="${escapeHtmlAttribute(stock.ticker)}">
    <div class="stock-head">
      <div>
        <div class="ticker">${escapeHtml(stock.ticker)} <span>${escapeHtml(stock.companyName)}</span></div>
        <h2>${escapeHtml(stock.verdict)}</h2>
      </div>
      <div class="score ${confidenceClass(stock)}">${stock.score}</div>
    </div>
    <p class="thesis">${escapeHtml(stockNoteFor(stock, narrative))}</p>
    ${scoreBreakdownHtml(stock)}
    <div class="columns">
      <div>
        <h3>Market</h3>
        <div class="metrics">${marketMetrics(stock)}</div>
      </div>
      <div>
        <h3>Fundamentals</h3>
        <div class="metrics">${fundamentalMetrics(stock)}</div>
      </div>
    </div>
    <div class="columns">
      <div><h3>Bull Case</h3>${listHtml(stock.bullCase)}</div>
      <div><h3>Bear / Risk</h3>${listHtml([...stock.bearCase, ...stock.risks].slice(0, 6))}</div>
    </div>
    <h3>Catalysts</h3>
    ${catalystHtml(stock)}
    <h3>Evidence</h3>
    <ol class="evidence">${evidenceHtml(stock, rawItems)}</ol>
  </section>`;
}

function sourceFootnotes(rawItems: IntelRawItem[]) {
  const rows = rawItems
    .slice(0, 160)
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.sourceType)}</td>
        <td>${escapeHtml(item.publishedAt.toISOString())}</td>
        <td>${
          item.url
            ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
            : escapeHtml(item.title)
        }</td>
      </tr>`,
    )
    .join("");

  return `<section class="panel">
    <h2>Source Footnotes</h2>
    <table>
      <thead><tr><th>Source</th><th>Type</th><th>Published</th><th>Item</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function buildHtmlReport(args: {
  horizon: IntelHorizon;
  generatedAt: Date;
  universeSummary: string;
  stocks: StockIntel[];
  rawItems: IntelRawItem[];
  executiveSummary: string;
  narrative: ReportNarrative | null;
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const hotStocks = args.stocks.filter((stock) => stock.score >= 60);
  const lowConfidence = args.stocks.filter((stock) => stock.score < 60);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Market Intel ${escapeHtml(args.horizon)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f7fa; color: #161b22; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 18px 56px; }
    header { margin-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.1; }
    h2 { margin: 0 0 12px; font-size: 20px; line-height: 1.25; }
    h3 { margin: 18px 0 8px; font-size: 13px; color: #344054; text-transform: uppercase; letter-spacing: .04em; }
    a { color: #0b57d0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #667085; font-size: 13px; }
    .panel, .stock { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px 18px; margin: 12px 0; }
    .summary { font-size: 15px; line-height: 1.55; }
    .stock-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
    .ticker { font-size: 20px; font-weight: 800; }
    .ticker span { color: #667085; font-size: 14px; font-weight: 600; margin-left: 8px; }
    .score { min-width: 58px; text-align: center; border-radius: 8px; color: #fff; font-size: 24px; font-weight: 900; padding: 10px 8px; background: #344054; }
    .score.high { background: #137333; }
    .score.medium { background: #b06000; }
    .score.low { background: #667085; }
    .pill { border-radius: 999px; padding: 3px 8px; color: #fff; font-size: 12px; font-weight: 700; }
    .pill.high { background: #137333; }
    .pill.medium { background: #b06000; }
    .pill.low { background: #667085; }
    .thesis { font-size: 15px; line-height: 1.55; margin: 8px 0 14px; }
    .score-grid { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: 8px; margin: 12px 0; }
    .score-grid div, .metric { background: #f7f8fb; border: 1px solid #eaecf0; border-radius: 6px; padding: 8px 10px; }
    .score-grid span, .metric span { display: block; color: #667085; font-size: 12px; }
    .score-grid strong, .metric strong { font-size: 15px; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(130px, 1fr)); gap: 8px; }
    ul { margin: 6px 0 0 20px; padding: 0; line-height: 1.45; }
    .catalyst { border-left: 3px solid #d0d5dd; padding-left: 10px; margin: 10px 0; }
    .catalyst strong { display: inline-block; margin-right: 8px; }
    .catalyst span { color: #667085; font-size: 12px; }
    .catalyst p { margin: 4px 0 0; line-height: 1.45; }
    .evidence { margin: 6px 0 0 20px; padding: 0; }
    .evidence li { margin: 7px 0; }
    .evidence span { display: block; color: #667085; font-size: 12px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border-bottom: 1px solid #eaecf0; padding: 8px 9px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: #f2f4f7; color: #344054; }
    @media (max-width: 760px) {
      .columns, .score-grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Market Intel ${escapeHtml(args.horizon)}</h1>
      <div class="meta">Generated ${escapeHtml(args.generatedAt.toLocaleString())} &middot; Universe ${escapeHtml(args.universeSummary)}</div>
    </header>
    <section class="panel summary">
      <strong>Executive Summary</strong>
      <p>${escapeHtml(args.executiveSummary)}</p>
    </section>
    ${topTable(args.stocks)}
    ${hotStocks.map((stock) => stockCardHtml(stock, rawById, args.narrative)).join("")}
    ${
      lowConfidence.length
        ? `<section class="panel"><h2>Low Confidence / Rejected Edge</h2><p>These mentions had weaker evidence, missing market context, or insufficient source support.</p></section>${lowConfidence
            .map((stock) => stockCardHtml(stock, rawById, args.narrative))
            .join("")}`
        : ""
    }
    ${sourceFootnotes(args.rawItems)}
  </main>
</body>
</html>`;
}

export async function buildIntelReport(args: {
  horizon: IntelHorizon;
  universe: UniverseEntry[];
  universeSummary: string;
  rawItems: IntelRawItem[];
  events: IntelEventCluster[];
  stocks: StockIntel[];
  snapshots: MarketSnapshot[];
}) {
  const generatedAt = new Date();
  const narrative = await callReportModel(
    args.horizon,
    args.stocks,
    args.rawItems,
  );
  const executiveSummary =
    typeof narrative?.executiveSummary === "string" &&
    narrative.executiveSummary.trim()
      ? narrative.executiveSummary.trim()
      : buildFallbackExecutiveSummary(args.stocks);
  const telegramSummary = buildFallbackTelegramSummary(
    args.horizon,
    args.stocks,
  );
  const html = buildHtmlReport({
    horizon: args.horizon,
    generatedAt,
    universeSummary: args.universeSummary,
    stocks: args.stocks,
    rawItems: args.rawItems,
    executiveSummary,
    narrative,
  });

  return {
    horizon: args.horizon,
    generatedAt,
    universeSummary: args.universeSummary,
    telegramSummary,
    executiveSummary,
    html,
    stocks: args.stocks,
    events: args.events,
  } satisfies IntelReport;
}

export function intelReportFileName(report: IntelReport) {
  const timestamp = report.generatedAt
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  if (report.deepResearch) {
    return `deep-intel-${report.deepResearch.ticker}-${report.horizon}-${timestamp}.html`;
  }
  return `market-intel-${report.horizon}-${timestamp}.html`;
}

export function summarizeMarketSnapshot(snapshot?: MarketSnapshot) {
  if (!snapshot) {
    return "market n/a";
  }
  return `$${snapshot.price.toFixed(2)} ${formatSignedPercent(snapshot.percentChange)} vol ${formatNumber(snapshot.volume)}`;
}
