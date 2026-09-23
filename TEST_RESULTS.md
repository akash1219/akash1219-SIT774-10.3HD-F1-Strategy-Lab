# Test Results - F1 Strategy Lab build

Build environment date: 2026-09-22.

## Checks actually run

`node --check` passed for:
- `server.js`
- `db.js`
- `sync-data.js`
- `public/strategy.js`
- `public/strategy-worker.js`

`node tests/run-tests.js` passed these local checks:
- repeat bootstrap upserts do not duplicate driver rows (4 -> 4)
- Express/SQLite health endpoint
- existing Task 10.2 query CREATE, READ and DELETE still work
- strategy catalog is served from SQLite-backed backend data
- invalid strategy with a lap gap is rejected
- saved strategy CREATE
- saved strategy is present in SQLite after API creation
- saved strategy READ
- saved strategy UPDATE
- saved strategy DELETE
- Web Worker deterministic output for the same seed and inputs (`1837.387 == 1837.387` seconds in the test case)
- Web Worker cancellation/termination path

SQLite integrity checks:
- `PRAGMA foreign_key_check` returned an empty list
- duplicate checks for bootstrap provider driver/team IDs returned an empty list

## External provider test limitation

The test runner attempted a real Jolpica season sync. This execution environment could not resolve external network requests and returned `fetch failed`. The test therefore records the external sync as runtime-limited rather than claiming an import succeeded. The failure is written to `sync_logs`; cached/local SQLite data remains available.

The sync implementation itself includes timeouts, retries/backoff for HTTP 429, parameterized writes and provider-ID upserts. A real internet-connected machine should run `npm run sync` and then run it a second time to demonstrate that row counts do not duplicate.

OpenF1 live import was not claimed as executed in this environment. `npm run sync` invokes both Jolpica and OpenF1 when network access is available. `npm run sync:telemetry` additionally requests lap/pit data and should be used carefully because of provider rate limits.

## Browser/manual checks still required by the student

Run the project in a normal browser and demonstrate:
- responsive Strategy Lab layout
- database-populated driver/race selectors
- saved strategy create/edit/delete
- progress updates while the worker runs
- Cancel stopping a run without storing a partial result
- same seed + same inputs producing the same result
- stored run comparison/history
- provider source/last-sync labels
- successful external sync on an internet-connected machine, then repeat it and confirm no duplicates

## SlopMonster

SlopMonster was researched and its documented lint/rewrite/re-lint workflow was considered for explanatory copy. Its repository/tool files were not available locally in this runtime, and the container could not retrieve the repository, so `tools/deslop.py` was **not executed**. No SlopMonster score is claimed.
