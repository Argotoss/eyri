import type { FundamentalSnapshot, MarketSnapshot } from "../types.ts";

const SEC_COMPANY_TICKERS_URL =
  "https://www.sec.gov/files/company_tickers.json";
const SEC_COMPANY_FACTS_BASE_URL =
  "https://data.sec.gov/api/xbrl/companyfacts/";

type SecTickerEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecFactUnit = {
  end?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
  val?: number;
};

type SecCompanyFacts = {
  cik: number;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<
      string,
      {
        units?: Record<string, SecFactUnit[]>;
      }
    >;
  };
};

let cachedTickerMap: Map<string, SecTickerEntry> | null = null;

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function secHeaders() {
  return {
    "User-Agent":
      Deno.env.get("SEC_USER_AGENT") ??
      "Eyri market intelligence contact@example.local",
  };
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function cikPadded(cik: number | string) {
  return String(cik).padStart(10, "0");
}

async function fetchJson<T>(url: string) {
  try {
    const response = await fetch(url, { headers: secHeaders() });
    if (!response.ok) {
      console.error(`[intel:fundamentals] ${response.status}: ${url}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(error);
    return null;
  }
}

async function loadTickerMap() {
  if (cachedTickerMap) {
    return cachedTickerMap;
  }

  const data = await fetchJson<Record<string, SecTickerEntry>>(
    SEC_COMPANY_TICKERS_URL,
  );
  const map = new Map<string, SecTickerEntry>();
  for (const entry of Object.values(data ?? {})) {
    map.set(normalizeTicker(entry.ticker), entry);
  }
  cachedTickerMap = map;
  return cachedTickerMap;
}

function factUnits(facts: SecCompanyFacts, names: string[]) {
  const usGaap = facts.facts?.["us-gaap"];
  for (const name of names) {
    const units = usGaap?.[name]?.units;
    if (!units) {
      continue;
    }
    return (
      units.USD ??
      units.shares ??
      units["USD/shares"] ??
      Object.values(units)[0]
    );
  }
  return undefined;
}

function latestFact(
  facts: SecCompanyFacts,
  names: string[],
  preferredForms = ["10-K", "10-Q"],
) {
  const units = factUnits(facts, names);
  if (!units) {
    return undefined;
  }

  return units
    .filter((unit) => Number.isFinite(unit.val))
    .filter((unit) => preferredForms.includes(unit.form ?? ""))
    .sort((unitA, unitB) => {
      const filedA = unitA.filed ? new Date(unitA.filed).getTime() : 0;
      const filedB = unitB.filed ? new Date(unitB.filed).getTime() : 0;
      return filedB - filedA;
    })[0];
}

function numericValue(fact?: SecFactUnit) {
  return fact && Number.isFinite(fact.val) ? fact.val : undefined;
}

async function fetchFundamentalSnapshot(
  ticker: string,
  market?: MarketSnapshot,
): Promise<FundamentalSnapshot | null> {
  const tickerMap = await loadTickerMap();
  const entry = tickerMap.get(normalizeTicker(ticker));
  if (!entry) {
    return null;
  }

  const facts = await fetchJson<SecCompanyFacts>(
    `${SEC_COMPANY_FACTS_BASE_URL}CIK${cikPadded(entry.cik_str)}.json`,
  );
  if (!facts) {
    return null;
  }

  const revenue = latestFact(facts, [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ]);
  const netIncome = latestFact(facts, ["NetIncomeLoss"]);
  const epsDiluted = latestFact(facts, ["EarningsPerShareDiluted"]);
  const cash = latestFact(facts, [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  ]);
  const longTermDebt = latestFact(facts, [
    "LongTermDebt",
    "LongTermDebtAndFinanceLeaseObligations",
  ]);
  const assets = latestFact(facts, ["Assets"]);
  const liabilities = latestFact(facts, ["Liabilities"]);
  const equity = latestFact(facts, ["StockholdersEquity"]);
  const eps = numericValue(epsDiluted);

  return {
    ticker: normalizeTicker(ticker),
    cik: cikPadded(entry.cik_str),
    source: "sec_companyfacts",
    fetchedAt: new Date(),
    fiscalYear: revenue?.fy ?? netIncome?.fy ?? epsDiluted?.fy,
    fiscalPeriod: revenue?.fp ?? netIncome?.fp ?? epsDiluted?.fp,
    revenue: numericValue(revenue),
    revenuePeriod: revenue?.form,
    netIncome: numericValue(netIncome),
    epsDiluted: eps,
    estimatedPe:
      eps && eps > 0 && market?.price ? market.price / eps : undefined,
    cash: numericValue(cash),
    longTermDebt: numericValue(longTermDebt),
    assets: numericValue(assets),
    liabilities: numericValue(liabilities),
    equity: numericValue(equity),
  };
}

export async function collectFundamentals(
  tickers: string[],
  snapshots: MarketSnapshot[],
) {
  const limit = envNumber("INTEL_FUNDAMENTAL_TICKER_LIMIT", 25);
  const snapshotsByTicker = new Map(
    snapshots.map((snapshot) => [snapshot.ticker, snapshot]),
  );
  const fundamentals: FundamentalSnapshot[] = [];
  for (const ticker of [...new Set(tickers.map(normalizeTicker))].slice(
    0,
    limit,
  )) {
    const snapshot = await fetchFundamentalSnapshot(
      ticker,
      snapshotsByTicker.get(ticker),
    );
    if (snapshot) {
      fundamentals.push(snapshot);
    }
  }
  return fundamentals;
}
