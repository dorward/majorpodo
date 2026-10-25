import select_episode from '../database/select_episode_by_id';
import { Request, Response } from 'express';

const detailEpisode = async (
    req: Request<{ series_title: string; episode_id: string }>,
    res: Response,
) => {
    const { episode_id, series_title } = req.params;
    // PostgreSQL SERIAL IDs are positive signed 32-bit integers.
    if (!/^[1-9]\d*$/.test(episode_id)) {
        return res.sendStatus(404);
    }
    const id = Number(episode_id);
    if (!Number.isSafeInteger(id) || id > 2147483647) {
        return res.sendStatus(404);
    }
    const episodes = await select_episode(id, series_title);
    if (episodes.length === 0) {
        return res.sendStatus(404);
    }
    res.render('detailEpisode.html', { episodes });
};

export default detailEpisode;
