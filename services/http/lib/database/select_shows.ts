import type { ShowInfo } from '../types';
import { log, error } from '../log';
import pool from './database';

const text = `
    SELECT 
        series.series_title,
        COUNT(DISTINCT episode.id) AS episode_count,
        MAX(episode.image_url) AS image,
        COUNT(*) filter (WHERE is_video=true) AS is_video
    FROM series, episode
    WHERE series.id = episode.series_id
    GROUP BY series.id
    ORDER BY series.series_title ASC
`;

const select_all_shows = {
    name: 'select_all_shows',
    text,
};

const select_shows = async (): Promise<ShowInfo[]> => {
    const client = await pool.connect();
    try {
        const start = Date.now();
        const res = await client.query(select_all_shows);
        const duration = Date.now() - start;
        log(`select_shows: ${JSON.stringify({ duration, rows: res?.rows?.length })}`);
        return res.rows;
    } catch (e) {
        error(e);
        throw e;
    } finally {
        client.release();
    }
};

export default select_shows;
