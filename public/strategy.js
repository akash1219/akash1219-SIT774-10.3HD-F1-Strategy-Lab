let catalog = { drivers: [], races: [] };
let worker = null;
let currentStrategyId = null;
let lastResult = null;

const $ = id => document.getElementById(id);

const status = (message, type = 'secondary') => {
    $('globalStatus').className = `alert alert-${type} status-live`;
    $('globalStatus').textContent = message;
};


// ======================================================
// TYRE STINTS
// ======================================================

function stintRow(
    stint = {
        compound: 'MEDIUM',
        startLap: 1,
        endLap: 57,
        degradationMsPerLap: 45
    }
) {
    const row = document.createElement('div');

    row.className = 'stint-row bg-light rounded p-3 mt-2';

    row.innerHTML = `
        <div class="row g-2 align-items-end">

            <div class="col-6 col-md-3">
                <label class="form-label">Compound</label>

                <select class="form-select compound">
                    <option>SOFT</option>
                    <option>MEDIUM</option>
                    <option>HARD</option>
                </select>
            </div>

            <div class="col-6 col-md-2">
                <label class="form-label">Start</label>

                <input
                    class="form-control start"
                    type="number"
                    min="1"
                    value="${stint.startLap}"
                >
            </div>

            <div class="col-6 col-md-2">
                <label class="form-label">End</label>

                <input
                    class="form-control end"
                    type="number"
                    min="1"
                    value="${stint.endLap}"
                >
            </div>

            <div class="col-6 col-md-3">
                <label class="form-label">
                    Degradation ms/lap
                </label>

                <input
                    class="form-control deg"
                    type="number"
                    min="0"
                    max="500"
                    value="${stint.degradationMsPerLap}"
                >
            </div>

            <div class="col-md-2">
                <button
                    class="btn btn-outline-secondary btn-sm remove"
                    type="button"
                >
                    Remove
                </button>
            </div>

        </div>
    `;

    row.querySelector('.compound').value = stint.compound;

    row.querySelector('.remove').onclick = () => {
        row.remove();
    };

    $('stints').appendChild(row);
}


function readStints() {
    return [...document.querySelectorAll('.stint-row')].map(
        (row, index) => ({
            stintOrder: index + 1,

            compound:
                row.querySelector('.compound').value,

            startLap:
                Number(row.querySelector('.start').value),

            endLap:
                Number(row.querySelector('.end').value),

            degradationMsPerLap:
                Number(row.querySelector('.deg').value)
        })
    );
}


// ======================================================
// FORM DATA
// ======================================================

function payload() {
    return {
        name:
            $('strategyName').value.trim(),

        driverId:
            Number($('driverSelect').value),

        raceId:
            $('raceSelect').value
                ? Number($('raceSelect').value)
                : null,

        totalLaps:
            Number($('totalLaps').value),

        fuelEffectMs:
            Number($('fuelEffect').value),

        trafficLossMs:
            Number($('trafficLoss').value),

        pitLossSeconds:
            Number($('pitLoss').value),

        stints:
            readStints()
    };
}


// ======================================================
// VALIDATION
// ======================================================

function validate(data) {

    if (!data.name || !data.driverId) {
        return 'Choose a driver and enter a strategy name.';
    }

    if (data.totalLaps < 10 || data.totalLaps > 100) {
        return 'Total laps must be 10-100.';
    }

    if (!data.stints.length) {
        return 'Add at least one stint.';
    }

    let expectedLap = 1;

    for (const stint of data.stints) {

        if (
            stint.startLap !== expectedLap ||
            stint.endLap < stint.startLap
        ) {
            return 'Stints must be consecutive without gaps.';
        }

        expectedLap = stint.endLap + 1;
    }

    if (expectedLap !== data.totalLaps + 1) {
        return `The final stint must end on lap ${data.totalLaps}.`;
    }

    return null;
}


// ======================================================
// API HELPER
// ======================================================

async function api(url, options) {

    const response = await fetch(url, options);

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok) {
        throw new Error(
            data.error || `HTTP ${response.status}`
        );
    }

    return data;
}


