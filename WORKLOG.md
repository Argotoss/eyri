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
