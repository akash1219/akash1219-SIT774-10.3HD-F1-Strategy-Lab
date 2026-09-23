const { DatabaseSync } = require('node:sqlite');
const path = require('path');


// ---------------------------------------------------------
// DATABASE CONNECTION
// ---------------------------------------------------------

const DB_PATH = path.join(__dirname, 'formula1.db');

const db = new DatabaseSync(DB_PATH);


// Enforce SQLite foreign-key relationships.
db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
`);


// ---------------------------------------------------------
// CREATE DATABASE SCHEMA
// ---------------------------------------------------------

function initSchema() {

    db.exec(`

        -- Existing Task 10.2D contact queries table.
        -- IF NOT EXISTS preserves the table and its data.
        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            query_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );


        -- Records the external data providers used by the project.
        CREATE TABLE IF NOT EXISTS data_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            requires_key INTEGER NOT NULL DEFAULT 0,
            notes TEXT
        );


        -- Formula 1 constructors/teams.
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            nationality TEXT,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            source_updated_at TEXT,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(provider, provider_id)
        );


        -- Formula 1 drivers.
        CREATE TABLE IF NOT EXISTS drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            given_name TEXT NOT NULL,
            family_name TEXT NOT NULL,
            code TEXT,
            permanent_number INTEGER,
            nationality TEXT,
            date_of_birth TEXT,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            source_updated_at TEXT,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(provider, provider_id)
        );


        -- F1 seasons.
        CREATE TABLE IF NOT EXISTS seasons (
            year INTEGER PRIMARY KEY,
            source_label TEXT NOT NULL DEFAULT 'local'
        );


        -- Links a driver to a team for a particular season.
        --
        -- This avoids storing team information directly inside
        -- every driver record.
        CREATE TABLE IF NOT EXISTS season_memberships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            season_year INTEGER NOT NULL
                REFERENCES seasons(year)
                ON DELETE CASCADE,

            driver_id INTEGER NOT NULL
                REFERENCES drivers(id)
                ON DELETE CASCADE,

            team_id INTEGER NOT NULL
                REFERENCES teams(id)
                ON DELETE CASCADE,

            provider TEXT NOT NULL,
            provider_key TEXT NOT NULL,

            UNIQUE(season_year, driver_id, team_id),
            UNIQUE(provider, provider_key)
        );


        -- Grand Prix / race information.
        CREATE TABLE IF NOT EXISTS races (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            season_year INTEGER NOT NULL
                REFERENCES seasons(year)
                ON DELETE CASCADE,

            round INTEGER NOT NULL,
            name TEXT NOT NULL,
            circuit_name TEXT,
            country TEXT,
            race_date TEXT,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            source_updated_at TEXT,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(provider, provider_id),
            UNIQUE(season_year, round)
        );


        -- Practice, qualifying, sprint and race sessions.
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            race_id INTEGER
                REFERENCES races(id)
                ON DELETE SET NULL,

            season_year INTEGER NOT NULL,
            session_name TEXT NOT NULL,
            meeting_name TEXT,
            country_name TEXT,
            start_time TEXT,
            end_time TEXT,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            source_updated_at TEXT,
            imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(provider, provider_id)
        );


        -- Explicit mapping between IDs from different providers.
        --
        -- We will not guess that two records from different APIs
        -- represent the same entity.
        CREATE TABLE IF NOT EXISTS provider_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            entity_type TEXT NOT NULL,

            from_provider TEXT NOT NULL,
            from_id TEXT NOT NULL,

            to_provider TEXT NOT NULL,
            to_id TEXT NOT NULL,

            mapping_method TEXT NOT NULL,

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

            UNIQUE(
                entity_type,
                from_provider,
                from_id,
                to_provider
            )
        );


        -- Historical race results.
        CREATE TABLE IF NOT EXISTS race_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            race_id INTEGER NOT NULL
                REFERENCES races(id)
                ON DELETE CASCADE,

            driver_id INTEGER NOT NULL
                REFERENCES drivers(id)
                ON DELETE CASCADE,

            team_id INTEGER
                REFERENCES teams(id)
                ON DELETE SET NULL,

            grid INTEGER,
            finish_position INTEGER,
            laps INTEGER,
            status TEXT,
            fastest_lap_seconds REAL,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            UNIQUE(provider, provider_id)
        );


        -- Historical lap information.
        CREATE TABLE IF NOT EXISTS lap_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            session_id INTEGER NOT NULL
                REFERENCES sessions(id)
                ON DELETE CASCADE,

            driver_id INTEGER
                REFERENCES drivers(id)
                ON DELETE SET NULL,

            driver_number INTEGER NOT NULL,
            lap_number INTEGER NOT NULL,

            lap_duration REAL,
            compound TEXT,
            tyre_age INTEGER,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            UNIQUE(provider, provider_id)
        );


        -- Historical pit-stop information.
        CREATE TABLE IF NOT EXISTS pit_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            session_id INTEGER NOT NULL
                REFERENCES sessions(id)
                ON DELETE CASCADE,

            driver_id INTEGER
                REFERENCES drivers(id)
                ON DELETE SET NULL,

            driver_number INTEGER NOT NULL,
            lap_number INTEGER,
            pit_duration REAL,

            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,

            UNIQUE(provider, provider_id)
        );


        -- Records every external-data synchronization attempt.
        CREATE TABLE IF NOT EXISTS sync_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            provider TEXT NOT NULL,
            operation TEXT NOT NULL,
            status TEXT NOT NULL,

            rows_written INTEGER NOT NULL DEFAULT 0,

            message TEXT,

            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL
        );


        -- User-created hypothetical F1 strategies.
        CREATE TABLE IF NOT EXISTS saved_strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            driver_id INTEGER NOT NULL
                REFERENCES drivers(id),

            race_id INTEGER
                REFERENCES races(id),

            total_laps INTEGER NOT NULL,

            fuel_effect_ms REAL NOT NULL DEFAULT 32,
            traffic_loss_ms REAL NOT NULL DEFAULT 180,
            pit_loss_seconds REAL NOT NULL DEFAULT 22,

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );


        -- Each strategy can contain multiple tyre stints.
        CREATE TABLE IF NOT EXISTS strategy_stints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            strategy_id INTEGER NOT NULL
                REFERENCES saved_strategies(id)
                ON DELETE CASCADE,

            stint_order INTEGER NOT NULL,

            compound TEXT NOT NULL,

            start_lap INTEGER NOT NULL,
            end_lap INTEGER NOT NULL,

            degradation_ms_per_lap REAL NOT NULL,

            UNIQUE(strategy_id, stint_order)
        );


        -- Stores completed simulation results.
        CREATE TABLE IF NOT EXISTS simulation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            strategy_id INTEGER
                REFERENCES saved_strategies(id)
                ON DELETE SET NULL,

            driver_id INTEGER NOT NULL
                REFERENCES drivers(id),

            race_id INTEGER
                REFERENCES races(id),

            seed INTEGER NOT NULL,

            assumptions_json TEXT NOT NULL,
            result_json TEXT NOT NULL,

            total_time_seconds REAL NOT NULL,
            pit_stops INTEGER NOT NULL,

            status TEXT NOT NULL DEFAULT 'completed',

            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

    `);


    // -----------------------------------------------------
    // REGISTER DATA PROVIDERS
    // -----------------------------------------------------

    const sourceStatement = db.prepare(`
        INSERT INTO data_sources (
            code,
            name,
            base_url,
            requires_key,
            notes
        )
        VALUES (?, ?, ?, ?, ?)

        ON CONFLICT(code)
        DO UPDATE SET
            name = excluded.name,
            base_url = excluded.base_url,
            requires_key = excluded.requires_key,
            notes = excluded.notes
    `);


    sourceStatement.run(
        'jolpica',
        'Jolpica F1',
        'https://api.jolpi.ca/ergast/f1',
        0,
        'No-key default source for drivers, constructors, races and results.'
    );


    sourceStatement.run(
        'openf1',
        'OpenF1',
        'https://api.openf1.org/v1',
        0,
        'Historical sessions, laps and pit data where available.'
    );


    sourceStatement.run(
        'api_sports',
        'API-Sports Formula-1',
        'https://v1.formula-1.api-sports.io',
        1,
        'Optional provider. API key must remain server-side.'
    );
}


// ---------------------------------------------------------
// OFFLINE DEVELOPMENT DATA
// ---------------------------------------------------------

function seedBootstrapCatalog() {

    // This data exists only so the Strategy Lab can be developed
    // before an external API sync has been performed.
    //
    // It is labelled "bootstrap" and must not be presented as
    // imported API data.

    db.prepare(`
        INSERT INTO seasons (
            year,
            source_label
        )
        VALUES (
            2024,
            'bootstrap'
        )

        ON CONFLICT(year)
        DO NOTHING
    `).run();


    // -----------------------------------------------------
    // BOOTSTRAP TEAMS
    // -----------------------------------------------------

    const teams = [

        [
            'Red Bull Racing',
            'Austrian',
            'red_bull'
        ],

        [
            'McLaren',
            'British',
            'mclaren'
        ],

        [
            'Ferrari',
            'Italian',
            'ferrari'
        ],

        [
            'Mercedes',
            'German',
            'mercedes'
        ]

    ];


    const teamStatement = db.prepare(`
        INSERT INTO teams (
            name,
            nationality,
            provider,
            provider_id,
            source_updated_at
        )
        VALUES (
            ?,
            ?,
            'bootstrap',
            ?,
            NULL
        )

        ON CONFLICT(provider, provider_id)
        DO UPDATE SET
            name = excluded.name,
            nationality = excluded.nationality
    `);


    for (const team of teams) {

        teamStatement.run(
            team[0],
            team[1],
            team[2]
        );

    }


    // -----------------------------------------------------
    // BOOTSTRAP DRIVERS
    // -----------------------------------------------------

    const drivers = [

        [
            'Max',
            'Verstappen',
            'VER',
            1,
            'Dutch',
            'verstappen',
            'red_bull'
        ],

        [
            'Lando',
            'Norris',
            'NOR',
            4,
            'British',
            'norris',
            'mclaren'
        ],

        [
            'Charles',
            'Leclerc',
            'LEC',
            16,
            'Monegasque',
            'leclerc',
            'ferrari'
        ],

        [
            'Lewis',
            'Hamilton',
            'HAM',
            44,
            'British',
            'hamilton',
            'mercedes'
        ]

    ];


    const driverStatement = db.prepare(`
        INSERT INTO drivers (
            given_name,
            family_name,
            code,
            permanent_number,
            nationality,
            provider,
            provider_id
        )
        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            'bootstrap',
            ?
        )

        ON CONFLICT(provider, provider_id)
        DO UPDATE SET
            given_name = excluded.given_name,
            family_name = excluded.family_name,
            code = excluded.code,
            permanent_number = excluded.permanent_number,
            nationality = excluded.nationality
    `);


    const membershipStatement = db.prepare(`
        INSERT INTO season_memberships (
            season_year,
            driver_id,
            team_id,
            provider,
            provider_key
        )
        VALUES (
            2024,
            ?,
            ?,
            'bootstrap',
            ?
        )

        ON CONFLICT(provider, provider_key)
        DO UPDATE SET
            driver_id = excluded.driver_id,
            team_id = excluded.team_id
    `);


    for (const driver of drivers) {

        driverStatement.run(
            driver[0],
            driver[1],
            driver[2],
            driver[3],
            driver[4],
            driver[5]
        );


        const driverRecord = db.prepare(`
            SELECT id
            FROM drivers
            WHERE provider = 'bootstrap'
            AND provider_id = ?
        `).get(driver[5]);


        const teamRecord = db.prepare(`
            SELECT id
            FROM teams
            WHERE provider = 'bootstrap'
            AND provider_id = ?
        `).get(driver[6]);


        membershipStatement.run(
            driverRecord.id,
            teamRecord.id,
            `2024:${driver[5]}:${driver[6]}`
        );

    }
}


// ---------------------------------------------------------
// INITIALISE DATABASE
// ---------------------------------------------------------

initSchema();

seedBootstrapCatalog();


// ---------------------------------------------------------
// EXPORT DATABASE
// ---------------------------------------------------------

module.exports = {
    db,
    initSchema,
    seedBootstrapCatalog,
    DB_PATH
};