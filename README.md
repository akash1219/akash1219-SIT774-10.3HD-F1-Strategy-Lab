# Formula 1 World - F1 Strategy Lab (SIT774 Task 10.3HD)

This project extends the existing Formula 1 World Task 10.2 site without removing its contact-query CRUD feature. The new Strategy Lab is a database-backed hypothetical race strategy simulator. Driver/race selectors, saved strategies, run history and imported provider data are read through the Express backend from SQLite. A Web Worker performs the simulation away from the main UI thread.

## Setup

Requirements: Node.js 22+ (the project uses built-in `node:sqlite`). No paid plan or account is required.

```bash
npm install
npm start
```

Open `http://localhost:3000/strategy.html`. The existing contact/query pages remain available.

The app creates/updates its schema automatically through `db.js`. A small clearly labelled `bootstrap` catalog keeps the Strategy Lab usable offline. It is not described as an external API import.

## External data sync

The default providers require no API key:

- Jolpica F1: drivers, constructors, races and results.
- OpenF1: historical race sessions since 2023; optional lap/pit import.

Run:

```bash
npm run sync
```

For the larger, rate-limited lap/pit import:

```bash
npm run sync:telemetry
```

The sync code uses timeouts, retries/backoff for HTTP 429, repeatable `ON CONFLICT ... DO UPDATE` upserts, `sync_logs`, and SQLite cached reads. Re-running the same season should update provider rows rather than duplicate them. If a provider is unavailable, existing cached data remains usable.

OpenF1 sessions are stored independently. The project does not guess that an OpenF1 meeting equals a Jolpica race. `sessions.race_id` stays nullable unless an explicit provider mapping is added. OpenF1 `driver_number` is linked to a local driver only when exactly one stored driver has that permanent number; ambiguous/unmatched records remain unlinked.

API-Sports Formula-1 is optional. Put a key only in a local `.env` if you later implement/use that provider. `.env` is gitignored and `.env.example` contains no secret. No key is sent to frontend code.

## Database schema / ERD

```text
seasons 1---* races 1---* race_results *---1 drivers
   |                         |                 |
   |                         *---1 teams       |
   *---* season_memberships *-----------------*

races 1---* sessions 1---* lap_data
                    1---* pit_data

drivers 1---* saved_strategies 1---* strategy_stints
races   1---* saved_strategies
saved_strategies 1---* simulation_runs

data_sources
sync_logs
provider_mappings
queries   (existing Task 10.2 feature, preserved)
```

Important normalization choices:
- Drivers and teams have provider-scoped IDs rather than names as merge keys.
- `season_memberships` resolves the driver/team/season relationship.
- Strategy stints are child rows rather than repeated columns in `saved_strategies`.
- Simulation inputs/results are stored separately from imported historical provider data.
- `provider_mappings` exists for explicit cross-provider mapping instead of fuzzy/guessed joins.

Foreign keys are enabled with `PRAGMA foreign_keys = ON`.

## Strategy model

The simulator is educational and hypothetical. Imported historical data is context only. Model assumptions are explicit UI inputs:

- base lap time
- fuel effect in milliseconds per remaining lap
- traffic/random variation bound
- pit-lane time loss
- tyre compound offset
- per-stint degradation rate

The worker uses a seeded xorshift PRNG, so the same inputs and seed reproduce the same result. It posts progress updates. Cancel terminates the worker and no partial run is stored. Completed runs are persisted in `simulation_runs` for comparison.

## Saved strategy CRUD

`POST /api/strategies` creates a strategy and normalized stint rows. `GET` reads them. `PUT` replaces validated stint rows inside a transaction. `DELETE` removes the strategy with cascading stint deletion. Inputs are parameterized and server-validated.

## Data/API routes

- `GET /api/strategy/catalog`
- `GET /api/strategy/historical/:raceId`
- `POST /api/data/sync`
- `GET /api/data/sync-logs`
- `GET/POST/PUT/DELETE /api/strategies...`
- `GET/POST /api/simulation-runs`
- Existing `GET/POST/PUT/DELETE /api/queries...` remains intact.

## Source labels

The UI displays provider labels. Provider timestamps/import timestamps are stored where available. API facts are never silently converted into simulation assumptions.

## Test commands

Run the local test suite:

```bash
node tests/run-tests.js
```

External sync requires internet access. If DNS/network access is unavailable, the suite records that limitation rather than claiming the sync succeeded.

## Task 10.3HD demonstration

A genuine submission still needs user-created evidence:

1. Push the final project to the student's own source repository and add the real repository URL to the submission PDF.
2. Record a narrated walkthrough (maximum 10 minutes) showing the feature and implementation.
3. Upload the real video to Deakin Panopto with the required Deakin-link visibility and add the real link.
4. Add a real shared AI conversation link containing at least 10 meaningful prompts. This project does not fabricate prompts or evidence.

## Authored prose check

The README/visible explanatory copy can be linted with SlopMonster's `tools/deslop.py` if the SlopMonster repository is available locally. See `TEST_RESULTS.md` for the exact check status from this build environment.
