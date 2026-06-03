import type {
  IntelEventCluster,
  IntelHorizon,
  IntelRawItem,
  IntelReport,
  MarketSnapshot,
  UniverseEntry,
} from "./types.ts";

type ReportNarrative = {
  telegramSummary?: unknown;
  executiveSummary?: unknown;
  itemSummaries?: unknown;
};

const ICON_FIRE = "\u{1F525}";
const ICON_SIREN = "\u{1F6A8}";
const ICON_WARNING = "\u{26A0}\u{FE0F}";

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

function eventIcon(event: IntelEventCluster) {
  if (event.score >= 80) {
    return ICON_FIRE;
  }
  if (event.urgency === "high") {
    return ICON_SIREN;
  }
  if (event.directionHint === "negative") {
    return ICON_WARNING;
  }
  return "-";
}

function buildFallbackTelegramSummary(
  horizon: IntelHorizon,
  events: IntelEventCluster[],
  snapshots: Map<string, MarketSnapshot>,
) {
  const top = events.slice(0, 5);
  if (top.length === 0) {
    return `${ICON_FIRE} Market Intel: ${horizon}\n\nNo high-confidence catalysts found in this run. Full report attached.`;
  }

  return [
    `${ICON_FIRE} Market Intel: ${horizon}`,
    "",
    ...top.map((event, index) => {
      const snapshot = snapshots.get(event.ticker);
      const move = snapshot
        ? ` ${formatSignedPercent(snapshot.percentChange)}`
        : "";
      return `${index + 1}. ${eventIcon(event)} ${event.ticker}${move} - ${event.eventType.replaceAll(
        "_",
        " ",
      )} (${event.score}/100)`;
    }),
    "",
    "Full report attached.",
  ].join("\n");
}

