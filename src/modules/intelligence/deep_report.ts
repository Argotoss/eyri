import type {
  DeepResearchData,
  DeepResearchTheme,
  FundamentalSnapshot,
  IntelEventCluster,
  IntelHorizon,
  IntelRawItem,
  IntelReport,
  MarketSnapshot,
  SourceDiagnostic,
  StockIntel,
  UniverseEntry,
} from "./types.ts";
import { recordModelUsage } from "./model_usage.ts";

type DeepNarrative = {
  executiveSummary?: unknown;
  thesis?: unknown;
  themeNotes?: unknown;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', "&quot;");
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

function formatPercent(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
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

function sourceTimeLabel(item: IntelRawItem) {
  const now = new Date();
  if (
    item.source === "gdelt" &&
    item.discoveredAt &&
    item.discoveredAt.getTime() === item.publishedAt.getTime()
  ) {
    return `seen by GDELT ${formatAge(item.discoveredAt, now)}`;
  }
  if (item.discoveredAt) {
    return `published ${formatAge(item.publishedAt, now)}; seen ${formatAge(item.discoveredAt, now)}`;
  }
  return `published ${formatAge(item.publishedAt, now)}`;
}

function modelName() {
  return (
    Deno.env.get("INTEL_DEEP_REPORT_MODEL")?.trim() ||
    Deno.env.get("INTEL_REPORT_MODEL")?.trim() ||
    "openai/gpt-5.4-mini"
  );
}

function parseJsonObject(value: string): DeepNarrative | null {
  const trimmed = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as DeepNarrative;
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return null;
    }
    try {
      return JSON.parse(objectMatch[0]) as DeepNarrative;
    } catch {
      return null;
    }
  }
}

function compactEvidence(
  theme: DeepResearchTheme,
  rawById: Map<number, IntelRawItem>,
) {
  return theme.evidenceItemIds.slice(0, 12).map((id) => {
    const item = rawById.get(id);
    return item
      ? {
          id,
          source: item.source,
          title: item.title,
          publishedAt: item.publishedAt.toISOString(),
          text: `${item.title}\n${item.body ?? ""}`.slice(0, 900),
        }
      : { id };
  });
}

async function callDeepNarrativeModel(args: {
  horizon: IntelHorizon;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
}) {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey) {
    return null;
  }

  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const payload = {
    horizon: args.horizon,
    stock: {
      ticker: args.stock.ticker,
      companyName: args.stock.companyName,
      score: args.stock.score,
      confidence: args.stock.confidence,
      verdict: args.stock.verdict,
      market: args.stock.market,
      fundamentals: args.stock.fundamentals,
    },
    sourceDepth: {
      rawItemCount: args.research.rawItemCount,
      relevantItemCount: args.research.relevantItemCount,
      sourceCount: args.research.sourceCount,
      dataQuality: args.research.dataQuality,
    },
    themes: args.research.themes.slice(0, 10).map((theme) => ({
      title: theme.title,
      direction: theme.direction,
      confidence: theme.confidence,
      score: theme.score,
      summary: theme.summary,
      keyFacts: theme.keyFacts,
      evidence: compactEvidence(theme, rawById),
    })),
  };

  try {
    const model = modelName();
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/Argotoss/eyri",
          "X-Title": "Eyri Deep Market Intelligence",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You write deep stock research for a human trader. Return strict JSON with executiveSummary, thesis, and themeNotes keyed by theme title. Be specific, concise, and evidence-grounded. Do not issue buy/sell orders.",
            },
            { role: "user", content: JSON.stringify(payload) },
          ],
          temperature: 0.15,
          response_format: { type: "json_object" },
          usage: { include: true },
        }),
      },
    );
    if (!response.ok) {
      console.error(`OpenRouter deep report failed ${response.status}`);
      return null;
    }
    const data = await response.json();
    recordModelUsage({ stage: "deep_report", model, usage: data?.usage });
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? parseJsonObject(content) : null;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function fallbackExecutiveSummary(
  stock: StockIntel,
  research: DeepResearchData,
) {
  const topPackets = research.evidencePackets
    .slice(0, 3)
    .map(
      (packet) => `${packet.title} (${packet.score}/100, ${packet.direction})`,
    )
    .join("; ");
  return `${stock.ticker} deep scan collected ${research.rawItemCount} raw items, kept ${research.relevantItemCount} relevant items, rejected ${research.noiseRejectedCount} low-signal items, and produced ${research.evidencePackets.length} evidence packets. Top evidence: ${topPackets || "none"}.`;
}

