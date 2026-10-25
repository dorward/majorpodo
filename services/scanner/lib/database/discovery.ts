import pool from './database';

// One batch per traversal; existing discovery times and successful audits are immutable here.
export const recordDiscoveredFiles = async (files: string[]) => {
    if (!files.length) return;
    await pool.query(
        `INSERT INTO media_discovery(file_path)
         SELECT file_path FROM unnest($1::text[]) AS files(file_path)
         EXCEPT SELECT file_path FROM media_discovery
         ON CONFLICT (file_path) DO NOTHING`,
        [files],
    );
};

export const recordDiscoveryFailure = (file: string, error: unknown) =>
    pool.query(
        `INSERT INTO media_discovery(file_path, last_error) VALUES ($1, $2)
         ON CONFLICT(file_path) DO UPDATE SET last_error = EXCLUDED.last_error`,
        [file, String(error)],
    );