// ======================================================
// DATABASE-BACKED CATALOG
// ======================================================

async function loadCatalog(options = {}) {
    const season =
        Number(options.season || $('seasonSelect').value || 2024);

    const raceId =
        options.raceId !== undefined
            ? options.raceId
            : ($('raceSelect').value || '');

    const preferredDriverId =
        options.preferredDriverId !== undefined
            ? Number(options.preferredDriverId)
            : Number($('driverSelect').value || 0);

    try {
        const params = new URLSearchParams({ season: String(season) });

        if (raceId) {
            params.set('raceId', String(raceId));
        }

        catalog = await api(`/api/strategy/catalog?${params.toString()}`);

        $('seasonSelect').innerHTML = '';

        catalog.seasons.forEach(item => {
            $('seasonSelect').add(
                new Option(String(item.year), item.year)
            );
        });

        $('seasonSelect').value = String(catalog.season);

        $('raceSelect').innerHTML =
            '<option value="">No imported race selected</option>';

        catalog.races.forEach(race => {
            const label =
                `R${race.round} - ${race.name}`;

            $('raceSelect').add(
                new Option(label, race.id)
            );
        });

        if (
            raceId &&
            catalog.races.some(race => Number(race.id) === Number(raceId))
        ) {
            $('raceSelect').value = String(raceId);
        }

        $('driverSelect').innerHTML = '';

        catalog.drivers.forEach(driver => {
            const label =
                `${driver.given_name} ${driver.family_name}` +
                `${driver.team_name ? ' - ' + driver.team_name : ''}`;

            $('driverSelect').add(
                new Option(label, driver.id)
            );
        });

        if (
            preferredDriverId &&
            catalog.drivers.some(
                driver => Number(driver.id) === preferredDriverId
            )
        ) {
            $('driverSelect').value = String(preferredDriverId);
        }

        $('sourceInfo').innerHTML =
            catalog.sources.map(source => `
                <div class="mb-2">
                    <strong>${escapeHtml(source.name)}</strong>
                    <span class="badge text-bg-light">
                        ${source.requires_key ? 'optional key' : 'no key'}
                    </span>
                    <br>
                    <small>${escapeHtml(source.notes || '')}</small>
                </div>
            `).join('') +
            (
                catalog.lastSync.length
                    ? `
                        <hr>
                        <small>
                            Last import/sync:
                            ${escapeHtml(catalog.lastSync[0].provider)}
                            ${escapeHtml(catalog.lastSync[0].status)},
                            ${escapeHtml(catalog.lastSync[0].finished_at)}
                        </small>
                    `
                    : `
                        <hr>
                        <small>No external sync/import logged yet.</small>
                    `
            );

        $('syncBtn').textContent =
            `Sync ${catalog.season} no-key data`;

        status(
            `SQLite catalog: ${catalog.season}, ` +
            `${catalog.drivers.length} drivers, ` +
            `${catalog.races.length} races.`,
            'success'
        );

    } catch (error) {
        status(
            `Unable to load database-backed catalog: ${error.message}`,
            'danger'
        );
    }
}


// ======================================================
// HISTORICAL RACE CONTEXT
// ======================================================