function themeNote(theme: DeepResearchTheme, narrative: DeepNarrative | null) {
  const notes = narrative?.themeNotes as Record<string, unknown> | undefined;
  const note = notes?.[theme.title];
  return typeof note === "string" && note.trim() ? note.trim() : theme.summary;
}

function telegramSummary(args: {
  stock: StockIntel;
  research: DeepResearchData;
  executiveSummary: string;
}) {
  const topPackets = args.research.evidencePackets
    .slice(0, 4)
    .map(
      (packet, index) =>
        `${index + 1}. ${packet.title}: ${packet.score}/100 ${packet.direction}`,
    )
    .join("\n");

  return [
    `Deep Intel ${args.stock.ticker}`,
    `${args.research.rawItemCount} raw / ${args.research.relevantItemCount} relevant / ${args.research.noiseRejectedCount} noise / ${args.research.sourceCount} sources`,
    `${args.stock.verdict} (${args.stock.score}/100, ${args.stock.confidence})`,
    "",
    topPackets || "No strong evidence packets extracted.",
    "",
    args.research.dataQuality[0],
    "Full research report attached.",
  ].join("\n");
}

function metric(label: string, value: string) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function marketMetrics(snapshot?: MarketSnapshot) {
  return [
    metric("Price", formatMoney(snapshot?.price)),
    metric("Move", formatPercent(snapshot?.percentChange)),
    metric(
      "Day range",
      `${formatMoney(snapshot?.dayLow)} - ${formatMoney(snapshot?.dayHigh)}`,
    ),
    metric(
      "52w range",
      `${formatMoney(snapshot?.fiftyTwoWeekLow)} - ${formatMoney(snapshot?.fiftyTwoWeekHigh)}`,
    ),
    metric("Volume", formatNumber(snapshot?.volume)),
    metric(
      "Rel volume",
      snapshot?.volumeRatio ? `${snapshot.volumeRatio.toFixed(2)}x` : "n/a",
    ),
  ].join("");
}

