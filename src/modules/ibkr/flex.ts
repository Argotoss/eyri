import type { Database } from "@db/sqlite";
import type { PortfolioPosition } from "./client.ts";
import { getDatabase } from "../storage/sqlite.ts";

const FLEX_BASE_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

export type FlexTrade = {
  ticker: string;
  date: Date;
  quantity: number;
  price: number | null;
  currency: string | null;
  assetCategory: string | null;
};

type FlexStatementRange = {
  from: Date;
  to: Date;
};

type XmlElement = {
  name: string;
  attrs: Record<string, string>;
};

type XmlTagSample = {
  name: string;
  attrs: string[];
};

type FlexTradeCacheRow = {
  fetched_at: string;
  trades_json: string;
};

type SerializedFlexTrade = Omit<FlexTrade, "date"> & {
  date: string;
};

const FLEX_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const loggedWarnings = new Set<string>();

function warnOnce(key: string, message: string) {
  if (loggedWarnings.has(key)) {
    return;
  }

  loggedWarnings.add(key);
  console.warn(message);
}

function getFlexConfig() {
  const token = Deno.env.get("IBKR_FLEX_TOKEN");
  const queryId = Deno.env.get("IBKR_FLEX_QUERY_ID");

  if (!token || !queryId) {
    warnOnce(
      "missing-flex-config",
      "IBKR Flex is not configured; open dates and trade history are unavailable.",
    );
    return null;
  }

  return { token, queryId };
}

function getNumberEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function getFlexPeriodDays() {
  return getNumberEnv("IBKR_FLEX_PERIOD_DAYS") ?? 365;
}

function getFlexHistoryDays() {
  return getNumberEnv("IBKR_FLEX_HISTORY_DAYS") ?? getFlexPeriodDays();
}

function ensureFlexCacheSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS flex_trade_cache (
      cache_key TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      trades_json TEXT NOT NULL
    )
  `);
}

function getFlexTradeCacheKey(queryId: string, days: number) {
  return `${queryId}:${days}`;
}

function deserializeTrades(value: string) {
  const trades = JSON.parse(value) as SerializedFlexTrade[];
  return trades.map((trade) => ({
    ...trade,
    date: new Date(trade.date),
  }));
}

function serializeTrades(trades: FlexTrade[]) {
  return JSON.stringify(
    trades.map((trade) => ({
      ...trade,
      date: trade.date.toISOString(),
    })),
  );
}

function isCacheFresh(fetchedAt: string) {
  const fetchedAtMs = new Date(fetchedAt).getTime();
  return (
    !Number.isNaN(fetchedAtMs) &&
    Date.now() - fetchedAtMs < FLEX_CACHE_MAX_AGE_MS
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function getXmlText(xml: string, tagName: string) {
  const escapedTagName = escapeRegExp(tagName);
  const match = xml.match(
    new RegExp(`<${escapedTagName}\\b[^>]*>([\\s\\S]*?)</${escapedTagName}>`),
  );
  return match ? decodeXmlEntities(match[1]).trim() : null;
}

function parseXmlAttributes(source: string) {
  const attrs: Record<string, string> = {};
  const attrPattern = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of source.matchAll(attrPattern)) {
    attrs[match[1]] = decodeXmlEntities(match[3]);
  }

  return attrs;
}

function getXmlElements(xml: string, tagNames: string[]) {
  const elements: XmlElement[] = [];
  for (const tagName of tagNames) {
    const escapedTagName = escapeRegExp(tagName);
    const tagPattern = new RegExp(`<${escapedTagName}\\b([^>]*)>`, "g");
    for (const match of xml.matchAll(tagPattern)) {
      elements.push({
        name: tagName,
        attrs: parseXmlAttributes(match[1]),
      });
    }
  }

  return elements;
}

function getFirstXmlElement(xml: string, tagName: string) {
  return getXmlElements(xml, [tagName]).at(0) ?? null;
}

function getXmlTagCounts(xml: string) {
  const counts = new Map<string, number>();
  const tagPattern = /<([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  for (const match of xml.matchAll(tagPattern)) {
    const name = match[1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function getXmlTagSamples(xml: string) {
  const samples = new Map<string, XmlTagSample>();
  const tagPattern = /<([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  for (const match of xml.matchAll(tagPattern)) {
    const name = match[1];
    if (samples.has(name)) {
      continue;
    }

    const attrs = Object.keys(parseXmlAttributes(match[2])).slice(0, 12);
    if (attrs.length === 0) {
      continue;
    }

    samples.set(name, { name, attrs });
  }

  return [...samples.values()];
}

function formatTopTagCounts(xml: string) {
  return getXmlTagCounts(xml)
    .slice(0, 12)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
}

function formatTagSamples(xml: string) {
  return getXmlTagSamples(xml)
    .slice(0, 8)
    .map((sample) => `${sample.name}(${sample.attrs.join(",")})`)
    .join("; ");
}

function logFlexStatementSummary(
  queryId: string,
  range: FlexStatementRange,
  xml: string,
  parsedTradeCount: number,
) {
  const status = getXmlText(xml, "Status") ?? "n/a";
  const errorCode = getXmlText(xml, "ErrorCode");
  const errorMessage = getXmlText(xml, "ErrorMessage");
  const statement = getFirstXmlElement(xml, "FlexStatement");
  const rangeLabel = `${formatFlexDate(range.from)}-${formatFlexDate(range.to)}`;
  const statementRange =
    statement?.attrs.fromDate && statement.attrs.toDate
      ? ` statementRange=${statement.attrs.fromDate}-${statement.attrs.toDate}`
      : "";
  const error = errorCode
    ? ` error=${errorCode}${errorMessage ? ` ${errorMessage}` : ""}`
    : "";

  console.info(
    `IBKR Flex statement ${queryId} requestedRange=${rangeLabel}${statementRange}: status=${status}${error}, parsedTrades=${parsedTradeCount}, bytes=${xml.length}, tags=[${formatTopTagCounts(
      xml,
    )}], samples=[${formatTagSamples(xml)}]`,
  );
}

async function fetchFlexXml(path: string, params: Record<string, string>) {
  const url = new URL(`${FLEX_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "eyri",
    },
  });
  if (!response.ok) {
    throw new Error(`IBKR Flex request failed: ${response.status}`);
  }

  return await response.text();
}

function formatFlexDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getFlexStatementRanges(days: number) {
  const today = new Date();
  const end = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const start = addDays(end, -(days - 1));
  const ranges: FlexStatementRange[] = [];

  for (let from = start; from <= end; from = addDays(from, 365)) {
    const to = new Date(Math.min(addDays(from, 364).getTime(), end.getTime()));
    ranges.push({ from, to });
  }

  return ranges;
}

async function getFlexStatement(
  token: string,
  queryId: string,
  range: FlexStatementRange,
) {
  const sendParams: Record<string, string> = {
    t: token,
    q: queryId,
    fd: formatFlexDate(range.from),
    td: formatFlexDate(range.to),
    v: "3",
  };

  const sendXml = await fetchFlexXml("/SendRequest", sendParams);
  const status = getXmlText(sendXml, "Status");
  if (status !== "Success") {
    const code = getXmlText(sendXml, "ErrorCode");
    const message = getXmlText(sendXml, "ErrorMessage");
    throw new Error(
      `IBKR Flex report generation failed${code ? ` (${code})` : ""}: ${
        message ?? "unknown error"
      }`,
    );
  }

  const referenceCode = getXmlText(sendXml, "ReferenceCode");
  if (!referenceCode) {
    throw new Error("IBKR Flex response did not include a reference code");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }

    const statementXml = await fetchFlexXml("/GetStatement", {
      t: token,
      q: referenceCode,
      v: "3",
    });
    const status = getXmlText(statementXml, "Status");
    if (!status || status === "Success") {
      return statementXml;
    }

    const code = getXmlText(statementXml, "ErrorCode");
    if (code !== "1003" && code !== "1004" && code !== "1019") {
      const message = getXmlText(statementXml, "ErrorMessage");
      throw new Error(
        `IBKR Flex statement retrieval failed (${code}): ${
          message ?? "unknown error"
        }`,
      );
    }
  }

  throw new Error("IBKR Flex statement was not ready in time");
}

