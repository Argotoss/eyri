import type {
  IntelHorizon,
  IntelRawItemInput,
  SourceCollectionResult,
  SourceDiagnostic,
  UniverseEntry,
} from "../types.ts";

const SEC_COMPANY_TICKERS_URL =
  "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions/";

const IMPORTANT_FORMS = new Set([
  "8-K",
  "10-Q",
  "10-K",
  "S-1",
  "S-3",
  "SC 13D",
  "SC 13G",
  "4",
]);

type SecTickerEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecSubmissions = {
  cik: string;
  name: string;
  tickers?: string[];
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
};

let cachedTickerMap: Map<string, SecTickerEntry> | null = null;

function envNumber(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
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

function isPriorityEntry(entry: UniverseEntry) {
  return (
    entry.sources.includes("portfolio") ||
    entry.sources.includes("watchlist") ||
    entry.sources.includes("target")
  );
}

function cikPadded(cik: number | string) {
  return String(cik).padStart(10, "0");
}

function cikArchive(cik: string) {
  return String(Number(cik));
}

function startDateForHorizon(horizon: IntelHorizon) {
  const days = horizon === "14d" ? 14 : horizon === "3d" ? 3 : 1;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

async function fetchJson<T>(url: string) {
  try {
    const response = await fetch(url, { headers: secHeaders() });
    if (!response.ok) {
      console.error(`SEC failed ${response.status}: ${url}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function makeDiagnostic(args: {
  label: string;
  startedAt: Date;
  status: SourceDiagnostic["status"];
  itemCount: number;
  message?: string;
  metadata?: Record<string, unknown>;
}): SourceDiagnostic {
  return {
    source: "sec",
    label: args.label,
    status: args.status,
    itemCount: args.itemCount,
    startedAt: args.startedAt,
    completedAt: new Date(),
    message: args.message,
    metadata: args.metadata,
  };
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

function filingUrl(cik: string, accession: string, primaryDocument?: string) {
  const archiveCik = cikArchive(cik);
  const accessionPath = accession.replaceAll("-", "");
  const document = primaryDocument || `${accession}-index.html`;
  return `https://www.sec.gov/Archives/edgar/data/${archiveCik}/${accessionPath}/${document}`;
}

function companyFilingsToRawItems(
  ticker: string,
  submissions: SecSubmissions,
  horizon: IntelHorizon,
) {
  const recent = submissions.filings?.recent;
  if (!recent?.accessionNumber || !recent.form || !recent.filingDate) {
    return [];
  }

  const startDate = startDateForHorizon(horizon);
  const items: IntelRawItemInput[] = [];
  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    const form = recent.form[index];
    const filingDate = recent.filingDate[index];
    const accession = recent.accessionNumber[index];
    if (!form || !filingDate || !accession || !IMPORTANT_FORMS.has(form)) {
      continue;
    }

    const publishedAt = new Date(`${filingDate}T21:00:00Z`);
    if (publishedAt < startDate) {
      continue;
    }

    const description = recent.primaryDocDescription?.[index] ?? "";
    const primaryDocument = recent.primaryDocument?.[index];
    const title = `${ticker} ${form}${description ? ` - ${description}` : ""}`;
    items.push({
      source: "sec",
      sourceType: "sec_filing",
      sourceId: `sec:${submissions.cik}:${accession}`,
      title,
      url: filingUrl(submissions.cik, accession, primaryDocument),
      publishedAt,
      body: [
        `${submissions.name} filed ${form}.`,
        description,
        recent.reportDate?.[index]
          ? `Report date: ${recent.reportDate[index]}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      rawPayload: {
        cik: submissions.cik,
        ticker,
        form,
        accession,
        filingDate,
        reportDate: recent.reportDate?.[index],
        primaryDocument,
        description,
      },
      tickers: [ticker],
    });
  }

  return items;
}

export async function collectSecItemsForTicker(
  entry: UniverseEntry,
  horizon: IntelHorizon,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const tickerMap = await loadTickerMap();
  const secEntry = tickerMap.get(normalizeTicker(entry.ticker));
  if (!secEntry) {
    return {
      items: [],
      diagnostics: [
        makeDiagnostic({
          label: `ticker-sec-filings:${entry.ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: `Missing SEC CIK for ${entry.ticker}`,
          metadata: { ticker: entry.ticker },
        }),
      ],
    };
  }

  const cik = cikPadded(secEntry.cik_str);
  const submissions = await fetchJson<SecSubmissions>(
    `${SEC_SUBMISSIONS_BASE_URL}CIK${cik}.json`,
  );
  if (!submissions) {
    return {
      items: [],
      diagnostics: [
        makeDiagnostic({
          label: `ticker-sec-filings:${entry.ticker}`,
          startedAt,
          status: "failed",
          itemCount: 0,
          message: `Failed SEC submissions for ${entry.ticker}`,
          metadata: { ticker: entry.ticker, cik },
        }),
      ],
    };
  }

  const items = companyFilingsToRawItems(entry.ticker, submissions, horizon);
  return {
    items,
    diagnostics: [
      makeDiagnostic({
        label: `ticker-sec-filings:${entry.ticker}`,
        startedAt,
        status: "ok",
        itemCount: items.length,
        metadata: { ticker: entry.ticker, cik },
      }),
    ],
  };
}

export async function collectSecItems(
  universe: UniverseEntry[],
  horizon: IntelHorizon,
): Promise<SourceCollectionResult> {
  const startedAt = new Date();
  const limit = envNumber("INTEL_SEC_TICKER_LIMIT", 25);
  const tickerMap = await loadTickerMap();
  const priorityEntries = universe.filter(isPriorityEntry).slice(0, limit);
  const items: IntelRawItemInput[] = [];
  const missingCikTickers: string[] = [];
  const failedTickers: string[] = [];

  for (const entry of priorityEntries) {
    const secEntry = tickerMap.get(normalizeTicker(entry.ticker));
    if (!secEntry) {
      missingCikTickers.push(entry.ticker);
      continue;
    }

    const cik = cikPadded(secEntry.cik_str);
    const submissions = await fetchJson<SecSubmissions>(
      `${SEC_SUBMISSIONS_BASE_URL}CIK${cik}.json`,
    );
    if (!submissions) {
      failedTickers.push(entry.ticker);
      continue;
    }

    items.push(...companyFilingsToRawItems(entry.ticker, submissions, horizon));
  }

  const status =
    failedTickers.length > 0
      ? "partial"
      : missingCikTickers.length === priorityEntries.length &&
          priorityEntries.length > 0
        ? "failed"
        : "ok";
  return {
    items,
    diagnostics: [
      makeDiagnostic({
        label: "priority-sec-filings",
        startedAt,
        status,
        itemCount: items.length,
        message:
          failedTickers.length > 0
            ? `Failed SEC submissions for ${failedTickers.join(", ")}`
            : undefined,
        metadata: {
          scannedTickers: priorityEntries.map((entry) => entry.ticker),
          missingCikTickers,
          failedTickers,
        },
      }),
    ],
  };
}