async function loadHistorical() {
    const raceId = $('raceSelect').value;

    if (!raceId) {
        $('historical').innerHTML =
            '<p class="text-muted mb-0">' +
            'Select an imported race to view stored results.' +
            '</p>';

        return;
    }

    try {
        const data =
            await api(`/api/strategy/historical/${raceId}`);

        const selectedDriver =
            Number($('driverSelect').value);

        const driverResult =
            data.results.find(
                result => result.driver_id === selectedDriver
            );

        $('historical').innerHTML = `
            <p>
                <strong>
                    ${data.race.season_year}
                    ${escapeHtml(data.race.name)}
                </strong>
                <br>
                <small>${escapeHtml(data.source)}</small>
            </p>

            ${
                driverResult
                    ? `
                        <p class="mb-1">
                            Selected driver:
                            ${escapeHtml(driverResult.team_name || 'team not stored')},
                            grid ${driverResult.grid === null ? '-' : 'P' + driverResult.grid},
                            finish ${
                                driverResult.finish_position === null
                                    ? escapeHtml(driverResult.status || 'not classified')
                                    : 'P' + driverResult.finish_position
                            },
                            fastest lap ${
                                driverResult.fastest_lap_seconds
                                    ? Number(driverResult.fastest_lap_seconds).toFixed(3) + ' s'
                                    : 'not stored'
                            }.
                        </p>

                        ${
                            driverResult.fastest_lap_seconds
                                ? `
                                    <button
                                        id="useHistoricalLapBtn"
                                        type="button"
                                        class="btn btn-outline-secondary btn-sm mt-2"
                                    >
                                        Use ${Number(driverResult.fastest_lap_seconds).toFixed(3)} s as base lap
                                    </button>
                                    <p class="small text-muted mt-2 mb-0">
                                        This changes the hypothetical Base lap only when you choose it.
                                    </p>
                                `
                                : ''
                        }
                    `
                    : `
                        <p class="text-muted">
                            No stored result for the selected driver.
                        </p>
                    `
            }
        `;

        const useButton = $('useHistoricalLapBtn');

        if (useButton && driverResult?.fastest_lap_seconds) {
            useButton.addEventListener('click', () => {
                $('baseLap').value =
                    Number(driverResult.fastest_lap_seconds).toFixed(3);

                status(
                    'Historical fastest lap copied into Base lap. ' +
                    'It is now an explicit simulation assumption.',
                    'secondary'
                );
            });
        }

    } catch (error) {
        $('historical').textContent = error.message;
    }
}


async function changeSeason() {
    currentStrategyId = null;

    await loadCatalog({
        season: Number($('seasonSelect').value),
        raceId: ''
    });

    $('historical').innerHTML =
        '<p class="text-muted mb-0">' +
        'Select an imported race to view stored results.' +
        '</p>';
}


async function changeRace() {
    const season = Number($('seasonSelect').value);
    const raceId = $('raceSelect').value;
    const previousDriver = Number($('driverSelect').value || 0);

    await loadCatalog({
        season,
        raceId,
        preferredDriverId: previousDriver
    });

    await loadHistorical();
}

// ======================================================
// WEB WORKER
// ======================================================

function makeWorker() {

    if (worker) {
        worker.terminate();
    }

    worker =
        new Worker('strategy-worker.js');

    return worker;
}


// ======================================================
// RUN SIMULATION
// ======================================================

function run() {

    const data = payload();

    const validationError =
        validate(data);

    if (validationError) {
        return status(
            validationError,
            'danger'
        );
    }


    const seed =
        Number($('seed').value);

    if (
        !Number.isInteger(seed) ||
        seed < 1
    ) {
        return status(
            'Seed must be a positive integer.',
            'danger'
        );
    }


    const baseLap =
        Number($('baseLap').value);

    if (
        !Number.isFinite(baseLap) ||
        baseLap < 30 ||
        baseLap > 180
    ) {
        return status(
            'Base lap must be 30-180 seconds.',
            'danger'
        );
    }


    const currentWorker =
        makeWorker();


    $('runBtn').disabled = true;

    $('cancelBtn').disabled = false;

    $('progressBar').style.width = '0%';

    $('progressBar').textContent = '0%';


    status(
        'Simulation running in Web Worker...',
        'warning'
    );


    currentWorker.onmessage =
        async event => {

            if (
                event.data.type === 'progress'
            ) {

                $('progressBar').style.width =
                    event.data.percent + '%';

                $('progressBar').textContent =
                    event.data.percent + '%';
            }


            if (
                event.data.type === 'error'
            ) {

                status(
                    event.data.message,
                    'danger'
                );

                finishRun();
            }


            if (
                event.data.type === 'complete'
            ) {

                lastResult =
                    event.data.result;

                renderResult(lastResult);

                finishRun();

                status(
                    `Simulation complete. Seed ${seed} can reproduce this run.`,
                    'success'
                );


                try {

                    await api(
                        '/api/simulation-runs',
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/json'
                            },

                            body:
                                JSON.stringify({
                                    strategyId:
                                        currentStrategyId,

                                    driverId:
                                        data.driverId,

                                    raceId:
                                        data.raceId,

                                    seed,

                                    assumptions: {
                                        baseLapSeconds:
                                            baseLap,

                                        fuelEffectMs:
                                            data.fuelEffectMs,

                                        trafficLossMs:
                                            data.trafficLossMs,

                                        pitLossSeconds:
                                            data.pitLossSeconds,

                                        stints:
                                            data.stints
                                    },

                                    result:
                                        lastResult,

                                    totalTimeSeconds:
                                        lastResult.totalTimeSeconds,

                                    pitStops:
                                        lastResult.pitStops
                                })
                        }
                    );


                    await loadRuns();

                } catch (error) {

                    status(
                        'Simulation completed, but run history ' +
                        `was not stored: ${error.message}`,
                        'warning'
                    );
                }
            }
        };


    currentWorker.onerror = () => {

        status(
            'Web Worker failed. No result was stored.',
            'danger'
        );

        finishRun();
    };


    currentWorker.postMessage({
        type: 'run',

        payload: {
            ...data,
            seed,
            baseLapSeconds: baseLap
        }
    });
}


