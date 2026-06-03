# Eyri

Stock portfolio manager for Telegram.

## Stack

- TypeScript
- Deno
- grammY
- SQLite
- Twelve Data, Finnhub, Alpaca, Yahoo Chart, Stooq

## Run

Create `.env`:

```text
TOKEN='telegram-bot-token'
EYRI_DATABASE_PATH='data/eyri.sqlite'

# Optional quote providers
TWELVE_DATA_API_KEY='...'
FINNHUB_API_KEY='...'
ALPACA_API_KEY='...'
ALPACA_API_SECRET='...'

# Optional market intelligence models
OPENROUTER_API_KEY='...'
INTEL_EXTRACT_MODEL='deepseek/deepseek-v4-flash'
INTEL_REPORT_MODEL='openai/gpt-5.4-mini'
```

Start locally:

```bash
deno task dev
```

Or with Docker Compose:

```bash
docker compose up -d --build
```

## Commands

```text
/purchase [ticker] [price] [amount] [commission%]
/ticker
/tickers
/perf
/history
/when TICKER=price TICKER2=price2
/decorate TICKER EMOJI
/label TICKER LABEL
/link TICKER GOOGLE_FINANCE_TAG
/intel [1d|3d|14d]
/intel TICKER [1d|3d|14d] [deep]
/watch add TICKER
/watch remove TICKER
/watch list
/universe sp500 on
/universe sp500 off
```

Examples:

```text
/purchase MU 1000 1
/purchase NVDA:NASDAQ 214.40 2 0.3%
/purchase NVDA:NASDAQ 224.36 -1 0.3%
/link NVDA:NASDAQ NVDA:NASDAQ
```

Commission is optional and is interpreted as a percentage. `0.3` and `0.3%`
both mean 0.3 percent. Negative amounts sell shares, reduce the weighted-average
position, and record realized profit/loss.

Legacy `/buy [ticker] [total price] [absolute commission] [amount]` still works.
Prefer `/purchase` for new entries.

## Market Intelligence

`/intel` builds a manual market intelligence report for the current chat. The
bot scans the command caller's portfolio, the chat watchlist, and the optional
S&P 500 preset. It sends a concise group summary and attaches a readable HTML
report with ranked stock dossiers, confidence scores, market metrics,
fundamental snapshots, catalyst summaries, and evidence links.

`/intel TICKER [1d|3d|14d] [fast|deep|exhaustive]` runs the stock-agnostic deep
research pipeline for a single requested ticker. It gathers ticker-specific SEC
filings, GDELT articles, Alpaca/Benzinga news, Finnhub news/metrics/social
summaries, Yahoo/Google RSS, optional Reddit search, StockTwits messages,
optional full text from linked articles, and the existing price/fundamental
snapshots. The attached report is built from scored evidence packets, with raw
source lists moved into expandable appendices.

Every intelligence run persists raw fetched items, item distillations, evidence
packets, timing rows, model token/cost estimates, and the rendered report file.
Report artifacts default to `data/reports`.

The first information-layer sources are SEC EDGAR, GDELT news discovery, and
the existing price providers. Extraction uses `INTEL_EXTRACT_MODEL` through
OpenRouter when configured and falls back to rules if the model call fails.
Report wording uses `INTEL_REPORT_MODEL` when configured while the HTML report
itself is generated deterministically from structured data.

Optional scan/source controls include `EYRI_REPORTS_DIR`,
`INTEL_SEC_TICKER_LIMIT`, `INTEL_FUNDAMENTAL_TICKER_LIMIT`,
`INTEL_PRICE_TICKER_LIMIT`, `INTEL_GDELT_DIRECT_TICKER_LIMIT`,
`INTEL_GDELT_SP500_FOCUS_LIMIT`, `INTEL_GDELT_429_BACKOFF_MS`,
`INTEL_FULLTEXT_LIMIT`, `INTEL_FULLTEXT_CONCURRENCY`,
`INTEL_FULLTEXT_TIMEOUT_MS`, `REDDIT_BEARER_TOKEN`, and
`INTEL_REDDIT_ALLOW_UNAUTH`.

## Groups

Plain commands such as `/purchase MU 1000 1` work in groups when BotFather
privacy mode is disabled for the bot. Addressed commands such as
`/purchase@bot_username MU 1000 1` work with privacy mode enabled.

## Tests

```bash
deno test -A
```
