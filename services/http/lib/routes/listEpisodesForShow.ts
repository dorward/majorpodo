import select_episodes_for_show from '../database/select_episodes_for_show';
import { Request, Response } from 'express';
import { log } from '../log';

const listEpisodesForShow = async (req: Request<{ series_title: string }>, res: Response) => {
    const title = req.params.series_title;
    log(`listEpisodesForShow: ${title}`);
    const episodes = await select_episodes_for_show(title);
    log(`episodes: ${JSON.stringify(episodes)}`);
    if (episodes.length === 0) {
        log('404');
        return res.sendStatus(404);
    }
    res.render('listEpisodesForShow.html', {
        episodes,
        title,
    });
};

export default listEpisodesForShow;
