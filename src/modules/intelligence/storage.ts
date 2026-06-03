import type { Database } from "../database/setup.ts";
import type {
  IntelHorizon,
  IntelRawItem,
  IntelRawItemInput,
  IntelReport,
  MarketSnapshot,
  SourceDiagnostic,
  TickerMention,
  UniverseSettings,
} from "./types.ts";

type WatchlistRow = {
  ticker: string;
  created_at: string;
};

type UniverseSettingsRow = {
  chat_id: string;
  sp500_enabled: number;
};

type RawItemRow = {
  id: number;
  source: string;
  source_type: string;
  source_id: string;
  title: string;
  url: string | null;
  published_at: string;
  fetched_at: string;
  body: string | null;
  raw_payload: string | null;
  raw_hash: string;
};

function toChatId(chatId: string | number) {
  return String(chatId);
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function stringifyPayload(payload: unknown) {
  if (payload === undefined) {
    return null;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ value: String(payload) });
  }
}

function stableRawIdentity(item: IntelRawItemInput) {
  return [
    item.source,
    item.sourceType,
    item.sourceId,
    item.url ?? "",
    item.publishedAt.toISOString(),
    item.title,
  ].join("\n");
}

async function sha256(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function rowToRawItem(row: RawItemRow): IntelRawItem {
  return {
    id: row.id,
    source: row.source,
    sourceType: row.source_type as IntelRawItem["sourceType"],
    sourceId: row.source_id,
    title: row.title,
    url: row.url ?? undefined,
    publishedAt: new Date(row.published_at),
    fetchedAt: new Date(row.fetched_at),
    body: row.body ?? undefined,
    rawPayload: row.raw_payload ? JSON.parse(row.raw_payload) : undefined,
    rawHash: row.raw_hash,
  };
}

export function ensureIntelligenceSchema(database: Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS intel_watchlist (
      chat_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (chat_id, ticker)
    );

    CREATE TABLE IF NOT EXISTS intel_universe_settings (
      chat_id TEXT PRIMARY KEY,
      sp500_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intel_source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      horizon TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS intel_source_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      metadata TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES intel_source_runs(id)
    );

    CREATE INDEX IF NOT EXISTS intel_source_run_steps_run_id_idx
      ON intel_source_run_steps(run_id);

    CREATE TABLE IF NOT EXISTS intel_raw_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      published_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      body TEXT,
      raw_payload TEXT,
      raw_hash TEXT NOT NULL UNIQUE
    );

    CREATE INDEX IF NOT EXISTS intel_raw_items_published_at_idx
      ON intel_raw_items(published_at);

    CREATE TABLE IF NOT EXISTS intel_ticker_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_item_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      confidence REAL NOT NULL,
      method TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (raw_item_id, ticker, method),
      FOREIGN KEY (raw_item_id) REFERENCES intel_raw_items(id)
    );

    CREATE INDEX IF NOT EXISTS intel_ticker_mentions_ticker_idx
      ON intel_ticker_mentions(ticker);

    CREATE TABLE IF NOT EXISTS intel_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      horizon TEXT NOT NULL,
      universe_summary TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      html TEXT NOT NULL,
      model_report TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS intel_report_items (
      report_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      score REAL NOT NULL,
      cluster_key TEXT NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (report_id, rank),
      FOREIGN KEY (report_id) REFERENCES intel_reports(id)
    );

    CREATE TABLE IF NOT EXISTS intel_market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      horizon TEXT NOT NULL,
      price REAL NOT NULL,
      previous_price REAL,
      close_price REAL,
      percent_change REAL,
      volume REAL,
      average_volume REAL,
      volume_ratio REAL,
      provider TEXT,
      source_ticker TEXT,
      fetched_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS intel_market_snapshots_ticker_horizon_idx
      ON intel_market_snapshots(ticker, horizon, fetched_at);
  `);
}

export function getUniverseSettings(
  database: Database,
  chatId: string | number,
): UniverseSettings {
  ensureIntelligenceSchema(database);
  const normalizedChatId = toChatId(chatId);
  database
    .prepare(`
      INSERT INTO intel_universe_settings (chat_id)
      VALUES (?)
      ON CONFLICT(chat_id) DO NOTHING
    `)
    .run(normalizedChatId);

  const row = database
    .prepare(`
      SELECT chat_id, sp500_enabled
      FROM intel_universe_settings
      WHERE chat_id = ?
    `)
    .get(normalizedChatId) as UniverseSettingsRow;

  return {
    chatId: row.chat_id,
    sp500Enabled: row.sp500_enabled === 1,
  };
}

export function setSp500Enabled(
  database: Database,
  chatId: string | number,
  enabled: boolean,
) {
  ensureIntelligenceSchema(database);
  database
    .prepare(`
      INSERT INTO intel_universe_settings (chat_id, sp500_enabled)
      VALUES (?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        sp500_enabled = excluded.sp500_enabled,
        updated_at = CURRENT_TIMESTAMP
    `)
    .run(toChatId(chatId), enabled ? 1 : 0);
}

export function addWatchlistTicker(
  database: Database,
  chatId: string | number,
  ticker: string,
  createdBy?: string | number,
) {
  ensureIntelligenceSchema(database);
  const normalizedTicker = normalizeTicker(ticker);
  if (!normalizedTicker) {
    return;
  }

  database
    .prepare(`
      INSERT INTO intel_watchlist (chat_id, ticker, created_by)
      VALUES (?, ?, ?)
      ON CONFLICT(chat_id, ticker) DO NOTHING
    `)
    .run(
      toChatId(chatId),
      normalizedTicker,
      createdBy ? String(createdBy) : null,
    );
}

export function removeWatchlistTicker(
  database: Database,
  chatId: string | number,
  ticker: string,
) {
  ensureIntelligenceSchema(database);
  database
    .prepare(`
      DELETE FROM intel_watchlist
      WHERE chat_id = ? AND ticker = ?
    `)
    .run(toChatId(chatId), normalizeTicker(ticker));
}

export function listWatchlistTickers(
  database: Database,
  chatId: string | number,
) {
  ensureIntelligenceSchema(database);
  const rows = database
    .prepare(`
      SELECT ticker, created_at
      FROM intel_watchlist
      WHERE chat_id = ?
      ORDER BY ticker
    `)
    .all(toChatId(chatId)) as WatchlistRow[];

  return rows.map((row) => ({
    ticker: row.ticker,
    createdAt: new Date(row.created_at),
  }));
}

export function createSourceRun(
  database: Database,
  chatId: string | number,
  horizon: IntelHorizon,
) {
  ensureIntelligenceSchema(database);
  database
    .prepare(`
      INSERT INTO intel_source_runs (chat_id, horizon)
      VALUES (?, ?)
    `)
    .run(toChatId(chatId), horizon);
  return Number(
    (
      database.prepare("SELECT last_insert_rowid() AS id").get() as {
        id: number;
      }
    ).id,
  );
}

export function finishSourceRun(
  database: Database,
  runId: number,
  status: "complete" | "failed",
  details?: unknown,
) {
  ensureIntelligenceSchema(database);
  database
    .prepare(`
      UPDATE intel_source_runs
      SET completed_at = CURRENT_TIMESTAMP,
        status = ?,
        details = ?
      WHERE id = ?
    `)
    .run(status, stringifyPayload(details), runId);
}

export function saveSourceDiagnostics(
  database: Database,
  runId: number,
  diagnostics: SourceDiagnostic[],
) {
  ensureIntelligenceSchema(database);
  const insert = database.prepare(`
    INSERT INTO intel_source_run_steps (
      run_id,
      source,
      label,
      status,
      item_count,
      message,
      metadata,
      started_at,
      completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const diagnostic of diagnostics) {
    insert.run(
      runId,
      diagnostic.source,
      diagnostic.label,
      diagnostic.status,
      diagnostic.itemCount,
      diagnostic.message ?? null,
      stringifyPayload(diagnostic.metadata),
      diagnostic.startedAt.toISOString(),
      diagnostic.completedAt.toISOString(),
    );
  }
}

