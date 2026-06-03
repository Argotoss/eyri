# Eyri Roadmap

Eyri is a Telegram-native market intelligence system. The target state is not
automatic stock picking; it is a system that watches a portfolio, watchlists,
and market universes, gathers more relevant information than a person can
manually track, filters noise, builds evidence packets, and produces concise
stock-level decisions with proof, confidence, risks, and timing.

## Current State

- Portfolio bot: working.
- Price/provider layer: working enough for current use.
- Manual `/intel` market scan: working MVP.
- Deep single-stock `/intel TICKER` research: working MVP.
- Evidence packets, persisted raw data, report files, stage timings, and model
  usage/cost logs: implemented.
- The project is at the start of the real information layer. The evaluator,
  learning, alerting, and paper-trading layers are not built yet.

## Roadmap Layers

1. Information Layer
   - Make `/intel TICKER` deeply useful.
   - Improve source breadth, timestamps, relevance/noise scoring, source
     diagnostics, caching, and evidence packets.

2. Stock Dossier Layer
   - Convert evidence into stock-level dossiers.
   - Include thesis, setup type, catalyst clock, upside/downside, invalidation,
     confidence, missing information, and risk.

3. Evaluator Layer
   - Use stronger models to evaluate whether a stock is worth action.
   - Compare bullish, bearish, skeptical, and neutral evaluator roles.

4. Memory And Learning Layer
   - Store reports, decisions, price outcomes, catalyst resolution, model
     judgments, and post-mortems.
   - Use past outcomes to score future signals.

5. Alerting Layer
   - Scheduled scans, hot alerts, and changed-since-last-run summaries.
   - Keep Telegram messages compact and attach full reports.

6. Testing / Paper Trading Layer
   - Track recommendations against market movement.
   - Later: paper portfolio, model leaderboard, strategy comparison, and
     backtesting where feasible.

## Immediate Information-Layer Deliverables

- Add durable project coordination files: `ROADMAP.md` and `WORKLOG.md`.
- Add observability commands:
  - `/intel status`
  - `/intel last`
  - `/intel sources TICKER`
- Redesign deep reports into compact stock dossiers.
- Improve item distillation with better relevance, novelty, catalyst strength,
  risk, and noise reasons.
- Add a source registry with reliability, cost, rate-limit, and coverage
  metadata.
- Add more sources where accessible:
  - earnings calendar
  - company investor-relations/news releases
  - transcripts
  - analyst estimate revisions
  - options and short-interest data
  - sector and peer news
- Add caching/delta behavior so repeat runs reuse known articles and highlight
  what changed.
- Add report sections for changed-since-previous-report and missing data.
- Add smoke tests for `/intel MU 1d fast` and `/intel MU 1d deep`.

## Autonomous Work Rules

- Inspect current code, logs, database state, and latest reports before
  assuming previous state.
- Pick the highest-impact deliverable that moves the roadmap forward.
- Work in stable milestones.
- Run `deno task format`, `deno task test`, and
  `deno check --allow-import src/main.ts`.
- Run a real smoke intelligence pipeline when intelligence logic changes.
- Commit and push each completed milestone.
- Restart the bot after runtime code changes.
- Update `WORKLOG.md` with completed work, verification, known weaknesses, and
  the next recommended block.