// ======================================================
// FINISH / CANCEL
// ======================================================

function finishRun() {

    $('runBtn').disabled = false;

    $('cancelBtn').disabled = true;
}


function cancel() {

    if (worker) {

        worker.terminate();

        worker = null;
    }


    finishRun();


    // A cancelled run has no remaining progress.
    $('progressBar').style.width = '0%';

    $('progressBar').textContent = '0%';


    status(
        'Simulation cancelled. No partial run was stored.',
        'secondary'
    );
}


// ======================================================
// SIMULATION RESULT
// ======================================================

function renderResult(result) {

    $('resultEmpty').classList.add('d-none');

    $('resultPanel').classList.remove('d-none');


    $('totalTime').textContent =
        formatTime(
            result.totalTimeSeconds
        );


    $('avgLap').textContent =
        result.averageLapSeconds
            .toFixed(3) + ' s';


    $('pitStops').textContent =
        result.pitStops;


    $('lapRows').innerHTML =
        result.laps.map(lap => `
            <tr>

                <td>${lap.lap}</td>

                <td>${lap.compound}</td>

                <td>${lap.tyreAge}</td>

                <td>
                    ${lap.lapTime.toFixed(3)} s
                </td>

                <td>
                    ${lap.pit ? 'Pit stop' : ''}
                </td>

            </tr>
        `).join('');
}


function formatTime(seconds) {

    const minutes =
        Math.floor(seconds / 60);

    return (
        `${minutes}:` +
        `${(seconds - minutes * 60)
            .toFixed(3)
            .padStart(6, '0')}`
    );
}


// ======================================================
// SAVED STRATEGY CRUD
// ======================================================

async function saveStrategy() {

    const data =
        payload();

    const validationError =
        validate(data);

    if (validationError) {

        return status(
            validationError,
            'danger'
        );
    }


    try {

        const method =
            currentStrategyId
                ? 'PUT'
                : 'POST';


        const url =
            currentStrategyId
                ? `/api/strategies/${currentStrategyId}`
                : '/api/strategies';


        const response =
            await api(
                url,
                {
                    method,

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify(data)
                }
            );


        currentStrategyId =
            response.id;


        status(
            `Strategy ${
                method === 'POST'
                    ? 'saved'
                    : 'updated'
            } in SQLite.`,
            'success'
        );


        await loadSaved();

    } catch (error) {

        status(
            error.message,
            'danger'
        );
    }
}


async function loadSaved() {

    try {

        const rows =
            await api('/api/strategies');


        $('savedStrategies').innerHTML =
            rows.length

                ? rows.map(row => `
                    <div class="border rounded p-2 mb-2">

                        <strong>
                            ${escapeHtml(row.name)}
                        </strong>

                        <br>

                        <small>
                            ${escapeHtml(row.driver_name)}
                            |
                            ${row.total_laps} laps
                            |
                            ${row.pit_stops} stops
                        </small>

                        <div class="mt-2">

                            <button
                                class="btn btn-sm btn-outline-dark me-1"
                                onclick="editSaved(${row.id})"
                            >
                                Load/Edit
                            </button>

                            <button
                                class="btn btn-sm btn-outline-danger"
                                onclick="deleteSaved(${row.id})"
                            >
                                Delete
                            </button>

                        </div>

                    </div>
                `).join('')

                : `
                    <p class="text-muted">
                        No saved strategies yet.
                    </p>
                `;

    } catch (error) {

        $('savedStrategies').textContent =
            error.message;
    }
}