export async function saveRawItems(
  database: Database,
  items: IntelRawItemInput[],
): Promise<IntelRawItem[]> {
  ensureIntelligenceSchema(database);
  const saved: IntelRawItem[] = [];
  const insert = database.prepare(`
    INSERT INTO intel_raw_items (
      source,
      source_type,
      source_id,
      title,
      url,
      published_at,
      fetched_at,
      body,
      raw_payload,
      raw_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(raw_hash) DO NOTHING
  `);
  const select = database.prepare(`
    SELECT
      id,
      source,
      source_type,
      source_id,
      title,
      url,
      published_at,
      fetched_at,
      body,
      raw_payload,
      raw_hash
    FROM intel_raw_items
    WHERE raw_hash = ?
  `);

  for (const item of items) {
    const fetchedAt = item.fetchedAt ?? new Date();
    const hash = await sha256(stableRawIdentity(item));
    insert.run(
      item.source,
      item.sourceType,
      item.sourceId,
      item.title.trim(),
      item.url ?? null,
      item.publishedAt.toISOString(),
      fetchedAt.toISOString(),
      item.body ?? null,
      stringifyPayload(item.rawPayload),
      hash,
    );

    const row = select.get(hash) as RawItemRow | undefined;
    if (row) {
      saved.push(rowToRawItem(row));
    }
  }

  return saved;
}

