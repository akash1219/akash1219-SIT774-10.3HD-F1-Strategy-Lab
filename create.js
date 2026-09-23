// ---------------------------------------------------------
// SIT774 10.3HD DATABASE SETUP
// ---------------------------------------------------------
//
// This script creates or updates the complete SQLite schema.
//
// db.js uses CREATE TABLE IF NOT EXISTS and repeatable
// upserts, so running this script more than once should
// not duplicate the bootstrap catalog.
// ---------------------------------------------------------

const {
    DB_PATH,
    initSchema,
    seedBootstrapCatalog
} = require('./db');


try {

    initSchema();

    seedBootstrapCatalog();

    console.log(
        `Formula 1 World database schema ready: ${DB_PATH}`
    );

} catch (err) {

    console.error(
        'Database creation failed:',
        err.message
    );

    process.exit(1);

}