async function editSaved(id) {
    try {
        const strategy =
            await api(`/api/strategies/${id}`);

        currentStrategyId = strategy.id;

        $('strategyName').value = strategy.name;

        const targetSeason =
            Number(strategy.race_year || $('seasonSelect').value || 2024);

        await loadCatalog({
            season: targetSeason,
            raceId: strategy.race_id || '',
            preferredDriverId: strategy.driver_id
        });

        // Existing saved strategies can reference a pre-F1DB driver row.
        // Prefer the original ID when it is still present. If the selected
        // race now exposes the F1DB identity instead, resolve the same driver
        // by the exact saved full name without modifying the stored strategy.
        let resolvedDriverId = Number(strategy.driver_id);

        const originalDriverAvailable =
            catalog.drivers.some(
                driver => Number(driver.id) === resolvedDriverId
            );

        if (!originalDriverAvailable) {
            const savedName =
                String(strategy.driver_name || '').trim().toLowerCase();
            const savedFamily =
                String(strategy.driver_family_name || '').trim().toLowerCase();
            const savedCode =
                String(strategy.driver_code || '').trim().toUpperCase();

            let matchingDriver =
                catalog.drivers.find(driver =>
                    `${driver.given_name} ${driver.family_name}`
                        .trim()
                        .toLowerCase() === savedName
                );

            // Legacy providers can use a different given-name form.
            // Use family name + driver code only when it resolves uniquely.
            if (!matchingDriver && savedFamily && savedCode) {
                const candidates = catalog.drivers.filter(driver =>
                    String(driver.family_name || '').trim().toLowerCase() === savedFamily &&
                    String(driver.code || '').trim().toUpperCase() === savedCode
                );
                if (candidates.length === 1) matchingDriver = candidates[0];
            }

            if (matchingDriver) {
                resolvedDriverId = Number(matchingDriver.id);
            }
        }

        $('driverSelect').value = catalog.drivers.some(
            driver => Number(driver.id) === resolvedDriverId
        )
            ? String(resolvedDriverId)
            : '';

        $('raceSelect').value = strategy.race_id
            ? String(strategy.race_id)
            : '';

        $('totalLaps').value = strategy.total_laps;
        $('fuelEffect').value = strategy.fuel_effect_ms;
        $('trafficLoss').value = strategy.traffic_loss_ms;
        $('pitLoss').value = strategy.pit_loss_seconds;

        $('stints').innerHTML = '';

        strategy.stints.forEach(stint => {
            stintRow({
                compound: stint.compound,
                startLap: stint.start_lap,
                endLap: stint.end_lap,
                degradationMsPerLap:
                    stint.degradation_ms_per_lap
            });
        });

        status(
            `Loaded saved strategy #${id}. ` +
            'Saving now updates this record.',
            'success'
        );

        await loadHistorical();

    } catch (error) {
        status(error.message, 'danger');
    }
}


async function deleteSaved(id) {

    const confirmed =
        confirm(
            'Delete this saved strategy? ' +
            'Stored simulation runs keep their result ' +
            'but lose the strategy link.'
        );


    if (!confirmed) {
        return;
    }


    try {

        await api(
            `/api/strategies/${id}`,
            {
                method: 'DELETE'
            }
        );


        if (
            currentStrategyId === id
        ) {
            currentStrategyId = null;
        }


        await loadSaved();

        await loadRuns();


        status(
            'Saved strategy deleted.',
            'success'
        );

    } catch (error) {

        status(
            error.message,
            'danger'
        );
    }
}


// ======================================================
// STORED RUN HISTORY
// ======================================================

