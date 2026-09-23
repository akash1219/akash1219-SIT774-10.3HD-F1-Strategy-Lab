const fs = require('fs');
const path = require('path');
const { db } = require('../db');

const F1DB_VERSION = 'v2026.14.1';
const F1DB_SCHEMA_VERSION = '6.5.0';
const F1DB_DIR = path.join(__dirname, '..', 'data', 'f1db');

const YEARS = [2024, 2025];

function readJson(filename) {
    const filePath = path.join(F1DB_DIR, filename);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing F1DB file: ${filePath}`);
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function nullable(value) {
    return value === undefined || value === null || value === ''
        ? null
        : value;
}

function addProviderMapping(
    entityType,
    fromProvider,
    fromId,
    toProvider,
    toId,
    method
) {
    db.prepare(`
        INSERT INTO provider_mappings (
            entity_type,
            from_provider,
            from_id,
            to_provider,
            to_id,
            mapping_method
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, from_provider, from_id, to_provider)
        DO UPDATE SET
            to_id = excluded.to_id,
            mapping_method = excluded.mapping_method
    `).run(
        entityType,
        fromProvider,
        String(fromId),
        toProvider,
        String(toId),
        method
    );
}

function getMappedEntity(entityType, f1dbId, tableName) {
    const mapping = db.prepare(`
        SELECT to_provider, to_id
        FROM provider_mappings
        WHERE entity_type = ?
          AND from_provider = 'f1db'
          AND from_id = ?
        ORDER BY
            CASE WHEN to_provider = 'jolpica' THEN 0 ELSE 1 END,
            id
        LIMIT 1
    `).get(entityType, String(f1dbId));

    if (!mapping) {
        return null;
    }

    return db.prepare(`
        SELECT *
        FROM ${tableName}
        WHERE provider = ?
          AND provider_id = ?
    `).get(mapping.to_provider, mapping.to_id) || null;
}

function findExistingDriver(driver) {
    const mapped = getMappedEntity('driver', driver.id, 'drivers');
    if (mapped) return mapped;

    /*
     * Explicit identity rule:
     * only reuse an existing record when its provider_id is exactly the
     * F1DB stable ID. We deliberately do not match permanent_number.
     */
    const exactProviderId = db.prepare(`
        SELECT *
        FROM drivers
        WHERE provider_id = ?
          AND provider IN ('jolpica', 'bootstrap')
        ORDER BY CASE WHEN provider = 'jolpica' THEN 0 ELSE 1 END
        LIMIT 1
    `).get(driver.id);

    return exactProviderId || null;
}

function ensureDriver(driver) {
    let existing = getMappedEntity('driver', driver.id, 'drivers');

    if (!existing) {
        existing = findExistingDriver(driver);
    }

    if (existing) {
        addProviderMapping(
            'driver',
            'f1db',
            driver.id,
            existing.provider,
            existing.provider_id,
            'exact-provider-id'
        );

        return existing.id;
    }

    db.prepare(`
        INSERT INTO drivers (
            given_name,
            family_name,
            code,
            permanent_number,
            nationality,
            date_of_birth,
            provider,
            provider_id,
            source_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'f1db', ?, ?)
        ON CONFLICT(provider, provider_id)
        DO UPDATE SET
            given_name = excluded.given_name,
            family_name = excluded.family_name,
            code = excluded.code,
            permanent_number = excluded.permanent_number,
            nationality = excluded.nationality,
            date_of_birth = excluded.date_of_birth,
            source_updated_at = excluded.source_updated_at
    `).run(
        driver.firstName || driver.name || driver.id,
        driver.lastName || '',
        nullable(driver.abbreviation),
        nullable(driver.permanentNumber),
        nullable(driver.nationalityCountryId),
        nullable(driver.dateOfBirth),
        driver.id,
        F1DB_VERSION
    );

    const inserted = db.prepare(`
        SELECT id
        FROM drivers
        WHERE provider = 'f1db'
          AND provider_id = ?
    `).get(driver.id);

    addProviderMapping(
        'driver',
        'f1db',
        driver.id,
        'f1db',
        driver.id,
        'native-f1db'
    );

    return inserted.id;
}

function findExistingTeam(constructor) {
    const mapped = getMappedEntity('team', constructor.id, 'teams');
    if (mapped) return mapped;

    const exactProviderId = db.prepare(`
        SELECT *
        FROM teams
        WHERE provider_id = ?
          AND provider IN ('jolpica', 'bootstrap')
        ORDER BY CASE WHEN provider = 'jolpica' THEN 0 ELSE 1 END
        LIMIT 1
    `).get(constructor.id);

    return exactProviderId || null;
}

function ensureTeam(constructor) {
    let existing = getMappedEntity('team', constructor.id, 'teams');

    if (!existing) {
        existing = findExistingTeam(constructor);
    }

    if (existing) {
        addProviderMapping(
            'team',
            'f1db',
            constructor.id,
            existing.provider,
            existing.provider_id,
            'exact-provider-id'
        );

        return existing.id;
    }

    db.prepare(`
        INSERT INTO teams (
            name,
            nationality,
            provider,
            provider_id,
            source_updated_at
        )
        VALUES (?, ?, 'f1db', ?, ?)
        ON CONFLICT(provider, provider_id)
        DO UPDATE SET
            name = excluded.name,
            nationality = excluded.nationality,
            source_updated_at = excluded.source_updated_at
    `).run(
        constructor.name || constructor.fullName || constructor.id,
        nullable(constructor.countryId),
        constructor.id,
        F1DB_VERSION
    );

    const inserted = db.prepare(`
        SELECT id
        FROM teams
        WHERE provider = 'f1db'
          AND provider_id = ?
    `).get(constructor.id);

    addProviderMapping(
        'team',
        'f1db',
        constructor.id,
        'f1db',
        constructor.id,
        'native-f1db'
    );

    return inserted.id;
}

function ensureRace(race, grandPrixMap, circuitMap) {
    /*
     * races has UNIQUE(season_year, round), so year + round is our
     * canonical collision point. Existing Jolpica races are retained.
     */
    let existing = db.prepare(`
        SELECT *
        FROM races
        WHERE season_year = ?
          AND round = ?
    `).get(race.year, race.round);

    if (existing) {
        addProviderMapping(
            'race',
            'f1db',
            race.id,
            existing.provider,
            existing.provider_id,
            'season-round'
        );

        return existing.id;
    }

    const grandPrix = grandPrixMap.get(race.grandPrixId);
    const circuit = circuitMap.get(race.circuitId);

    const raceName =
        grandPrix?.fullName ||
        grandPrix?.name ||
        race.officialName ||
        `Round ${race.round}`;

    const circuitName =
        circuit?.fullName ||
        circuit?.name ||
        nullable(race.circuitId);

    const country =
        circuit?.countryId ||
        grandPrix?.countryId ||
        null;

    db.prepare(`
        INSERT INTO races (
            season_year,
            round,
            name,
            circuit_name,
            country,
            race_date,
            provider,
            provider_id,
            source_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'f1db', ?, ?)
    `).run(
        race.year,
        race.round,
        raceName,
        circuitName,
        country,
        nullable(race.date),
        String(race.id),
        F1DB_VERSION
    );

    existing = db.prepare(`
        SELECT *
        FROM races
        WHERE provider = 'f1db'
          AND provider_id = ?
    `).get(String(race.id));

    addProviderMapping(
        'race',
        'f1db',
        race.id,
        'f1db',
        race.id,
        'native-f1db'
    );

    return existing.id;
}

function fastestLapSeconds(record) {
    if (!record || record.timeMillis === null || record.timeMillis === undefined) {
        return null;
    }

    const milliseconds = Number(record.timeMillis);

    return Number.isFinite(milliseconds)
        ? milliseconds / 1000
        : null;
}

function main() {
    console.log(`Importing F1DB ${F1DB_VERSION}`);
    console.log(`Schema ${F1DB_SCHEMA_VERSION}`);
    console.log(`Seasons: ${YEARS.join(', ')}`);

    const drivers = readJson('f1db-drivers.json');
    const constructors = readJson('f1db-constructors.json');
    const seasonDrivers = readJson('f1db-seasons-drivers.json');
    const seasonConstructors = readJson('f1db-seasons-constructors.json');
    const races = readJson('f1db-races.json');
    const raceResults = readJson('f1db-races-race-results.json');
    const fastestLaps = readJson('f1db-races-fastest-laps.json');
    const grandsPrix = readJson('f1db-grands-prix.json');
    const circuits = readJson('f1db-circuits.json');

    const driverMap = new Map(drivers.map(x => [x.id, x]));
    const constructorMap = new Map(constructors.map(x => [x.id, x]));
    const grandPrixMap = new Map(grandsPrix.map(x => [x.id, x]));
    const circuitMap = new Map(circuits.map(x => [x.id, x]));

    const relevantSeasonDrivers = seasonDrivers.filter(x =>
        YEARS.includes(x.year)
    );

    const relevantSeasonConstructors = seasonConstructors.filter(x =>
        YEARS.includes(x.year)
    );

    const relevantRaces = races.filter(x =>
        YEARS.includes(x.year)
    );

    const relevantResults = raceResults.filter(x =>
        YEARS.includes(x.year)
    );

    const relevantFastestLaps = fastestLaps.filter(x =>
        YEARS.includes(x.year)
    );

    const relevantDriverIds = new Set(
        relevantSeasonDrivers.map(x => x.driverId)
    );

    const relevantConstructorIds = new Set(
        relevantSeasonConstructors.map(x => x.constructorId)
    );

    for (const result of relevantResults) {
        relevantDriverIds.add(result.driverId);
        relevantConstructorIds.add(result.constructorId);
    }

    const fastestLapByRaceDriver = new Map();

    for (const lap of relevantFastestLaps) {
        const key = `${lap.raceId}:${lap.driverId}`;
        fastestLapByRaceDriver.set(key, lap);
    }

    const startedAt = new Date().toISOString();

    let rowsWritten = 0;

    db.exec('BEGIN IMMEDIATE');

    try {
        db.prepare(`
            INSERT INTO data_sources (
                code,
                name,
                base_url,
                requires_key,
                notes
            )
            VALUES (
                'f1db',
                'F1DB',
                'https://github.com/f1db/f1db',
                0,
                ?
            )
            ON CONFLICT(code)
            DO UPDATE SET
                name = excluded.name,
                base_url = excluded.base_url,
                requires_key = excluded.requires_key,
                notes = excluded.notes
        `).run(
            `Downloaded dataset ${F1DB_VERSION}; JSON schema ${F1DB_SCHEMA_VERSION}; CC BY 4.0.`
        );

        for (const year of YEARS) {
            db.prepare(`
                INSERT INTO seasons (year, source_label)
                VALUES (?, 'F1DB + existing providers')
                ON CONFLICT(year)
                DO UPDATE SET
                    source_label = 'F1DB + existing providers'
            `).run(year);
        }

        const localDriverIds = new Map();

        for (const f1dbId of relevantDriverIds) {
            const driver = driverMap.get(f1dbId);

            if (!driver) {
                console.warn(`Skipping unknown driver ${f1dbId}`);
                continue;
            }

            localDriverIds.set(f1dbId, ensureDriver(driver));
        }

        const localTeamIds = new Map();

        for (const f1dbId of relevantConstructorIds) {
            const constructor = constructorMap.get(f1dbId);

            if (!constructor) {
                console.warn(`Skipping unknown constructor ${f1dbId}`);
                continue;
            }

            localTeamIds.set(f1dbId, ensureTeam(constructor));
        }

        const localRaceIds = new Map();

        for (const race of relevantRaces) {
            const localRaceId = ensureRace(
                race,
                grandPrixMap,
                circuitMap
            );

            localRaceIds.set(String(race.id), localRaceId);
        }

        /*
         * Build season memberships from actual race results.
         * This preserves multiple constructor memberships for drivers who
         * race for more than one constructor during the same season.
         */
        const membershipKeys = new Set();

        for (const result of relevantResults) {
            const driverId = localDriverIds.get(result.driverId);
            const teamId = localTeamIds.get(result.constructorId);

            if (!driverId || !teamId) continue;

            const uniqueKey =
                `${result.year}:${driverId}:${teamId}`;

            if (membershipKeys.has(uniqueKey)) continue;
            membershipKeys.add(uniqueKey);

            db.prepare(`
                INSERT INTO season_memberships (
                    season_year,
                    driver_id,
                    team_id,
                    provider,
                    provider_key
                )
                VALUES (?, ?, ?, 'f1db', ?)
                ON CONFLICT(season_year, driver_id, team_id)
                DO NOTHING
            `).run(
                result.year,
                driverId,
                teamId,
                `${result.year}:${result.driverId}:${result.constructorId}`
            );
        }

        for (const result of relevantResults) {
            const raceId = localRaceIds.get(String(result.raceId));
            const driverId = localDriverIds.get(result.driverId);
            const teamId = localTeamIds.get(result.constructorId);

            if (!raceId || !driverId) {
                console.warn(
                    `Skipping result ${result.raceId}/${result.driverId}`
                );
                continue;
            }

            const fastest = fastestLapByRaceDriver.get(
                `${result.raceId}:${result.driverId}`
            );

            const providerId =
                `${result.raceId}:${result.driverId}`;

            db.prepare(`
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'f1db', ?)
                ON CONFLICT(provider, provider_id)
                DO UPDATE SET
                    race_id = excluded.race_id,
                    driver_id = excluded.driver_id,
                    team_id = excluded.team_id,
                    grid = excluded.grid,
                    finish_position = excluded.finish_position,
                    laps = excluded.laps,
                    status = excluded.status,
                    fastest_lap_seconds = excluded.fastest_lap_seconds
            `).run(
                raceId,
                driverId,
                teamId || null,
                nullable(result.gridPositionNumber),
                nullable(result.positionNumber),
                nullable(result.laps),
                result.reasonRetired
                    ? result.reasonRetired
                    : (result.positionText || 'Finished'),
                fastestLapSeconds(fastest),
                providerId
            );

            rowsWritten++;
        }

        const finishedAt = new Date().toISOString();

        db.prepare(`
            INSERT INTO sync_logs (
                provider,
                operation,
                status,
                rows_written,
                message,
                started_at,
                finished_at
            )
            VALUES (
                'f1db',
                'import:2024-2025',
                'success',
                ?,
                ?,
                ?,
                ?
            )
        `).run(
            rowsWritten,
            `${F1DB_VERSION}; schema ${F1DB_SCHEMA_VERSION}`,
            startedAt,
            finishedAt
        );

        db.exec('COMMIT');

        console.log('');
        console.log('F1DB import completed.');
        console.log(`Race-result rows processed: ${rowsWritten}`);
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

try {
    main();
} catch (error) {
    console.error('');
    console.error('F1DB import failed.');
    console.error(error);
    process.exitCode = 1;
}