function buildFallbackExecutiveSummary(events: IntelEventCluster[]) {
  if (events.length === 0) {
    return "No high-confidence catalysts were found in the scanned universe. This can mean either a quiet window or source/API gaps during the run.";
  }

  const hottest = events[0];
  return `Top catalyst is ${hottest.ticker}: ${hottest.summary}. The report is ranked by freshness, source quality, portfolio/watchlist relevance, and market reaction.`;
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
  events: IntelEventCluster[],
  rawItems: IntelRawItem[],
  snapshots: Map<string, MarketSnapshot>,
) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey || events.length === 0) {
    return null;
  }

  const rawById = new Map(rawItems.map((item) => [item.id, item]));
  const payload = {
    horizon,
    events: events.slice(0, 12).map((event) => ({
      ticker: event.ticker,
      score: event.score,
      type: event.eventType,
      direction: event.directionHint,
      urgency: event.urgency,
      summary: event.summary,
      scoreReasons: event.scoreReasons,
      market: snapshots.get(event.ticker),
      evidence: event.evidenceItemIds.slice(0, 4).map((id) => {
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
                "You write concise market intelligence for a human trader. No buy/sell orders. Return strict JSON with telegramSummary, executiveSummary, and itemSummaries keyed by ticker.",
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

function itemSummaryFor(
  event: IntelEventCluster,
  narrative: ReportNarrative | null,
) {
  const itemSummaries = narrative?.itemSummaries as
    | Record<string, unknown>
    | undefined;
  const value = itemSummaries?.[event.ticker];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : event.summary;
}

function evidenceHtml(
  event: IntelEventCluster,
  rawItems: Map<number, IntelRawItem>,
) {
  return event.evidenceItemIds
    .slice(0, 6)
    .map((id) => {
      const item = rawItems.get(id);
      if (!item) {
        return "";
      }

      const title = escapeHtml(item.title);
      const label = `${escapeHtml(item.source)} - ${formatAge(
        item.publishedAt,
        new Date(),
      )}`;
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${title}</a>`
        : title;
      return `<li>${link}<div class="footnote">${label}</div></li>`;
    })
    .filter(Boolean)
    .join("");
}

function eventCardHtml(
  event: IntelEventCluster,
  rawItems: Map<number, IntelRawItem>,
  snapshots: Map<string, MarketSnapshot>,
  narrative: ReportNarrative | null,
) {
  const snapshot = snapshots.get(event.ticker);
  const marketBits = [
    `price ${snapshot ? `$${snapshot.price.toFixed(2)}` : "n/a"}`,
    `move ${formatSignedPercent(snapshot?.percentChange)}`,
    snapshot?.volumeRatio
      ? `volume ${snapshot.volumeRatio.toFixed(2)}x`
      : "volume n/a",
  ];
  return `
    <section class="event">
      <div class="event-head">
        <div>
          <div class="ticker">${escapeHtml(event.ticker)}</div>
          <h2>${escapeHtml(event.title)}</h2>
        </div>
        <div class="score">${event.score}</div>
      </div>
      <div class="tags">
        <span>${escapeHtml(event.eventType.replaceAll("_", " "))}</span>
        <span>${escapeHtml(event.urgency)}</span>
        <span>${escapeHtml(event.directionHint)}</span>
      </div>
      <p>${escapeHtml(itemSummaryFor(event, narrative))}</p>
      <div class="metrics">${marketBits.map((bit) => `<span>${escapeHtml(bit)}</span>`).join("")}</div>
      <div class="reasons">${event.scoreReasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
      <h3>Evidence</h3>
      <ol>${evidenceHtml(event, rawItems)}</ol>
    </section>
  `;
}

function buildHtmlReport(args: {
  horizon: IntelHorizon;
  generatedAt: Date;
  universeSummary: string;
  events: IntelEventCluster[];
  rawItems: IntelRawItem[];
  snapshots: Map<string, MarketSnapshot>;
  executiveSummary: string;
  narrative: ReportNarrative | null;
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const cards = args.events
    .slice(0, 30)
    .map((event) =>
      eventCardHtml(event, rawById, args.snapshots, args.narrative),
    )
    .join("");
  const rawRows = args.rawItems
    .slice(0, 120)
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.sourceType)}</td>
        <td>${escapeHtml(item.publishedAt.toISOString())}</td>
        <td>${
          item.url
            ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
            : escapeHtml(item.title)
        }</td>
      </tr>
    `,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Market Intel ${escapeHtml(args.horizon)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #171a1f; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 20px 56px; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; line-height: 1.1; }
    .meta { color: #667085; font-size: 14px; }
    .summary { background: #ffffff; border: 1px solid #d9dee7; border-radius: 8px; padding: 18px 20px; margin: 18px 0 24px; }
    .event { background: #ffffff; border: 1px solid #d9dee7; border-radius: 8px; padding: 18px 20px; margin: 14px 0; }
    .event-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .ticker { font-size: 13px; color: #344054; font-weight: 700; letter-spacing: .04em; }
    h2 { margin: 4px 0 12px; font-size: 20px; line-height: 1.25; }
    h3 { margin: 18px 0 8px; font-size: 14px; color: #344054; }
    .score { min-width: 56px; text-align: center; border-radius: 8px; background: #171a1f; color: #fff; font-size: 22px; font-weight: 800; padding: 10px 8px; }
    .tags, .metrics, .reasons { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
    .tags span { background: #e8f0fe; color: #174ea6; border-radius: 999px; padding: 4px 9px; font-size: 12px; }
    .metrics span { background: #eef6f1; color: #137333; border-radius: 999px; padding: 4px 9px; font-size: 12px; }
    .reasons span { background: #f2f4f7; color: #475467; border-radius: 999px; padding: 4px 9px; font-size: 12px; }
    p { line-height: 1.55; }
    ol { margin: 8px 0 0 20px; padding: 0; }
    li { margin: 8px 0; }
    a { color: #0b57d0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footnote { color: #667085; font-size: 12px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9dee7; border-radius: 8px; overflow: hidden; }
    th, td { border-bottom: 1px solid #eaecf0; padding: 8px 10px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: #f2f4f7; color: #344054; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Market Intel ${escapeHtml(args.horizon)}</h1>
      <div class="meta">Generated ${escapeHtml(args.generatedAt.toLocaleString())} &middot; Universe ${escapeHtml(args.universeSummary)}</div>
    </header>
    <section class="summary">
      <strong>Executive Summary</strong>
      <p>${escapeHtml(args.executiveSummary)}</p>
    </section>
    ${cards || '<section class="event"><p>No ranked catalyst events found.</p></section>'}
    <h2>Source Footnotes</h2>
    <table>
      <thead><tr><th>Source</th><th>Type</th><th>Published</th><th>Item</th></tr></thead>
      <tbody>${rawRows}</tbody>
    </table>
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
  snapshots: MarketSnapshot[];
}) {
  const generatedAt = new Date();
  const snapshots = new Map(
    args.snapshots.map((snapshot) => [snapshot.ticker, snapshot]),
  );
  const narrative = await callReportModel(
    args.horizon,
    args.events,
    args.rawItems,
    snapshots,
  );
  const telegramSummary =
    typeof narrative?.telegramSummary === "string" &&
    narrative.telegramSummary.trim()
      ? narrative.telegramSummary.trim().slice(0, 3500)
      : buildFallbackTelegramSummary(args.horizon, args.events, snapshots);
  const executiveSummary =
    typeof narrative?.executiveSummary === "string" &&
    narrative.executiveSummary.trim()
      ? narrative.executiveSummary.trim()
      : buildFallbackExecutiveSummary(args.events);
  const html = buildHtmlReport({
    horizon: args.horizon,
    generatedAt,
    universeSummary: args.universeSummary,
    events: args.events,
    rawItems: args.rawItems,
    snapshots,
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
    events: args.events,
  } satisfies IntelReport;
}

export function intelReportFileName(report: IntelReport) {
  const timestamp = report.generatedAt
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `market-intel-${report.horizon}-${timestamp}.html`;
}

export function summarizeMarketSnapshot(snapshot?: MarketSnapshot) {
  if (!snapshot) {
    return "market n/a";
  }
  return `$${snapshot.price.toFixed(2)} ${formatSignedPercent(snapshot.percentChange)} vol ${formatNumber(snapshot.volume)}`;
}
