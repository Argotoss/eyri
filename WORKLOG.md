# Eyri Worklog

## 2026-06-03

### Baseline

- Latest pushed runtime milestone before this file:
  - `e5071d8` Add evidence packet intelligence layer.
- Bot runtime observed running from `deno run --env-file=.env -A src/main.ts`.
- Deep intelligence smoke/log evidence:
  - `/intel MU 1d deep` completed with hundreds of raw items, relevant item
    filtering, evidence packets/themes, and report persistence.
  - GDELT can still return HTTP 429; this is now captured as a nonfatal source
    diagnostic.

### Current Milestone

Goal: improve operational visibility for the information layer before adding
more sources or evaluator logic.

Planned deliverables:

- Add `ROADMAP.md` and `WORKLOG.md`.
- Add `/intel status`.
- Add `/intel last`.
- Add `/intel sources TICKER`.
- Add tests for intelligence run/report diagnostic reads.
- Verify with format, tests, type check, commit/push, and bot restart.

Completed in this milestone:

- Added `ROADMAP.md`.
- Added `WORKLOG.md`.
- Added storage read models for intelligence status, latest reports, source
  diagnostics, stage timings, and model usage rows.
- Added `/intel status`.
- Added `/intel last`.
- Added `/intel sources [TICKER]`.
- Updated README command documentation.
- Added an in-memory SQLite storage test for the new read-side diagnostics.

Verification:

- `deno task format`
- `deno task test` passed with 36 tests.
- `deno check --allow-import src/main.ts`
- Real DB smoke for chat `-1001756869879`:
  - 9 intelligence runs
  - 7 reports
  - 1,378 raw cached items
  - latest MU diagnostics: 12 source steps, 14 timing rows, 6 model usage rows

### Known Weaknesses

- Deep reports are still evidence-heavy, not yet true stock decision dossiers.
- Distillation is mostly rule-based; cheap-model item scoring is not yet used.
- Source coverage is useful but not yet broad enough for the final vision.
- Repeat runs persist data but do not yet present a clear delta versus the
  previous report.
- GDELT rate limiting remains expected under repeated manual runs.

### Stock Dossier Milestone

Goal: make deep `/intel TICKER` output read like a compact decision dossier
instead of a raw evidence report.

Completed:

- Added a deterministic decision dossier layer to deep reports.
- Added setup type inference, time window, catalyst clock, edge summary,
  invalidation/risk list, missing-data list, and human-check checklist.
- Made the Telegram summary use the same dossier framing:
  - verdict
  - setup
  - time window
  - edge summary
  - top evidence
  - invalidation
- Kept evidence packets, legacy theme view, source diagnostics, and source
  appendix in the attached HTML report.
- Extended the deep report test to require the decision dossier sections.

Verification:

- `deno task format`
- `deno task test` passed with 36 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run without OpenRouter:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 63 raw items
  - 34 relevant items
  - 6 evidence packets
  - saved HTML report
  - report HTML included `Decision Dossier`

Remaining after this milestone:

- Dossier content is deterministic and useful, but still shallow compared to
  the final evaluator target.
- Missing-data and invalidation are heuristic; they should become richer after
  source registry, transcript/options/estimate sources, and cheap model item
  scoring are added.
- There is still no changed-since-previous-report section.

### Source Registry Milestone

Goal: centralize source quality assumptions and make reports/diagnostics explain
why evidence is strong or weak.

Completed:

- Added `source_registry.ts` with source metadata:
  - display name
  - category
  - reliability tier
  - quality score
  - evidence weight
  - cost class
  - rate-limit notes
  - freshness, coverage, and limitations
- Replaced the hard-coded distillation source-quality map with registry-backed
  scoring.
- Added Source Quality section to deep HTML reports.
- Improved source appendix labels with human-readable source names.
- Improved `/intel sources` output with source display name, quality score, and
  reliability tier.
- Improved missing-data generation using source coverage categories rather than
  a single SEC-specific check.
- Added `source_registry_test.ts`.
- Extended deep report test to require Source Quality output.

Verification:

