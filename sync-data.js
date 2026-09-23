const { db } = require('./db');

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';
const OPENF1_BASE = 'https://api.openf1.org/v1';

const DEFAULT_SEASON = 2024;
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 10000);


// ---------------------------------------------------------
// HTTP HELPER
// ---------------------------------------------------------

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


async function fetchJson(url, attempt = 1) {

    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        TIMEOUT_MS
    );

    try {

        console.log(`Fetching: ${url}`);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: 'application/json'
            }
        });


        // Handle API rate limiting.
        if (response.status === 429) {

            if (attempt >= 3) {
                throw new Error(
                    `Rate limit exceeded after ${attempt} attempts`
                );
            }

            const retryAfter =
                Number(response.headers.get('retry-after')) || 2;

            console.log(
                `Rate limited. Waiting ${retryAfter} seconds...`
            );

            await sleep(retryAfter * 1000);

            return fetchJson(url, attempt + 1);
        }


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status} ${response.statusText}`
            );

        }


        return await response.json();

    } catch (err) {

        if (err.name === 'AbortError') {

            throw new Error(
                `Request timed out after ${TIMEOUT_MS} ms`
            );

        }

        throw err;

    } finally {

        clearTimeout(timer);

    }
}


// ---------------------------------------------------------
// SYNC LOGGING
// ---------------------------------------------------------

function startSync(provider, operation) {

    const startedAt = new Date().toISOString();

    const result = db.prepare(`
        INSERT INTO sync_logs (
            provider,
            operation,
            status,
            rows_written,
            message,
            started_at,
            finished_at
        )
        VALUES (?, ?, 'running', 0, NULL, ?, ?)
    `).run(
        provider,
        operation,
        startedAt,
        startedAt
    );

    return Number(result.lastInsertRowid);
}


function finishSync(
    id,
    status,
    rowsWritten,
    message = null
) {

    db.prepare(`
        UPDATE sync_logs

        SET
            status = ?,
            rows_written = ?,
            message = ?,
            finished_at = ?

        WHERE id = ?
    `).run(
        status,
        rowsWritten,
        message,
        new Date().toISOString(),
        id
    );
}


// ---------------------------------------------------------
// JOLPICA DRIVER IMPORT
// ---------------------------------------------------------

async function syncDrivers(season) {

    const logId = startSync(
        'jolpica',
        `drivers:${season}`
    );

    let rowsWritten = 0;

    try {

        const data = await fetchJson(
            `${JOLPICA_BASE}/${season}/drivers.json?limit=100`
        );

        const drivers =
            data?.MRData?.DriverTable?.Drivers || [];


        const statement = db.prepare(`
            INSERT INTO drivers (
                given_name,
                family_name,
                code,
                permanent_number,
                nationality,
                date_of_birth,
                provider,
                provider_id,
                source_updated_at,
                imported_at
            )

            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'jolpica',
                ?,
                ?,
                ?
            )

            ON CONFLICT(provider, provider_id)

            DO UPDATE SET
                given_name = excluded.given_name,
                family_name = excluded.family_name,
                code = excluded.code,
                permanent_number = excluded.permanent_number,
                nationality = excluded.nationality,
                date_of_birth = excluded.date_of_birth,
                source_updated_at = excluded.source_updated_at,
                imported_at = excluded.imported_at
        `);


        const now = new Date().toISOString();


        for (const driver of drivers) {

            statement.run(
                driver.givenName,
                driver.familyName,
                driver.code || null,
                driver.permanentNumber
                    ? Number(driver.permanentNumber)
                    : null,
                driver.nationality || null,
                driver.dateOfBirth || null,
                driver.driverId,
                now,
                now
            );

            rowsWritten++;
        }


        finishSync(
            logId,
            'success',
            rowsWritten,
            `Imported ${rowsWritten} drivers`
        );


        console.log(
            `Jolpica drivers imported: ${rowsWritten}`
        );

        return rowsWritten;

    } catch (err) {

        finishSync(
            logId,
            'failed',
            rowsWritten,
            err.message
        );

        throw err;
    }
}


// ---------------------------------------------------------
// JOLPICA RACE + RESULT IMPORT
// ---------------------------------------------------------

async function syncRaceResults(season) {

    const logId = startSync(
        'jolpica',
        `results:${season}`
    );

    let rowsWritten = 0;

    try {

        const data = await fetchJson(
            `${JOLPICA_BASE}/${season}/results.json?limit=2000`
        );


        const races =
            data?.MRData?.RaceTable?.Races || [];


        db.prepare(`
            INSERT INTO seasons (
                year,
                source_label
            )
            VALUES (?, 'jolpica')

            ON CONFLICT(year)
            DO UPDATE SET
                source_label = 'jolpica'
        `).run(season);


        const teamStatement = db.prepare(`
            INSERT INTO teams (
                name,
                nationality,
                provider,
                provider_id,
                source_updated_at,
                imported_at
            )

            VALUES (
                ?,
                ?,
                'jolpica',
                ?,
                ?,
                ?
            )

            ON CONFLICT(provider, provider_id)

            DO UPDATE SET
                name = excluded.name,
                nationality = excluded.nationality,
                source_updated_at = excluded.source_updated_at,
                imported_at = excluded.imported_at
        `);


        const driverStatement = db.prepare(`
            INSERT INTO drivers (
                given_name,
                family_name,
                code,
                permanent_number,
                nationality,
                date_of_birth,
                provider,
                provider_id,
                source_updated_at,
                imported_at
            )

            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'jolpica',
                ?,
                ?,
                ?
            )

            ON CONFLICT(provider, provider_id)

            DO UPDATE SET
                given_name = excluded.given_name,
                family_name = excluded.family_name,
                code = excluded.code,
                permanent_number = excluded.permanent_number,
                nationality = excluded.nationality,
                date_of_birth = excluded.date_of_birth,
                source_updated_at = excluded.source_updated_at,
                imported_at = excluded.imported_at
        `);


        const raceStatement = db.prepare(`
            INSERT INTO races (
                season_year,
                round,
                name,
                circuit_name,
                country,
                race_date,
                provider,
                provider_id,
                source_updated_at,
                imported_at
            )

            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'jolpica',
                ?,
                ?,
                ?
            )

            ON CONFLICT(provider, provider_id)

            DO UPDATE SET
                season_year = excluded.season_year,
                round = excluded.round,
                name = excluded.name,
                circuit_name = excluded.circuit_name,
                country = excluded.country,
                race_date = excluded.race_date,
                source_updated_at = excluded.source_updated_at,
                imported_at = excluded.imported_at
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
                ?,
                ?,
                ?,
                'jolpica',
                ?
            )

            ON CONFLICT(provider, provider_key)

            DO UPDATE SET
                driver_id = excluded.driver_id,
                team_id = excluded.team_id
        `);


        const resultStatement = db.prepare(`
            INSERT INTO race_results (
                race_id,
                driver_id,
                team_id,
                grid,
                finish_position,
                laps,
                status,
                fastest_lap_seconds,
                provider,
                provider_id
            )

            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'jolpica',
                ?
            )

            ON CONFLICT(provider, provider_id)

            DO UPDATE SET
                race_id = excluded.race_id,
                driver_id = excluded.driver_id,
                team_id = excluded.team_id,
                grid = excluded.grid,
                finish_position = excluded.finish_position,
                laps = excluded.laps,
                status = excluded.status,
                fastest_lap_seconds =
                    excluded.fastest_lap_seconds
        `);


        const now = new Date().toISOString();


        for (const race of races) {

            const raceProviderId =
                `${season}:${race.round}`;


            raceStatement.run(
                season,
                Number(race.round),
                race.raceName,
                race.Circuit?.circuitName || null,
                race.Circuit?.Location?.country || null,
                race.date || null,
                raceProviderId,
                now,
                now
            );


            const storedRace = db.prepare(`
                SELECT id
                FROM races
                WHERE provider = 'jolpica'
                AND provider_id = ?
            `).get(raceProviderId);


            for (const result of race.Results || []) {

                const driver = result.Driver;
                const team = result.Constructor;


                driverStatement.run(
                    driver.givenName,
                    driver.familyName,
                    driver.code || null,
                    driver.permanentNumber
                        ? Number(driver.permanentNumber)
                        : null,
                    driver.nationality || null,
                    driver.dateOfBirth || null,
                    driver.driverId,
                    now,
                    now
                );


                teamStatement.run(
                    team.name,
                    team.nationality || null,
                    team.constructorId,
                    now,
                    now
                );


                const storedDriver = db.prepare(`
                    SELECT id
                    FROM drivers
                    WHERE provider = 'jolpica'
                    AND provider_id = ?
                `).get(driver.driverId);


                const storedTeam = db.prepare(`
                    SELECT id
                    FROM teams
                    WHERE provider = 'jolpica'
                    AND provider_id = ?
                `).get(team.constructorId);


                membershipStatement.run(
                    season,
                    storedDriver.id,
                    storedTeam.id,
                    `${season}:${driver.driverId}:${team.constructorId}`
                );


                let fastestLapSeconds = null;

                if (result.FastestLap?.Time?.time) {

                    const value =
                        result.FastestLap.Time.time;

                    const parts = value.split(':');

                    if (parts.length === 2) {

                        fastestLapSeconds =
                            Number(parts[0]) * 60 +
                            Number(parts[1]);

                    }
                }


                const resultProviderId =
                    `${season}:${race.round}:${driver.driverId}`;


                resultStatement.run(
                    storedRace.id,
                    storedDriver.id,
                    storedTeam.id,
                    result.grid
                        ? Number(result.grid)
                        : null,
                    result.position
                        ? Number(result.position)
                        : null,
                    result.laps
                        ? Number(result.laps)
                        : null,
                    result.status || null,
                    fastestLapSeconds,
                    resultProviderId
                );


                rowsWritten++;
            }
        }


        finishSync(
            logId,
            'success',
            rowsWritten,
            `Imported ${rowsWritten} race results`
        );


        console.log(
            `Jolpica race results imported: ${rowsWritten}`
        );


        return rowsWritten;

    } catch (err) {

        finishSync(
            logId,
            'failed',
            rowsWritten,
            err.message
        );

        throw err;
    }
}


// ---------------------------------------------------------
// OPENF1 SESSION IMPORT
// ---------------------------------------------------------

async function syncOpenF1Sessions(season) {

    const logId = startSync(
        'openf1',
        `sessions:${season}`
    );

    let rowsWritten = 0;

    try {

        const data = await fetchJson(
            `${OPENF1_BASE}/sessions?year=${season}`
        );


        const statement = db.prepare(`
            INSERT INTO sessions (
                race_id,
                season_year,
                session_name,
                meeting_name,
                country_name,
                start_time,
                end_time,
                provider,
                provider_id,
                source_updated_at,
                imported_at
            )

            VALUES (
                NULL,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'openf1',
                ?,
                ?,
                ?
            )

            ON CONFLICT(provider, provider_id)

            DO UPDATE SET
                season_year = excluded.season_year,
                session_name = excluded.session_name,
                meeting_name = excluded.meeting_name,
                country_name = excluded.country_name,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                source_updated_at = excluded.source_updated_at,
                imported_at = excluded.imported_at
        `);


        const now = new Date().toISOString();


        for (const session of data) {

            // OpenF1's own session_key is retained.
            // We do NOT guess a Jolpica race ID.
            statement.run(
                Number(session.year),
                session.session_name,
                session.location || null,
                session.country_name || null,
                session.date_start || null,
                session.date_end || null,
                String(session.session_key),
                now,
                now
            );

            rowsWritten++;
        }


        finishSync(
            logId,
            'success',
            rowsWritten,
            `Imported ${rowsWritten} sessions`
        );


        console.log(
            `OpenF1 sessions imported: ${rowsWritten}`
        );


        return rowsWritten;

    } catch (err) {

        finishSync(
            logId,
            'failed',
            rowsWritten,
            err.message
        );

        throw err;
    }
}


// ---------------------------------------------------------
// MAIN SYNC
// ---------------------------------------------------------

async function syncSeason(season = DEFAULT_SEASON) {

    if (
        !Number.isInteger(Number(season)) ||
        Number(season) < 1950 ||
        Number(season) > 2100
    ) {

        throw new Error('Invalid season year');

    }


    season = Number(season);


    console.log(
        `\nStarting Formula 1 data sync for ${season}...\n`
    );


    await syncDrivers(season);

    // Small pause between providers/endpoints.
    await sleep(350);


    await syncRaceResults(season);

    await sleep(350);


    await syncOpenF1Sessions(season);


    console.log(
        `\nFormula 1 data sync completed for ${season}.\n`
    );
}


// ---------------------------------------------------------
// RUN DIRECTLY FROM TERMINAL
// ---------------------------------------------------------

if (require.main === module) {

    const season =
        process.argv[2]
            ? Number(process.argv[2])
            : DEFAULT_SEASON;


    syncSeason(season)
        .catch(err => {

            console.error(
                '\nSync failed:',
                err.message
            );

            process.exitCode = 1;

        });
}


// ---------------------------------------------------------
// EXPORT FOR SERVER
// ---------------------------------------------------------

module.exports = {
    fetchJson,
    syncDrivers,
    syncRaceResults,
    syncOpenF1Sessions,
    syncSeason
};