async function fetchFreshFlexTrades(
  token: string,
  queryId: string,
  days: number,
) {
  const ranges = getFlexStatementRanges(days);
  const trades: FlexTrade[] = [];

  for (const range of ranges) {
    const statement = await getFlexStatement(token, queryId, range);
    const parsedTrades = parseTrades(statement);
    if (parsedTrades.length === 0) {
      logFlexStatementSummary(queryId, range, statement, parsedTrades.length);
    }
    trades.push(...parsedTrades);
  }

  return trades;
}

async function readCachedFlexTrades(cacheKey: string) {
  const db = await getDatabase();
  ensureFlexCacheSchema(db);

  return db
    .prepare(`
      SELECT fetched_at, trades_json
      FROM flex_trade_cache
      WHERE cache_key = ?
    `)
    .get(cacheKey) as FlexTradeCacheRow | undefined;
}

async function writeCachedFlexTrades(cacheKey: string, trades: FlexTrade[]) {
  const db = await getDatabase();
  ensureFlexCacheSchema(db);

  db.prepare(`
    INSERT INTO flex_trade_cache (
      cache_key,
      fetched_at,
      trades_json
    ) VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      trades_json = excluded.trades_json
  `).run(cacheKey, new Date().toISOString(), serializeTrades(trades));
}

async function deleteCachedFlexTrades(cacheKey: string) {
  const db = await getDatabase();
  ensureFlexCacheSchema(db);

  db.prepare(`
    DELETE FROM flex_trade_cache
    WHERE cache_key = ?
  `).run(cacheKey);
}

async function getCachedFlexTrades(days: number) {
  const config = getFlexConfig();
  if (!config) {
    return null;
  }

  const cacheKey = getFlexTradeCacheKey(config.queryId, days);
  const cached = await readCachedFlexTrades(cacheKey);
  if (cached && isCacheFresh(cached.fetched_at)) {
    const trades = deserializeTrades(cached.trades_json);
    if (trades.length > 0) {
      return trades;
    }

    warnOnce(
      `empty-flex-cache:${cacheKey}`,
      `IBKR Flex cache ${cacheKey} from ${cached.fetched_at} has no parsed trades; refreshing to inspect the Flex XML response.`,
    );
  }

  try {
    const trades = await fetchFreshFlexTrades(
      config.token,
      config.queryId,
      days,
    );
    if (trades.length === 0) {
      warnOnce(
        `empty-flex-fetch:${cacheKey}`,
        `IBKR Flex query ${cacheKey} returned no parsed trades; not writing cache.`,
      );
      await deleteCachedFlexTrades(cacheKey);
      return trades;
    }

    await writeCachedFlexTrades(cacheKey, trades);
    return trades;
  } catch (error) {
    if (cached) {
      console.error("Failed to refresh IBKR Flex trade cache:", error);
      const trades = deserializeTrades(cached.trades_json);
      if (trades.length === 0) {
        await deleteCachedFlexTrades(cacheKey);
        throw error;
      }

      return trades;
    }

    throw error;
  }
}