- `deno task format`
- `deno task test` passed with 38 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 168 raw items
  - 135 relevant items
  - 8 evidence packets
  - report HTML included `Source Quality`
  - report HTML included registry source display names

Remaining after this milestone:

- Registry metadata is static and should later become persisted/configurable.
- We still need new sources for earnings calendar, IR releases, transcripts,
  analyst revisions, options, and short interest.
- Source registry identifies missing coverage, but the pipeline does not yet
  fetch deltas or compare source coverage against previous runs.

### Delta Reporting Milestone

Goal: make repeat `/intel TICKER` runs show what changed since the previous
report instead of only producing another standalone report.

Completed:

- Added `intel_run_raw_items` persistence for run-to-raw-item links.
- Added per-run `was_new_to_cache` tracking.
- Added `RunItemDelta` to deep research data.
- Added delta calculation against the previous completed run for the same chat
  and ticker.
- Added changed-since-previous counts to run completion metadata:
  - new since previous
  - reused since previous
  - dropped since previous
  - new to cache
  - previous run id
- Added `Changed Since Previous Report` section to deep HTML reports.
- Added change summary line to Telegram deep intel summaries.
- Added storage tests for baseline and repeated-run deltas.
- Extended deep report tests to require the changed-since-previous section.

Verification:

- `deno task format`
- `deno task test` passed with 39 tests.
- `deno check --allow-import src/main.ts`
- Real isolated two-run smoke:
  - ticker: `MU`
  - preset: `1d/fast`
  - first run: 205 current items, 205 new to cache, change section rendered
  - second run: previous run #1 detected, 205 current items, 42 new, 163
    reused, 42 dropped, change line and HTML section rendered

Remaining after this milestone:

- Delta is based on raw item identity, not semantic clustering yet.
- It does not yet compare evidence-packet conclusions or stock-dossier verdict
  drift.
- Cache reuse is visible, but collectors still fetch externally every run; the
  next layer should add fetch-level cache/delta shortcuts.

### Earnings Calendar Source Milestone

Goal: add a high-signal scheduled-catalyst source to the deep single-stock
pipeline without introducing a new provider.

Completed:

- Added Finnhub earnings-calendar collection for deep ticker runs.
- Added a distinct `finnhub_earnings_calendar` source diagnostic.
- Registered the earnings calendar with source reliability, quality, coverage,
  and rate-limit metadata.
- Converted calendar rows into company catalyst raw items with event date,
  fiscal period, EPS estimate/actual, and revenue estimate/actual fields.
- Adjusted distillation scoring so company/research source types can carry more
  catalyst weight when the text contains earnings or guidance terms.
- Updated README source coverage text.
- Added parser and registry tests for the new source.

Verification:

- `deno task format`
- `deno task test` passed with 40 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 173 raw items
  - 140 relevant items
  - 8 evidence packets
  - `finnhub_earnings_calendar` diagnostic present and `ok`
  - earnings calendar returned 0 current-window MU rows
  - report HTML included `Decision Dossier` and `Source Quality`
  - GDELT returned HTTP 429; captured as nonfatal source failure

Remaining after this milestone:

- Earnings dates identify a catalyst clock, but the thesis still needs
  transcripts, company IR releases, analyst estimate revisions, and options
  positioning for stronger evaluation.
- Fetch-level cache shortcuts are still not implemented.

### Signal-Tier Distillation Milestone

Goal: make the raw-item filter more useful for the later evaluator by
separating noise from the highest-signal evidence before report synthesis.

Completed:

- Added `critical`, `high`, `medium`, `low`, and `noise` signal tiers to item
  distillation.
- Added a normalized signal score and short signal reasons per raw item.
- Persisted signal tier, score, and reasons in `intel_item_distillations`.
- Added schema migration columns for existing SQLite databases.
- Added aggregate signal counts and top signal item summaries to deep research
  data.
- Added a `Signal Filter` report section with counts and top signal rows.
- Added Telegram summary signal counts.
- Updated README with the new signal-tier behavior.
- Added tests for distillation, storage persistence, deep research aggregation,
  and report rendering.

Verification:

