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

## Groups

Plain commands such as `/purchase MU 1000 1` work in groups when BotFather
privacy mode is disabled for the bot. Addressed commands such as
`/purchase@bot_username MU 1000 1` work with privacy mode enabled.

## Tests

```bash
deno test -A
```