async function loadRuns() {

    try {

        const rows =
            await api(
                '/api/simulation-runs'
            );


        $('runHistory').innerHTML =
            rows.length

                ? `
                    <div class="table-responsive">

                        <table class="table table-sm">

                            <thead>

                                <tr>
                                    <th>Strategy</th>
                                    <th>Seed</th>
                                    <th>Total</th>
                                    <th>Stops</th>
                                </tr>

                            </thead>

                            <tbody>

                                ${
                                    rows
                                        .slice(0, 12)
                                        .map(row => `
                                            <tr>

                                                <td>
                                                    ${
                                                        escapeHtml(
                                                            row.strategy_name ||
                                                            'Unsaved run'
                                                        )
                                                    }
                                                </td>

                                                <td>
                                                    ${row.seed}
                                                </td>

                                                <td>
                                                    ${
                                                        formatTime(
                                                            row.total_time_seconds
                                                        )
                                                    }
                                                </td>

                                                <td>
                                                    ${row.pit_stops}
                                                </td>

                                            </tr>
                                        `)
                                        .join('')
                                }

                            </tbody>

                        </table>

                    </div>
                `

                : `
                    <p class="text-muted">
                        No stored runs yet.
                    </p>
                `;

    } catch (error) {

        $('runHistory').textContent =
            error.message;
    }
}


// ======================================================
// HTML ESCAPING
// ======================================================

function escapeHtml(value) {

    const div =
        document.createElement('div');

    div.textContent =
        value ?? '';

    return div.innerHTML;
}


// ======================================================
// EXTERNAL DATA SYNC
// ======================================================

async function syncData() {
    const year = Number($('seasonSelect').value);

    const confirmed =
        confirm(
            `Sync ${year} race data from Jolpica and OpenF1? ` +
            'This may take several seconds and uses external rate limits.'
        );

    if (!confirmed) {
        return;
    }

    try {
        status(
            `Syncing ${year} data from Jolpica and OpenF1...`,
            'secondary'
        );

        const response =
            await fetch(
                '/api/data/sync',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ year })
                }
            );

        let data = {};

        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {
            throw new Error(
                data.error ||
                data.message ||
                'Data sync failed.'
            );
        }

        status(
            data.message ||
            `Formula 1 data sync completed for ${year}.`,
            'success'
        );

        await loadCatalog({
            season: year,
            raceId: $('raceSelect').value,
            preferredDriverId: Number($('driverSelect').value || 0)
        });

        await loadHistorical();

    } catch (error) {
        status(
            `${error.message} Cached SQLite data is still available.`,
            'danger'
        );
    }
}


// ======================================================
// PAGE INITIALISATION
// ======================================================

document.addEventListener(
    'DOMContentLoaded',
    async () => {

        /*
         * Create the default two-stint strategy only if
         * the page does not already contain stint rows.
         */
        if (
            document.querySelectorAll('.stint-row').length === 0
        ) {

            stintRow({
                compound: 'MEDIUM',
                startLap: 1,
                endLap: 28,
                degradationMsPerLap: 45
            });


            stintRow({
                compound: 'HARD',
                startLap: 29,
                endLap: 57,
                degradationMsPerLap: 28
            });
        }


        // Button handlers.
        $('addStint').addEventListener(
            'click',
            () => stintRow()
        );


        $('runBtn').addEventListener(
            'click',
            run
        );


        $('cancelBtn').addEventListener(
            'click',
            cancel
        );


        $('saveBtn').addEventListener(
            'click',
            saveStrategy
        );


        $('newBtn').addEventListener(
            'click',
            () => {

                currentStrategyId = null;

                status(
                    'New copy mode. Saving will create a new strategy.',
                    'secondary'
                );
            }
        );


        $('seasonSelect').addEventListener(
            'change',
            changeSeason
        );

        $('raceSelect').addEventListener(
            'change',
            changeRace
        );


        $('driverSelect').addEventListener(
            'change',
            loadHistorical
        );


        $('syncBtn').addEventListener(
            'click',
            syncData
        );


        // Initial SQLite-backed page data.
        await loadCatalog();

        await loadSaved();

        await loadRuns();
    }
);