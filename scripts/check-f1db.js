const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'formula1.db');
const db = new DatabaseSync(DB_PATH, { readOnly: true });

function scalar(sql, ...params) {
    return db.prepare(sql).get(...params).n;
}

function section(title) {
    console.log(`\n=== ${title} ===`);
}

console.log('F1DB IMPORT VERIFICATION');
console.log('Database:', DB_PATH);

section('DATABASE INTEGRITY');

const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('Integrity:', integrity.integrity_check);

section('PROTECTED EXISTING DATA');

const queries = scalar('SELECT COUNT(*) AS n FROM queries');
const strategies = scalar('SELECT COUNT(*) AS n FROM saved_strategies');
const runs = scalar('SELECT COUNT(*) AS n FROM simulation_runs');

console.log('Queries:', queries, queries === 1 ? 'OK' : 'CHECK');
console.log('Saved strategies:', strategies, strategies === 2 ? 'OK' : 'CHECK');
console.log('Simulation runs:', runs, runs >= 31 ? 'OK' : 'CHECK');

section('OVERALL CATALOG');

console.log(
    'Drivers:',
    scalar('SELECT COUNT(*) AS n FROM drivers')
);

console.log(
    'Teams:',
    scalar('SELECT COUNT(*) AS n FROM teams')
);

console.log(
    'Races:',
    scalar('SELECT COUNT(*) AS n FROM races')
);

console.log(
    'Race results:',
    scalar('SELECT COUNT(*) AS n FROM race_results')
);

section('F1DB SOURCE');

const source = db.prepare(`
    SELECT code, name, base_url, requires_key, notes
    FROM data_sources
    WHERE code = 'f1db'
`).get();

console.log(source || 'F1DB source not registered yet.');

section('SEASONS');

const seasons = db.prepare(`
    SELECT
        s.year,
        s.source_label,
        COUNT(DISTINCT r.id) AS races
    FROM seasons s
    LEFT JOIN races r
        ON r.season_year = s.year
    WHERE s.year IN (2024, 2025)
    GROUP BY s.year, s.source_label
    ORDER BY s.year
`).all();

console.table(seasons);

section('F1DB RESULT COUNTS');

const resultCounts = db.prepare(`
    SELECT
        r.season_year AS year,
        COUNT(rr.id) AS f1db_results,
        COUNT(DISTINCT rr.driver_id) AS drivers,
        COUNT(DISTINCT rr.team_id) AS teams,
        COUNT(DISTINCT rr.race_id) AS races
    FROM race_results rr
    JOIN races r
        ON r.id = rr.race_id
    WHERE rr.provider = 'f1db'
      AND r.season_year IN (2024, 2025)
    GROUP BY r.season_year
    ORDER BY r.season_year
`).all();

console.table(resultCounts);

section('RACE PROVIDER MAPPINGS');

const raceMappings = db.prepare(`
    SELECT COUNT(*) AS n
    FROM provider_mappings
    WHERE entity_type = 'race'
      AND from_provider = 'f1db'
`).get();

console.log('F1DB race mappings:', raceMappings.n);

section('DUPLICATE SEASON / ROUND CHECK');

const duplicateRaces = db.prepare(`
    SELECT
        season_year,
        round,
        COUNT(*) AS n
    FROM races
    WHERE season_year IN (2024, 2025)
    GROUP BY season_year, round
    HAVING COUNT(*) > 1
`).all();

if (duplicateRaces.length === 0) {
    console.log('No duplicate season/round races: OK');
} else {
    console.table(duplicateRaces);
}

section('DUPLICATE F1DB RESULTS CHECK');

const duplicateResults = db.prepare(`
    SELECT
        provider_id,
        COUNT(*) AS n
    FROM race_results
    WHERE provider = 'f1db'
    GROUP BY provider_id
    HAVING COUNT(*) > 1
`).all();

if (duplicateResults.length === 0) {
    console.log('No duplicate F1DB provider IDs: OK');
} else {
    console.table(duplicateResults);
}

section('MULTI-TEAM DRIVERS');

const transfers = db.prepare(`
    SELECT
        sm.season_year AS year,
        d.given_name || ' ' || d.family_name AS driver,
        COUNT(DISTINCT sm.team_id) AS teams
    FROM season_memberships sm
    JOIN drivers d
        ON d.id = sm.driver_id
    WHERE sm.season_year IN (2024, 2025)
    GROUP BY
        sm.season_year,
        sm.driver_id
    HAVING COUNT(DISTINCT sm.team_id) > 1
    ORDER BY
        sm.season_year,
        driver
`).all();

if (transfers.length === 0) {
    console.log('No multi-team memberships found.');
} else {
    console.table(transfers);
}

section('RACE-SPECIFIC TEAM EXAMPLE');

const teamExamples = db.prepare(`
    SELECT
        r.season_year AS year,
        r.round,
        d.given_name || ' ' || d.family_name AS driver,
        t.name AS team,
        rr.grid,
        rr.finish_position,
        rr.status
    FROM race_results rr
    JOIN races r
        ON r.id = rr.race_id
    JOIN drivers d
        ON d.id = rr.driver_id
    LEFT JOIN teams t
        ON t.id = rr.team_id
    WHERE rr.provider = 'f1db'
      AND r.season_year IN (2024, 2025)
    ORDER BY
        r.season_year DESC,
        r.round DESC,
        driver
    LIMIT 15
`).all();

console.table(teamExamples);

section('FASTEST LAP DATA');

const fastestLapStats = db.prepare(`
    SELECT
        r.season_year AS year,
        COUNT(*) AS results,
        SUM(
            CASE
                WHEN rr.fastest_lap_seconds IS NOT NULL THEN 1
                ELSE 0
            END
        ) AS with_fastest_lap
    FROM race_results rr
    JOIN races r
        ON r.id = rr.race_id
    WHERE rr.provider = 'f1db'
      AND r.season_year IN (2024, 2025)
    GROUP BY r.season_year
    ORDER BY r.season_year
`).all();

console.table(fastestLapStats);

section('LATEST F1DB IMPORT LOG');

const log = db.prepare(`
    SELECT
        provider,
        operation,
        status,
        rows_written,
        message,
        started_at,
        finished_at
    FROM sync_logs
    WHERE provider = 'f1db'
    ORDER BY id DESC
    LIMIT 1
`).get();

console.log(log || 'No F1DB import log yet.');

section('FINAL');

if (
    integrity.integrity_check === 'ok' &&
    queries === 1 &&
    strategies === 2 &&
    runs >= 31 &&
    duplicateRaces.length === 0 &&
    duplicateResults.length === 0
) {
    console.log('Core verification: PASS');
} else {
    console.log('Core verification: CHECK REQUIRED');
}

db.close();