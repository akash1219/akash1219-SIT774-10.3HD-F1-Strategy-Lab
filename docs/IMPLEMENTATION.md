# F1 Strategy Lab implementation notes

## Feature overview

The Strategy Lab turns the earlier simulator proposal into a working browser feature. The page reads its driver/race catalog from Express/SQLite, stores reusable strategies as normalized parent/stint records, runs the hypothetical calculation in a Web Worker, and stores completed runs for comparison.

Historical provider data and simulation assumptions are deliberately separate. A provider result can help the user choose a base-lap context, but the simulator does not call that result an official prediction.

## How another developer can reproduce the pattern

1. Enable SQLite foreign keys and create provider-scoped driver/team/race tables.
2. Keep external IDs. Upsert on `(provider, provider_id)` rather than matching by display name.
3. Resolve season driver/team relationships through a membership table.
4. Store strategy stints as child rows with a foreign key to the strategy.
5. Populate `<select>` controls from a backend catalog endpoint.
6. Validate the strategy again on the server even if the browser already validates it.
7. Send only the simulation payload to a Worker. The Worker has no database/network responsibility.
8. Post progress messages back to the UI. Cancel by terminating the Worker.
9. Use a seeded PRNG so identical inputs can be reproduced.
10. Store only completed runs. Keep the exact assumptions JSON beside each result.

## External data mapping rule

Jolpica and OpenF1 are not merged by similar-looking names. Jolpica entities keep Jolpica IDs. OpenF1 sessions keep `session_key`. Cross-provider mappings belong in `provider_mappings` and must record a mapping method. The included OpenF1 telemetry importer only links `driver_number` when exactly one stored driver has that permanent number.

## Accessibility and performance

The main status element uses `role="status"` and `aria-live="polite"`. Native labels are attached to controls. Progress is visible without blocking the page. The simulation loop runs in a Worker, so UI controls and page rendering remain on the main thread.

## Data sources

- Jolpica F1 documentation: https://github.com/jolpica/jolpica-f1
- OpenF1 documentation: https://openf1.org/docs/
- API-Sports Formula-1 information (optional key provider, not required by this build): https://api-sports.io/sports/formula-1

Provider claims should be checked again at submission time because quotas and API behaviour can change.
