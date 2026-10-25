import type { EpisodeInfo } from '../types';
import { log, error } from '../log';
import pool from './database';

const text = `
    SELECT 
        episode.id, is_video, episode_title, episode_description, author, season_num,
        episode_num, file_url, image_url, series_title, date
    FROM 
        episode, series
    WHERE 
        episode.series_id = series.id
    AND
        episode.id = $1
    AND
        series.series_title = $2
    ;
`;

const select_episodes = {
    name: 'select_episodes_by_id',
    text,
};

const select_episodes_by_id = async (
    episode_id: number,
    series_title: string,
): Promise<EpisodeInfo[]> => {
    const client = await pool.connect();
    try {
        const params = [episode_id, series_title];
        const start = Date.now();
        const res = await client.query(select_episodes, params);
        const duration = Date.now() - start;
        log(
            `select_episodes_by_id: ${JSON.stringify({
                duration,
                params,
                rows: res?.rows?.length,
            })}`,
        );
        return res.rows;
    } catch (e) {
        error(e);
        throw e;
    } finally {
        client.release();
    }
};

export default select_episodes_by_id;
