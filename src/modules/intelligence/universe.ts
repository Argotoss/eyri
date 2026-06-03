import { getPositions, type User } from "../database/user.ts";
import type { Database } from "../database/setup.ts";
import { getUniverseSettings, listWatchlistTickers } from "./storage.ts";
import type { UniverseEntry, UniverseSource } from "./types.ts";

const SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";

const FALLBACK_SP500: UniverseEntry[] = [
  {
    ticker: "AAPL",
    name: "Apple",
    aliases: ["Apple Inc"],
    sector: "Information Technology",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    aliases: ["Microsoft Corporation"],
    sector: "Information Technology",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "NVDA",
    name: "Nvidia",
    aliases: ["NVIDIA Corporation"],
    sector: "Information Technology",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "AMZN",
    name: "Amazon",
    aliases: ["Amazon.com"],
    sector: "Consumer Discretionary",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "META",
    name: "Meta Platforms",
    aliases: ["Facebook"],
    sector: "Communication Services",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "GOOGL",
    name: "Alphabet",
    aliases: ["Google"],
    sector: "Communication Services",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "BRK.B",
    name: "Berkshire Hathaway",
    aliases: ["Berkshire"],
    sector: "Financials",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "JPM",
    name: "JPMorgan Chase",
    aliases: ["JPMorgan", "JP Morgan"],
    sector: "Financials",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "LLY",
    name: "Eli Lilly",
    aliases: ["Eli Lilly and Company"],
    sector: "Health Care",
    sources: ["sp500"],
    priority: 35,
  },
  {
    ticker: "AVGO",
    name: "Broadcom",
    aliases: ["Broadcom Inc"],
    sector: "Information Technology",
    sources: ["sp500"],
    priority: 35,
  },
];

let cachedSp500: UniverseEntry[] | null = null;

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase().replaceAll("/", ".");
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function simplifyCompanyName(name: string) {
  return name
    .replace(
      /\b(incorporated|inc|corp|corporation|company|co|ltd|plc)\b\.?/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function aliasesForName(name: string) {
  const simplified = simplifyCompanyName(name);
  return [...new Set([name, simplified].filter((alias) => alias.length >= 3))];
}

function addSource(entry: UniverseEntry, source: UniverseSource) {
  if (!entry.sources.includes(source)) {
    entry.sources.push(source);
  }
}

export function parseSp500Html(html: string): UniverseEntry[] {
  const tableMatch = html.match(
    /<table[^>]+id=["']constituents["'][\s\S]*?<\/table>/i,
  );
  if (!tableMatch) {
    return [];
  }

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const entries: UniverseEntry[] = [];
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (match) => decodeHtml(stripTags(match[1])).replace(/\s+/g, " ").trim(),
    );
    const [ticker, name, sector] = cells;
    if (!ticker || !name || ticker.toLowerCase() === "symbol") {
      continue;
    }

    entries.push({
      ticker: normalizeTicker(ticker),
      name,
      aliases: aliasesForName(name),
      sector,
      sources: ["sp500"],
      priority: 35,
    });
  }

  return entries;
}

export async function fetchSp500Universe() {
  if (cachedSp500) {
    return cachedSp500;
  }

  try {
    const response = await fetch(SP500_URL, {
      headers: { "User-Agent": "Eyri market intelligence" },
    });
    if (!response.ok) {
      cachedSp500 = FALLBACK_SP500;
      return cachedSp500;
    }

    const parsed = parseSp500Html(await response.text());
    cachedSp500 = parsed.length > 400 ? parsed : FALLBACK_SP500;
    return cachedSp500;
  } catch (error) {
    console.error(error);
    cachedSp500 = FALLBACK_SP500;
    return cachedSp500;
  }
}

export async function buildUniverse(
  database: Database,
  chatId: string | number,
  user: User,
) {
  const byTicker = new Map<string, UniverseEntry>();
  const upsert = (
    ticker: string,
    name: string,
    source: UniverseSource,
    priority: number,
    aliases: string[] = [],
    sector?: string,
  ) => {
    const normalizedTicker = normalizeTicker(ticker);
    const existing = byTicker.get(normalizedTicker);
    if (existing) {
      addSource(existing, source);
      existing.priority = Math.max(existing.priority, priority);
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
      if (!existing.sector && sector) {
        existing.sector = sector;
      }
      return;
    }

    byTicker.set(normalizedTicker, {
      ticker: normalizedTicker,
      name,
      aliases: [...new Set([...aliasesForName(name), ...aliases])],
      sector,
      sources: [source],
      priority,
    });
  };

  for (const ticker of Object.keys(getPositions(user))) {
    upsert(ticker, ticker, "portfolio", 100);
  }

  for (const item of listWatchlistTickers(database, chatId)) {
    upsert(item.ticker, item.ticker, "watchlist", 85);
  }

  const settings = getUniverseSettings(database, chatId);
  if (settings.sp500Enabled) {
    for (const entry of await fetchSp500Universe()) {
      upsert(
        entry.ticker,
        entry.name,
        "sp500",
        entry.priority,
        entry.aliases,
        entry.sector,
      );
    }
  }

  return [...byTicker.values()].sort((entryA, entryB) => {
    if (entryA.priority !== entryB.priority) {
      return entryB.priority - entryA.priority;
    }
    return entryA.ticker.localeCompare(entryB.ticker);
  });
}

export function summarizeUniverse(entries: UniverseEntry[]) {
  const portfolioCount = entries.filter((entry) =>
    entry.sources.includes("portfolio"),
  ).length;
  const watchlistCount = entries.filter((entry) =>
    entry.sources.includes("watchlist"),
  ).length;
  const sp500Count = entries.filter((entry) =>
    entry.sources.includes("sp500"),
  ).length;
  return `portfolio ${portfolioCount}, watchlist ${watchlistCount}, S&P 500 ${sp500Count}`;
}
