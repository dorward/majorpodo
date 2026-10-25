import select_shows from '../database/select_shows';
import { Request, Response } from 'express';

const listShows = async (_req: Request, res: Response) => {
    const shows = await select_shows();
    res.render('listShows.html', { shows });
};

export default listShows;