export function saveTickerMentions(
  database: Database,
  mentions: TickerMention[],
) {
  ensureIntelligenceSchema(database);
  const insert = database.prepare(`
    INSERT INTO intel_ticker_mentions (
      raw_item_id,
      ticker,
      confidence,
      method
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(raw_item_id, ticker, method) DO UPDATE SET
      confidence = excluded.confidence
  `);

  for (const mention of mentions) {
    insert.run(
      mention.rawItemId,
      normalizeTicker(mention.ticker),
      mention.confidence,
      mention.method,
    );
  }
}

export function saveMarketSnapshots(
  database: Database,
  snapshots: MarketSnapshot[],
) {
  ensureIntelligenceSchema(database);
  const insert = database.prepare(`
    INSERT INTO intel_market_snapshots (
      ticker,
      horizon,
      price,
      previous_price,
      close_price,
      percent_change,
      volume,
      average_volume,
      volume_ratio,
      provider,
      source_ticker,
      fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const snapshot of snapshots) {
    insert.run(
      normalizeTicker(snapshot.ticker),
      snapshot.horizon,
      snapshot.price,
      snapshot.previousPrice ?? null,
      snapshot.closePrice ?? null,
      snapshot.percentChange ?? null,
      snapshot.volume ?? null,
      snapshot.averageVolume ?? null,
      snapshot.volumeRatio ?? null,
      snapshot.provider ?? null,
      snapshot.sourceTicker ?? null,
      snapshot.fetchedAt.toISOString(),
    );
  }
}

export function saveReport(
  database: Database,
  chatId: string | number,
  report: IntelReport,
  modelReport?: unknown,
) {
  ensureIntelligenceSchema(database);
  database
    .prepare(`
      INSERT INTO intel_reports (
        chat_id,
        horizon,
        universe_summary,
        summary_text,
        html,
        model_report,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      toChatId(chatId),
      report.horizon,
      report.universeSummary,
      report.telegramSummary,
      report.html,
      stringifyPayload(modelReport),
      report.generatedAt.toISOString(),
    );

  const reportId = Number(
    (
      database.prepare("SELECT last_insert_rowid() AS id").get() as {
        id: number;
      }
    ).id,
  );
  const insertItem = database.prepare(`
    INSERT INTO intel_report_items (
      report_id,
      rank,
      ticker,
      score,
      cluster_key,
      title
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  report.events.forEach((event, index) => {
    insertItem.run(
      reportId,
      index + 1,
      event.ticker,
      event.score,
      event.clusterKey,
      event.title,
    );
  });

  return reportId;
}