function getAttr(element: XmlElement, names: string[]) {
  for (const name of names) {
    const value = element.attrs[name];
    if (value) {
      return value;
    }
  }

  return null;
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const datePart = value.match(/\d{4}-?\d{2}-?\d{2}/)?.[0];
  if (!datePart) {
    return null;
  }

  const normalized = datePart.replaceAll("-", "");
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(4, 6));
  const day = Number(normalized.slice(6, 8));
  if ([year, month, day].some(Number.isNaN)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function getSignedQuantity(
  quantityValue: string | null,
  sideValue: string | null,
) {
  const quantity = Number(quantityValue);
  if (Number.isNaN(quantity) || quantity === 0) {
    return null;
  }

  const side = sideValue?.toUpperCase();
  if (side === "SELL" || side === "SLD" || side === "S") {
    return -Math.abs(quantity);
  }
  if (side === "BUY" || side === "BOT" || side === "B") {
    return Math.abs(quantity);
  }

  return quantity;
}

function parseQuantity(element: XmlElement) {
  const quantity = Number(
    getAttr(element, ["quantity", "qty", "shares", "Quantity", "Shares"]),
  );
  if (Number.isNaN(quantity) || quantity === 0) {
    return null;
  }

  const side = getAttr(element, [
    "buySell",
    "side",
    "Side",
    "transactionType",
    "TransactionType",
  ])?.toUpperCase();
  return getSignedQuantity(String(quantity), side ?? null);
}

function parsePrice(element: XmlElement) {
  const value = Number(
    getAttr(element, ["tradePrice", "TradePrice", "price", "Price"]),
  );
  return Number.isNaN(value) ? null : value;
}

function getTradeElements(xml: string) {
  return getXmlElements(xml, ["Trade", "TradeConfirm"]);
}

function parseTrades(xml: string) {
  const trades: FlexTrade[] = [];
  for (const element of getTradeElements(xml)) {
    const ticker = getAttr(element, [
      "symbol",
      "Symbol",
      "underlyingSymbol",
      "UnderlyingSymbol",
    ]);
    const date = parseDate(
      getAttr(element, [
        "tradeDate",
        "TradeDate",
        "dateTime",
        "DateTime",
        "transactionDate",
        "TransactionDate",
      ]),
    );
    const quantity = parseQuantity(element);

    if (!ticker || !date || quantity === null) {
      continue;
    }

    trades.push({
      ticker,
      date,
      quantity,
      price: parsePrice(element),
      currency: getAttr(element, ["currency", "Currency"]),
      assetCategory: getAttr(element, [
        "assetCategory",
        "AssetCategory",
        "ibAssetCategory",
        "IBAssetCategory",
      ]),
    });
  }

  return trades.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function getOpenDatesFromTrades(
  trades: FlexTrade[],
  positions: PortfolioPosition[],
) {
  const positionAmounts = new Map(
    positions.map((position) => [position.ticker, Math.abs(position.amount)]),
  );
  const lots = new Map<string, Array<{ date: Date; quantity: number }>>();

  for (const trade of trades) {
    const tickerLots = lots.get(trade.ticker) ?? [];
    if (trade.quantity > 0) {
      tickerLots.push({ date: trade.date, quantity: trade.quantity });
    } else {
      let remainingSale = Math.abs(trade.quantity);
      while (remainingSale > 0 && tickerLots.length > 0) {
        const lot = tickerLots[0];
        const consumed = Math.min(lot.quantity, remainingSale);
        lot.quantity -= consumed;
        remainingSale -= consumed;
        if (lot.quantity <= 0) {
          tickerLots.shift();
        }
      }
    }
    lots.set(trade.ticker, tickerLots);
  }

  const openDates = new Map<string, Date>();
  for (const [ticker, amount] of positionAmounts.entries()) {
    const remainingLots =
      lots.get(ticker)?.filter((lot) => lot.quantity > 0) ?? [];
    const remainingQuantity = remainingLots.reduce(
      (sum, lot) => sum + lot.quantity,
      0,
    );
    if (remainingQuantity < amount * 0.99) {
      continue;
    }

    const earliestDate = remainingLots.reduce(
      (earliest, lot) =>
        !earliest || lot.date < earliest ? lot.date : earliest,
      null as Date | null,
    );
    if (earliestDate) {
      openDates.set(ticker, earliestDate);
    }
  }

  return openDates;
}

export async function fetchFlexOpenDates(positions: PortfolioPosition[]) {
  if (positions.length === 0) {
    return new Map<string, Date>();
  }

  const trades = await getCachedFlexTrades(getFlexPeriodDays());
  if (!trades || trades.length === 0) {
    warnOnce(
      "no-flex-trades-for-open-dates",
      "IBKR Flex did not provide trades for open-date calculation.",
    );
    return new Map<string, Date>();
  }

  const openDates = getOpenDatesFromTrades(trades, positions);
  if (openDates.size === 0) {
    warnOnce(
      "no-flex-open-date-matches",
      "IBKR Flex trades were loaded, but no current positions could be matched to open dates.",
    );
  }

  return openDates;
}

export async function fetchFlexTrades() {
  return await getCachedFlexTrades(getFlexHistoryDays());
}
