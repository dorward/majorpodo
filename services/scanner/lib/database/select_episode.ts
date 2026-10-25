import type { StoredEpisode } from '../types';
import logger from '../log';
import pool from './database';

const select_episode_query = {
    name: 'select_episode',
    text: `
        SELECT * FROM episode WHERE file_path = $1
`,
};

const select_episode = async (file_path: string) => {
    const client = await pool.connect();
    const values = [file_path];

    try {
        const res = await client.query<StoredEpisode>({ ...select_episode_query, values });
        return res.rows[0];
    } catch (e) {
        logger.log({ level: 'error', message: `Database error: ${e}` });
        throw e;
    } finally {
        client.release();
    }
};

export default select_episode;
