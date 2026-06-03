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
