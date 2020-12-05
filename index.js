const config = require('config');
const express = require('express');
const serveStatic = require('serve-static');
const nunjucks = require('nunjucks');
const { httplogger, logger } = require('./lib/log');
// eslint-disable-next-line no-unused-vars
const { listShows, aboutShow, aboutShowRSS, serveDebugData, titleHomepage, episodePage } = require('./lib/routes');
const path = config.get('path');
const imagePath = config.get('imagePath');
const auth = require('./lib/auth');

nunjucks.configure('views', { autoescape: true });

const app = express();

app.use(httplogger);
if (auth) {
	app.use(auth);
}

app.get('/', listShows);
// app.get("/json", serveDebugData);
app.use('/audio', serveStatic(path));
app.use('/static', serveStatic('static'));
app.use('/images', serveStatic(imagePath));
app.get('/:show', aboutShow);
app.get('/:show/rss', aboutShowRSS);
app.get('/title/:title', titleHomepage);
app.get('/title/:title/episode/:episode', episodePage);

app.listen(config.get('listen'), () => logger.log({ level: 'info', message: 'Majorpodo server now listening' }));
