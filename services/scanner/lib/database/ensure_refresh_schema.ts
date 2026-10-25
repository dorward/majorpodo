import pool from './database';

// Existing installations do not rerun Docker's database init script.
const ensureRefreshSchema = async () => {
    await pool.query(`ALTER TABLE episode
    ADD COLUMN IF NOT EXISTS file_signature TEXT,
    ADD COLUMN IF NOT EXISTS artwork_signature TEXT,
    ADD COLUMN IF NOT EXISTS filters_signature TEXT,
    ADD COLUMN IF NOT EXISTS source_metadata JSONB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS media_discovery (
    file_path TEXT PRIMARY KEY,
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ,
    original_title TEXT,
    series_title TEXT,
    alias_rules JSONB,
    last_error TEXT
);`);
    await pool.query(
        `CREATE INDEX IF NOT EXISTS media_discovery_order ON media_discovery(discovered_at DESC, file_path);`,
    );
};

export default ensureRefreshSchema;