function fundamentalMetrics(fundamentals?: FundamentalSnapshot) {
  return [
    metric(
      "P/E",
      fundamentals?.estimatedPe ? fundamentals.estimatedPe.toFixed(1) : "n/a",
    ),
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

function evidenceList(
  theme: DeepResearchTheme,
  rawById: Map<number, IntelRawItem>,
) {
  return theme.evidenceItemIds
    .slice(0, 20)
    .map((id) => {
      const item = rawById.get(id);
      if (!item) {
        return "";
      }
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<li>${link}<span>${escapeHtml(item.source)} - ${escapeHtml(sourceTimeLabel(item))}</span></li>`;
    })
    .filter(Boolean)
    .join("");
}

function packetCard(
  packet: DeepResearchData["evidencePackets"][number],
  rawById: Map<number, IntelRawItem>,
) {
  const evidence = packet.evidenceItemIds
    .slice(0, 8)
    .map((id) => {
      const item = rawById.get(id);
      if (!item) {
        return "";
      }
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<li>${link}<span>${escapeHtml(item.source)} - ${escapeHtml(sourceTimeLabel(item))}</span></li>`;
    })
    .filter(Boolean)
    .join("");
  const facts = packet.keyFacts.length
    ? `<ul>${packet.keyFacts
        .slice(0, 6)
        .map((fact) => `<li>${escapeHtml(fact)}</li>`)
        .join("")}</ul>`
    : "<p>No concrete numeric facts extracted.</p>";

  return `<section class="packet">
    <div class="theme-head">
      <div>
        <h2>${escapeHtml(packet.title)}</h2>
        <div class="meta">${escapeHtml(packet.direction)} / ${escapeHtml(packet.confidence)} / ${packet.sourceCount} source${packet.sourceCount === 1 ? "" : "s"} / ${packet.noiseRejectedCount} rejected</div>
      </div>
      <div class="score">${packet.score}</div>
    </div>
    <p><strong>Conclusion:</strong> ${escapeHtml(packet.conclusion)}</p>
    <p>${escapeHtml(packet.summary)}</p>
    <p class="why">${escapeHtml(packet.whyItMatters)}</p>
    <h3>Key Facts</h3>
    ${facts}
    <h3>Best Evidence</h3>
    <ol class="evidence">${evidence}</ol>
  </section>`;
}

function themeCard(
  theme: DeepResearchTheme,
  rawById: Map<number, IntelRawItem>,
  narrative: DeepNarrative | null,
) {
  const facts = theme.keyFacts.length
    ? `<ul>${theme.keyFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`
    : "<p>No concrete numeric facts extracted for this theme.</p>";
  return `<section class="theme" id="${escapeHtmlAttribute(theme.key)}">
    <div class="theme-head">
      <div>
        <h2>${escapeHtml(theme.title)}</h2>
        <div class="meta">${escapeHtml(theme.direction)} / ${escapeHtml(theme.confidence)} / ${theme.sourceCount} source${theme.sourceCount === 1 ? "" : "s"}</div>
      </div>
      <div class="score">${theme.score}</div>
    </div>
    <p>${escapeHtml(themeNote(theme, narrative))}</p>
    <p class="why">${escapeHtml(theme.whyItMatters)}</p>
    <h3>Key Facts</h3>
    ${facts}
    <h3>Evidence</h3>
    <ol class="evidence">${evidenceList(theme, rawById)}</ol>
  </section>`;
}

function diagnosticsTable(diagnostics: SourceDiagnostic[]) {
  const rows = diagnostics
    .map(
      (diagnostic) => `<tr>
        <td>${escapeHtml(diagnostic.source)}</td>
        <td>${escapeHtml(diagnostic.label)}</td>
        <td><span class="status ${escapeHtmlAttribute(diagnostic.status)}">${escapeHtml(diagnostic.status)}</span></td>
        <td>${diagnostic.itemCount}</td>
        <td>${escapeHtml(diagnostic.message ?? "")}</td>
      </tr>`,
    )
    .join("");
  return `<details class="panel">
    <summary>Source Diagnostics</summary>
    <h2>Source Diagnostics</h2>
    <table>
      <thead><tr><th>Source</th><th>Step</th><th>Status</th><th>Items</th><th>Message</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function sourceAppendix(rawItems: IntelRawItem[], relevantIds: Set<number>) {
  const rows = rawItems
    .slice()
    .sort(
      (itemA, itemB) =>
        itemB.publishedAt.getTime() - itemA.publishedAt.getTime(),
    )
    .slice(0, 500)
    .map((item) => {
      const link = item.url
        ? `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtml(item.title)}</a>`
        : escapeHtml(item.title);
      return `<tr>
        <td>${relevantIds.has(item.id) ? "yes" : "no"}</td>
        <td>${escapeHtml(item.source)}</td>
        <td>${escapeHtml(item.sourceType)}</td>
        <td>${escapeHtml(sourceTimeLabel(item))}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("");

  return `<details class="panel">
    <summary>Source Appendix (${rawItems.length} items)</summary>
    <h2>Source Appendix</h2>
    <table>
      <thead><tr><th>Relevant</th><th>Source</th><th>Type</th><th>Time</th><th>Item</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

function buildHtml(args: {
  entry: UniverseEntry;
  horizon: IntelHorizon;
  generatedAt: Date;
  stock: StockIntel;
  research: DeepResearchData;
  rawItems: IntelRawItem[];
  relevantItemIds: number[];
  executiveSummary: string;
  narrative: DeepNarrative | null;
}) {
  const rawById = new Map(args.rawItems.map((item) => [item.id, item]));
  const relevantIds = new Set(args.relevantItemIds);
  const thesis =
    typeof args.narrative?.thesis === "string" && args.narrative.thesis.trim()
      ? args.narrative.thesis.trim()
      : args.stock.thesis;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Deep Intel ${escapeHtml(args.stock.ticker)} ${escapeHtml(args.horizon)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f7fa; color: #161b22; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 18px 60px; }
    h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.1; }
    h2 { margin: 0 0 10px; font-size: 20px; line-height: 1.25; }
    h3 { margin: 18px 0 8px; font-size: 13px; color: #344054; text-transform: uppercase; letter-spacing: .04em; }
    a { color: #0b57d0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: #667085; font-size: 13px; }
    .panel, .theme, .packet { background: #fff; border: 1px solid #d9dee7; border-radius: 8px; padding: 16px 18px; margin: 12px 0; }
    .summary { line-height: 1.55; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(280px, .8fr); gap: 14px; align-items: stretch; }
    .stat-grid, .metrics { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 8px; }
    .metric, .stat { background: #f7f8fb; border: 1px solid #eaecf0; border-radius: 6px; padding: 8px 10px; }
    .metric span, .stat span { display: block; color: #667085; font-size: 12px; }
    .metric strong, .stat strong { font-size: 15px; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .theme-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .score { min-width: 58px; text-align: center; border-radius: 8px; color: #fff; font-size: 24px; font-weight: 900; padding: 10px 8px; background: #344054; }
    .why { color: #475467; }
    ul { margin: 6px 0 0 20px; padding: 0; line-height: 1.45; }
    .evidence { margin: 6px 0 0 20px; padding: 0; }
    .evidence li { margin: 7px 0; }
    .evidence span { display: block; color: #667085; font-size: 12px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border-bottom: 1px solid #eaecf0; padding: 8px 9px; text-align: left; vertical-align: top; font-size: 12px; }
    th { background: #f2f4f7; color: #344054; }
    .status.ok { color: #137333; font-weight: 700; }
    .status.partial { color: #b06000; font-weight: 700; }
    .status.failed { color: #b42318; font-weight: 700; }
    summary { cursor: pointer; font-weight: 800; }
    @media (max-width: 820px) {
      .hero, .columns { grid-template-columns: 1fr; }
      .stat-grid, .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Deep Intel ${escapeHtml(args.stock.ticker)}</h1>
      <div class="meta">${escapeHtml(args.stock.companyName)} &middot; ${escapeHtml(args.horizon)} &middot; Generated ${escapeHtml(args.generatedAt.toLocaleString())}</div>
    </header>
    <section class="hero">
      <div class="panel summary">
        <h2>${escapeHtml(args.stock.verdict)}</h2>
        <p>${escapeHtml(args.executiveSummary)}</p>
        <p><strong>Thesis:</strong> ${escapeHtml(thesis)}</p>
      </div>
      <div class="panel">
        <div class="stat-grid">
          <div class="stat"><span>Stock score</span><strong>${args.stock.score}/100</strong></div>
          <div class="stat"><span>Confidence</span><strong>${escapeHtml(args.stock.confidence)}</strong></div>
          <div class="stat"><span>Raw items</span><strong>${args.research.rawItemCount}</strong></div>
          <div class="stat"><span>Relevant items</span><strong>${args.research.relevantItemCount}</strong></div>
          <div class="stat"><span>Sources</span><strong>${args.research.sourceCount}</strong></div>
          <div class="stat"><span>Evidence packets</span><strong>${args.research.evidencePackets.length}</strong></div>
          <div class="stat"><span>Noise rejected</span><strong>${args.research.noiseRejectedCount}</strong></div>
          <div class="stat"><span>Preset</span><strong>${escapeHtml(args.research.preset)}</strong></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>Market And Fundamentals</h2>
      <div class="columns">
        <div><h3>Market</h3><div class="metrics">${marketMetrics(args.stock.market)}</div></div>
        <div><h3>Fundamentals</h3><div class="metrics">${fundamentalMetrics(args.stock.fundamentals)}</div></div>
      </div>
    </section>
    <section class="panel">
      <h2>Data Quality</h2>
      <ul>${args.research.dataQuality.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </section>
    <section class="panel">
      <h2>Evidence Packet Summary</h2>
      <p>These are the compact packets the evaluator model should read first. Raw items that looked irrelevant, routine, or weak are excluded from packet synthesis.</p>
    </section>
    ${args.research.evidencePackets
      .slice(0, 10)
      .map((packet) => packetCard(packet, rawById))
      .join("")}
    <details class="panel">
      <summary>Legacy Theme View (${args.research.themes.length} themes)</summary>
      ${args.research.themes.map((theme) => themeCard(theme, rawById, args.narrative)).join("")}
    </details>
    ${diagnosticsTable(args.research.diagnostics)}
    ${sourceAppendix(args.rawItems, relevantIds)}
  </main>
</body>
</html>`;
}

export async function buildDeepIntelReport(args: {
  entry: UniverseEntry;
  horizon: IntelHorizon;
  rawItems: IntelRawItem[];
  relevantItemIds: number[];
  events: IntelEventCluster[];
  stock: StockIntel;
  research: DeepResearchData;
}) {
  const generatedAt = new Date();
  const narrative = await callDeepNarrativeModel({
    horizon: args.horizon,
    stock: args.stock,
    research: args.research,
    rawItems: args.rawItems,
  });
  const executiveSummary =
    typeof narrative?.executiveSummary === "string" &&
    narrative.executiveSummary.trim()
      ? narrative.executiveSummary.trim()
      : fallbackExecutiveSummary(args.stock, args.research);
  const html = buildHtml({
    ...args,
    generatedAt,
    executiveSummary,
    narrative,
  });

  return {
    horizon: args.horizon,
    generatedAt,
    universeSummary: `deep research ${args.entry.ticker}`,
    telegramSummary: telegramSummary({
      stock: args.stock,
      research: args.research,
      executiveSummary,
    }),
    executiveSummary,
    html,
    stocks: [args.stock],
    events: args.events,
    deepResearch: args.research,
  } satisfies IntelReport;
}
