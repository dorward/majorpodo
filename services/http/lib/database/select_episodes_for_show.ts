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
        series.series_title = $1
    ORDER BY 
        episode.date DESC;
`;

const select_episodes = {
    name: 'select_episodes_for_show',
    text,
};

const select_episodes_for_show = async (title: string): Promise<EpisodeInfo[]> => {
    log(`select_episodes_for_show: start`);
    const client = await pool.connect();
    try {
        log(`select_episodes_for_show: got client`);
        const start = Date.now();
        log(`select_episodes_for_show: ${start}`);
        const params = [title];
        log(`select_episodes_for_show: ${title}`);
        const res = await client.query(select_episodes, params);
        const duration = Date.now() - start;
        log(`select_episodes_for_show: ${duration}`);
        log(
            `select_episodes_for_show: ${JSON.stringify({
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

export default select_episodes_for_show;
