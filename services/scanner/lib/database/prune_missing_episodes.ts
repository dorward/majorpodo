import pool from './database';

const pruneMissingEpisodes = async (existingFiles: Set<string>) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const known = await client.query<{ id: number; file_path: string }>(
            'SELECT id, file_path FROM episode',
        );
        const missing = known.rows.filter((episode) => !existingFiles.has(episode.file_path));
        if (missing.length) {
            await client.query('DELETE FROM episode WHERE id = ANY($1::int[])', [
                missing.map((episode) => episode.id),
            ]);
        }
        await client.query(`DELETE FROM series WHERE NOT EXISTS (
            SELECT 1 FROM episode WHERE episode.series_id = series.id
        )`);
        const images = await client.query<{ image_path: string }>(
            `SELECT image_path FROM episode WHERE image_path <> ''
             UNION SELECT source_metadata->'embeddedImage'->>'path' FROM episode
             WHERE source_metadata->'embeddedImage'->>'path' IS NOT NULL`,
        );
        await client.query('COMMIT');
        return {
            deletedFiles: missing.map((episode) => episode.file_path),
            referencedImages: images.rows.map((episode) => episode.image_path),
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export default pruneMissingEpisodes;