- `deno task format`
- `deno task test` passed with 41 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 173 raw items
  - 140 relevant items
  - 8 evidence packets
  - signal counts: 5 critical, 17 high, 85 medium, 27 low, 39 noise
  - top signal rows rendered in `Signal Filter`
  - Telegram summary included `Signals:`
  - GDELT returned HTTP 429; captured as nonfatal source failure

Remaining after this milestone:

- Tiering is deterministic and rule-based; the next layer should optionally use
  the cheap model to classify edge relevance when source volume is high.
- The evaluator still does not consume a separate compact evidence packet file.

### Model Signal Review Milestone

Goal: let the cheap model review the highest-ranked raw item candidates before
evidence packet synthesis, while keeping deterministic scoring as the fallback.

Completed:

- Added optional OpenRouter-backed signal review for top distillation
  candidates.
- Added `INTEL_SIGNAL_REVIEW_ENABLED`, `INTEL_SIGNAL_MODEL`, and
  `INTEL_SIGNAL_REVIEW_LIMIT` controls.
- Reused existing model usage accounting under `deep_signal_review`.
- Applied model-reviewed tier, score, reasons, summary, and noise reason before
  distillation persistence and evidence packet construction.
- Added validation so model rows with invalid item IDs, tiers, or scores are
  ignored.
- Added unit coverage for applying model reviews and noise downgrades.
- Updated README with the new signal review controls.

Verification:

- `deno task format`
- `deno task test` passed with 42 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run with OpenRouter cleared and
  `INTEL_SIGNAL_REVIEW_ENABLED=false`:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 174 raw items
  - 141 relevant items
  - 8 evidence packets
  - signal counts: 5 critical, 17 high, 85 medium, 28 low, 39 noise
  - `Signal Filter` rendered and Telegram summary included `Signals:`
  - model usage rows were empty, proving deterministic fallback
  - GDELT returned HTTP 429; captured as nonfatal source failure

Remaining after this milestone:

- The model review currently runs on a bounded top slice, not on all raw items.
- There is still no separate evaluator-ready JSON artifact attached to reports.

### Evaluator Packet Artifact Milestone

Goal: persist a compact machine-readable packet from every deep report so the
future evaluator can consume the best evidence without re-reading the full HTML
or raw cache.

Completed:

- Added an `EvaluatorPacket` report artifact type.
- Built evaluator packets from the deterministic decision dossier, signal
  counts, top signals, evidence packets, source diagnostics, change summary,
  market snapshot, fundamentals, and capped evidence text.
- Persisted evaluator packet JSON in `intel_reports`.
- Added evaluator sidecar file writing next to the HTML report as
  `.evaluator.json`.
- Added SQLite migration columns for evaluator JSON path, bytes, and payload.
- Returned evaluator file metadata from report saves.
- Added `/intel last` visibility for the evaluator packet path.
- Added tests for deep report packet generation and storage sidecar writing.

Verification:

- `deno task format`
- `deno task test` passed with 43 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run with OpenRouter cleared and
  `INTEL_SIGNAL_REVIEW_ENABLED=false`:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 213 raw items
  - 143 relevant items
  - 8 evidence packets
  - HTML report written
  - evaluator sidecar written:
    `data/smoke-reports/1-deep-intel-MU-1d-2026-06-03T20-46-49.evaluator.json`
  - evaluator JSON size: 83,813 bytes
  - evaluator JSON contained ticker, 8 evidence packets, and capped evidence
    text
  - DB stored evaluator file path, bytes, and JSON payload

Remaining after this milestone:

- The JSON packet is persisted but not sent as a Telegram attachment by default.
- The evaluator itself is still not implemented.

### Company Release Discovery Milestone

Goal: add a higher-signal announcement source without adding a new provider by
using release-focused RSS discovery queries.

Completed:

- Added `company_releases` source registry metadata.
- Added a `company_release` source category and coverage gap.
- Added release-focused Google News RSS discovery for deep ticker runs.
- Added query terms for press releases, investor relations, company news,
  announcements, launches, guidance, and earnings releases.
- Stored discovered rows as `sourceType: company` so the signal layer can score
  them as more catalyst-oriented than generic news.
