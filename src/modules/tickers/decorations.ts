import type { Database } from "@db/sqlite";
import type { CustomContext } from "../bot/types.ts";
import { getDatabase } from "../storage/sqlite.ts";

export type TickerDecoration = {
  tgEmoji: string;
  text: string;
  isCustomEmoji: boolean;
};

export type TickerDecorations = Record<string, TickerDecoration[]>;
export type TickerLabelPreferences = Record<string, boolean>;

type TickerDecorationRow = {
  ticker: string;
  emoji_index: number;
  tg_emoji: string;
  emoji_text: string;
  is_custom_emoji: number;
};

type TickerLabelPreferenceRow = {
  ticker: string;
  show_label: number;
};

type TableColumn = {
  name: string;
  pk: number;
};

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function splitGraphemes(text: string) {
  if ("Segmenter" in Intl) {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      (segment) => segment.segment,
    );
  }

  return [...text];
}

function tableExists(db: Database, tableName: string) {
  const row = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `)
    .get(tableName);
  return Boolean(row);
}

function getTableColumns(db: Database, tableName: string) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumn[];
}

function hasColumn(columns: TableColumn[], columnName: string) {
  return columns.some((column) => column.name === columnName);
}

function hasExpectedSchema(db: Database) {
  const columns = getTableColumns(db, "ticker_decorations");
  const primaryKeyColumns = columns
    .filter((column) => column.pk > 0)
    .sort((columnA, columnB) => columnA.pk - columnB.pk)
    .map((column) => column.name);

  return (
    hasColumn(columns, "user_id") &&
    hasColumn(columns, "ticker") &&
    hasColumn(columns, "emoji_index") &&
    hasColumn(columns, "tg_emoji") &&
    hasColumn(columns, "emoji_text") &&
    hasColumn(columns, "is_custom_emoji") &&
    primaryKeyColumns.join(",") === "user_id,ticker,emoji_index"
  );
}

function createTickerDecorationsTable(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticker_decorations (
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      emoji_index INTEGER NOT NULL,
      tg_emoji TEXT NOT NULL,
      emoji_text TEXT NOT NULL,
      is_custom_emoji INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, ticker, emoji_index)
    )
  `);
}

