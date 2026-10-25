import type { AliasRule, Metadata, SourceMetadata, StoredEpisode } from '../types';
import pool from './database';

const saveEpisode = async (
    ep: Metadata,
    source: SourceMetadata,
    fileSignature: string,
    artworkSignature: string | null,
    filtersSignature: string,
    previousSeries: number | undefined,
    aliasRules: AliasRule[],
): Promise<StoredEpisode> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const series = await client.query<{ id: number }>(
            `
            INSERT INTO series(series_title) VALUES ($1)
            ON CONFLICT(series_title) DO UPDATE SET series_title = EXCLUDED.series_title
            RETURNING id`,
            [ep.series_name],
        );
        const seriesId = series.rows[0].id;
        const result = await client.query<StoredEpisode>(
            `INSERT INTO episode
            (is_video, series_id, episode_title, episode_description, season_num,
             episode_num, author, file_path, file_url, image_path, image_url, date,
             file_signature, artwork_signature, filters_signature, source_metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT(file_path) DO UPDATE SET
                is_video = EXCLUDED.is_video, series_id = EXCLUDED.series_id,
                episode_title = EXCLUDED.episode_title, episode_description = EXCLUDED.episode_description,
                season_num = EXCLUDED.season_num, episode_num = EXCLUDED.episode_num,
                author = EXCLUDED.author, file_url = EXCLUDED.file_url,
                image_path = EXCLUDED.image_path, image_url = EXCLUDED.image_url, date = EXCLUDED.date,
                file_signature = EXCLUDED.file_signature, artwork_signature = EXCLUDED.artwork_signature,
                filters_signature = EXCLUDED.filters_signature, source_metadata = EXCLUDED.source_metadata
            RETURNING *`,
            [
                ep.isVideo,
                seriesId,
                ep.title,
                ep.description,
                ep.season_num,
                ep.episode_num,
                ep.author,
                ep.filepath,
                ep.url,
                ep.image.path,
                ep.image.url,
                ep.date,
                fileSignature,
                artworkSignature,
                filtersSignature,
                JSON.stringify(source),
            ],
        );
        if (previousSeries !== undefined && previousSeries !== seriesId) {
            await client.query(
                `DELETE FROM series WHERE id = $1 AND NOT EXISTS
                (SELECT 1 FROM episode WHERE series_id = $1)`,
                [previousSeries],
            );
        }
        await client.query(
            `INSERT INTO media_discovery
             (file_path, processed_at, original_title, series_title, alias_rules)
             VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4)
             ON CONFLICT(file_path) DO UPDATE SET
                processed_at = CURRENT_TIMESTAMP, original_title = EXCLUDED.original_title,
                series_title = EXCLUDED.series_title, alias_rules = EXCLUDED.alias_rules,
                last_error = NULL`,
            [ep.filepath, source.album ?? null, ep.series_name, JSON.stringify(aliasRules)],
        );
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export default saveEpisode;