- Added source diagnostics under `ticker-company-releases:TICKER`.
- Added `INTEL_COMPANY_RELEASE_RSS_LIMIT`.
- Added tests for query construction, RSS item conversion, and source quality.
- Updated README source/control documentation.

Verification:

- `deno task format`
- `deno task test` passed with 45 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run with OpenRouter cleared and
  `INTEL_SIGNAL_REVIEW_ENABLED=false`:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 199 raw items
  - 160 relevant items
  - 8 evidence packets
  - `company_releases` diagnostic present and `ok`
  - release-focused RSS returned 100 rows and kept 25 fast-preset raw items
  - evaluator sidecar was written
  - GDELT returned HTTP 429; captured as nonfatal source failure

Remaining after this milestone:

- This is still discovery through RSS, not a direct company IR feed.
- Direct IR feeds, transcripts, and analyst estimate revisions are still missing.

### Analyst Signal Source Milestone

Goal: add analyst target and rating-revision evidence using the existing Finnhub
integration, without adding a new provider dependency.

Completed:

- Added `finnhub_price_target` collection from Finnhub price-target snapshots.
- Added `finnhub_upgrade_downgrade` collection from Finnhub rating revision
  history.
- Registered an `analyst_research` source category and coverage gap.
- Moved `finnhub_recommendations` into the analyst-research category.
- Added parser tests for price-target snapshots and rating revision rows.
- Added source registry tests for the new analyst source quality metadata.
- Documented `INTEL_FINNHUB_UPGRADE_DOWNGRADE_LIMIT`.

Verification:

- `deno task format`
- `deno task test` passed with 47 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run with OpenRouter signal review disabled:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 205 raw items
  - 168 relevant items
  - HTML report written:
    `data/smoke-reports/2-deep-intel-MU-1d-2026-06-04T22-13-04.html`
  - evaluator sidecar written:
    `data/smoke-reports/2-deep-intel-MU-1d-2026-06-04T22-13-04.evaluator.json`
  - `finnhub_price_target` diagnostic persisted but returned HTTP 403 with
    the current Finnhub key.
  - `finnhub_upgrade_downgrade` diagnostic persisted but returned HTTP 403
    with the current Finnhub key.
  - GDELT returned HTTP 429; captured as nonfatal source failure.

Remaining after this milestone:

- Full analyst notes and detailed research PDFs are still not collected.
- Consensus EPS/revenue estimate revision history is still missing.

### Yahoo Chart Context Milestone

Goal: add an accessible technical market-context source after Yahoo
quoteSummary/options and Finnhub analyst endpoints proved gated under current
credentials.

Completed:

- Added `yahoo_chart` deep source collection from Yahoo's chart endpoint.
- Converts daily chart metadata into a compact market raw item with latest
  price, 1d return, 5d return, range return, day range, 52-week range position,
  latest volume, 20-session average volume, and relative volume.
- Registered `yahoo_chart` as a high-quality `market_data` source.
- Added parser tests for chart-to-market-context conversion.
- Added source registry tests for the new source metadata.
- Updated README source documentation.

Verification:

- `deno task format`
- `deno task test` passed with 48 tests.
- `deno check --allow-import src/main.ts`
- Real isolated smoke run with OpenRouter signal review disabled:
  - ticker: `MU`
  - command path: deep report pipeline, `1d/fast`
  - 206 raw items
  - 166 relevant items
  - `yahoo_chart` diagnostic present and `ok` with 1 item
  - HTML report written:
    `data/smoke-reports/1-deep-intel-MU-1d-2026-06-04T22-21-57.html`
  - evaluator sidecar written:
    `data/smoke-reports/1-deep-intel-MU-1d-2026-06-04T22-21-57.evaluator.json`
  - Finnhub price target and rating-revision endpoints still returned HTTP
    403 with the current key.
  - GDELT returned HTTP 429; captured as nonfatal source failure.

Remaining after this milestone:

- Yahoo quoteSummary analyst/fundamental modules still require crumb access in
  this environment.
- Options-chain context is still missing.