function createTickerLabelPreferencesTable(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticker_label_preferences (
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      show_label INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, ticker)
    )
  `);
}

function migrateTickerDecorationsTable(db: Database) {
  const columns = getTableColumns(db, "ticker_decorations");
  const hasEmojiIndex = hasColumn(columns, "emoji_index");

  db.exec(`
    ALTER TABLE ticker_decorations RENAME TO ticker_decorations_old;
  `);
  createTickerDecorationsTable(db);
  db.exec(`
    INSERT INTO ticker_decorations (
      user_id,
      ticker,
      emoji_index,
      tg_emoji,
      emoji_text,
      is_custom_emoji,
      created_at,
      updated_at
    )
    SELECT
      user_id,
      ticker,
      ${hasEmojiIndex ? "emoji_index" : "0"},
      tg_emoji,
      emoji_text,
      is_custom_emoji,
      created_at,
      updated_at
    FROM ticker_decorations_old;

    DROP TABLE ticker_decorations_old;
  `);
}

function ensureSchema(db: Database) {
  if (!tableExists(db, "ticker_decorations")) {
    createTickerDecorationsTable(db);
  } else if (!hasExpectedSchema(db)) {
    migrateTickerDecorationsTable(db);
  }

  createTickerLabelPreferencesTable(db);
}

export async function readTickerDecorations(
  userId: string | number,
): Promise<TickerDecorations> {
  const db = await getDatabase();
  ensureSchema(db);
  const rows = db
    .prepare(`
      SELECT ticker, emoji_index, tg_emoji, emoji_text, is_custom_emoji
      FROM ticker_decorations
      WHERE user_id = ?
      ORDER BY ticker, emoji_index
    `)
    .all(String(userId)) as TickerDecorationRow[];

  const decorations: TickerDecorations = {};
  for (const row of rows) {
    const ticker = normalizeTicker(row.ticker);
    decorations[ticker] ??= [];
    decorations[ticker].push({
      tgEmoji: row.tg_emoji,
      text: row.emoji_text,
      isCustomEmoji: row.is_custom_emoji === 1,
    });
  }
  return decorations;
}

export async function setTickerDecoration(
  userId: string | number,
  ticker: string,
  decorations: TickerDecoration[],
) {
  const db = await getDatabase();
  ensureSchema(db);
  const normalizedUserId = String(userId);
  const normalizedTicker = normalizeTicker(ticker);

  db.exec("BEGIN");
  try {
    db.prepare(`
      DELETE FROM ticker_decorations
      WHERE user_id = ? AND ticker = ?
    `).run(normalizedUserId, normalizedTicker);

    const insertDecoration = db.prepare(`
      INSERT INTO ticker_decorations (
        user_id,
        ticker,
        emoji_index,
        tg_emoji,
        emoji_text,
        is_custom_emoji
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    decorations.forEach((decoration, index) => {
      insertDecoration.run(
        normalizedUserId,
        normalizedTicker,
        index,
        decoration.tgEmoji,
        decoration.text,
        decoration.isCustomEmoji ? 1 : 0,
      );
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function readTickerLabelPreferences(
  userId: string | number,
): Promise<TickerLabelPreferences> {
  const db = await getDatabase();
  ensureSchema(db);
  const rows = db
    .prepare(`
      SELECT ticker, show_label
      FROM ticker_label_preferences
      WHERE user_id = ?
    `)
    .all(String(userId)) as TickerLabelPreferenceRow[];

  return Object.fromEntries(
    rows.map((row) => [normalizeTicker(row.ticker), row.show_label === 1]),
  );
}

export async function setTickerLabelPreference(
  userId: string | number,
  ticker: string,
  showLabel: boolean,
) {
  const db = await getDatabase();
  ensureSchema(db);
  db.prepare(`
    INSERT INTO ticker_label_preferences (
      user_id,
      ticker,
      show_label
    ) VALUES (?, ?, ?)
    ON CONFLICT(user_id, ticker) DO UPDATE SET
      show_label = excluded.show_label,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(userId), normalizeTicker(ticker), showLabel ? 1 : 0);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

export function formatTickerDecoration(decoration: TickerDecoration) {
  if (decoration.isCustomEmoji) {
    return `<tg-emoji emoji-id="${escapeHtmlAttribute(
      decoration.tgEmoji,
    )}">${escapeHtml(decoration.text)}</tg-emoji>`;
  }

  return escapeHtml(decoration.text);
}

export function formatTickerDecorations(decorations: TickerDecoration[]) {
  return decorations.map(formatTickerDecoration).join("");
}

export function formatDecoratedTicker(
  ticker: string,
  decorations?: TickerDecorations,
  labelPreferences?: TickerLabelPreferences,
) {
  const normalizedTicker = normalizeTicker(ticker);
  const escapedTicker = escapeHtml(ticker);
  const tickerDecorations = decorations?.[normalizedTicker];
  const decorated =
    tickerDecorations && tickerDecorations.length > 0
      ? formatTickerDecorations(tickerDecorations)
      : null;
  if (!decorated) {
    return escapedTicker;
  }

  return labelPreferences?.[normalizedTicker] === false
    ? decorated
    : `${decorated} ${escapedTicker}`;
}

export function parseDecorateCommand(ctx: CustomContext): {
  ticker: string;
  decorations: TickerDecoration[];
} | null {
  const text = ctx.message?.text;
  if (!text) {
    return null;
  }

  const entities = ctx.message.entities ?? [];
  const commandEntity = entities.find(
    (entity) => entity.type === "bot_command" && entity.offset === 0,
  );
  const fallbackCommand = text.match(/^\/decorate(?:@\w+)?/);
  const argsStart =
    commandEntity?.length ?? (fallbackCommand ? fallbackCommand[0].length : 0);
  if (argsStart === 0) {
    return null;
  }

  const leadingWhitespaceLength =
    text.slice(argsStart).match(/^\s*/)?.[0].length ?? 0;
  const argsBase = argsStart + leadingWhitespaceLength;
  const args = text.slice(argsBase);
  const tickerMatch = args.match(/^\S+/);
  if (!tickerMatch) {
    return null;
  }

  const ticker = normalizeTicker(tickerMatch[0]);
  const afterTicker = argsBase + tickerMatch[0].length;
  const decorationLeadingWhitespaceLength =
    text.slice(afterTicker).match(/^\s*/)?.[0].length ?? 0;
  const decorationStart = afterTicker + decorationLeadingWhitespaceLength;
  const decorationText = text.slice(decorationStart).trimEnd();
  if (!ticker || !decorationText) {
    return null;
  }

  const decorationEnd = decorationStart + decorationText.length;
  const customEmojiDecorations = entities
    .filter(
      (entity) =>
        entity.type === "custom_emoji" &&
        entity.offset >= decorationStart &&
        entity.offset < decorationEnd &&
        "custom_emoji_id" in entity &&
        typeof entity.custom_emoji_id === "string",
    )
    .sort((entityA, entityB) => entityA.offset - entityB.offset)
    .flatMap((entity) => {
      const entityText = text.slice(
        entity.offset,
        entity.offset + entity.length,
      );
      const customEmojiId =
        "custom_emoji_id" in entity &&
        typeof entity.custom_emoji_id === "string"
          ? entity.custom_emoji_id
          : "";

      return splitGraphemes(entityText).map((text) => ({
        tgEmoji: customEmojiId,
        text,
        isCustomEmoji: true,
      }));
    });

  if (customEmojiDecorations.length > 0) {
    return {
      ticker,
      decorations: customEmojiDecorations,
    };
  }

  return {
    ticker,
    decorations: decorationText.split(/\s+/).map((text) => ({
      tgEmoji: text,
      text,
      isCustomEmoji: false,
    })),
  };
}

export function parseLabelCommand(input: string): {
  ticker: string;
  showLabel: boolean;
} | null {
  const [ticker, showLabel] = input.trim().split(/\s+/);
  if (!ticker || (showLabel !== "true" && showLabel !== "false")) {
    return null;
  }

  return {
    ticker: normalizeTicker(ticker),
    showLabel: showLabel === "true",
  };
}
