import select_episodes_for_show from '../database/select_episodes_for_show';
import { Request, Response } from 'express';
import { Podcast } from 'podcast';
import {
    url_for_show,
    url_for_show_rss,
    url_for_episode,
    url_for_asset,
    legacy_episode_guid,
} from '../urls';

const listEpisodesForShowRSS = async (
    req: Request<{ series_title: string }>,
    res: Response,
) => {
    const title = req.params.series_title;
    const episode_list = await select_episodes_for_show(title);
    if (episode_list.length === 0) {
        return res.sendStatus(404);
    }
    const feed = new Podcast({
        title,
        feedUrl: url_for_show_rss(title),
        siteUrl: url_for_show(title),
        imageUrl: episode_list[0].image_url
            ? url_for_asset(episode_list[0].image_url)
            : undefined,
    });
    episode_list.forEach((episode) => {
        feed.addItem({
            title: episode.episode_title,
            description: episode.episode_description,
            url: url_for_episode(title, episode.id),
            guid: legacy_episode_guid(episode.file_url),
            author: episode.author?.trim() || undefined,
            imageUrl: episode.image_url ? url_for_asset(episode.image_url) : undefined,
            date: episode.date,
            enclosure: {
                url: url_for_asset(episode.file_url),
            },
        });
    });
    const xml = feed.buildXml();
    res.set('Content-Type', 'application/rss+xml');
    res.send(xml);
};

export default listEpisodesForShowRSS;
