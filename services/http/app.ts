import express from 'express';
import nunjucks from 'nunjucks';
import path from 'node:path';
import configuration from './lib/configuration';

import { encode_asset_path } from './lib/urls';
import admin from './lib/routes/admin';
import listShows from './lib/routes/listShows';
import listEpisodesForShow from './lib/routes/listEpisodesForShow';
import listEpisodesForShowRSS from './lib/routes/listEpisodesForShowRSS';
import detailEpisode from './lib/routes/detailEpisode';
import { requestLogger, errorLogger } from './lib/log';

// Keep application setup separate from listening so the real routes can be tested.
export const createApp = (rootPath = process.cwd()) => {
    const app = express();

    const templates = nunjucks.configure(path.join(rootPath, 'views'), { autoescape: true });
    templates.addFilter('assetPath', encode_asset_path);
    app.engine('html', nunjucks.render);
    app.set('view engine', 'html');
    app.set('views', path.join(rootPath, 'views'));

    // Request logging middleware
    app.use(requestLogger);

    // Static middleware
    app.use('/static', express.static(path.join(rootPath, 'static')));
    app.use('/media/', express.static(configuration.paths.media));
    app.use('/images/', express.static(configuration.paths.images));

    // Routes
    app.use(admin);
    app.get('/', listShows);
    app.get('/:series_title', listEpisodesForShow);
    app.get('/:series_title/rss', listEpisodesForShowRSS);
    app.get('/:series_title/episode/:episode_id', detailEpisode);

    // Error logging middleware
    app.use(errorLogger);

    return app;
};
