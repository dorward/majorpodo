const { filterMetaDataFactory, getShowIndexFromDatabase } = require('./media_search');
const { updateDatabase } = require('./database');
const podcast = require('podcast');
const nunjucks = require('nunjucks');
const config = require('config');
const { logger } = require('./log');

const path = config.get('path');
const http_path = config.get('httpRoot');

const filterMetaData = filterMetaDataFactory(path);

let showIndex = {};

async function updateIndex() {
	const data = await getShowIndexFromDatabase();
	showIndex = data;
}
updateIndex();

let refreshing = false;
async function refreshData() {
	if (refreshing) {
		logger.log({
			level: 'info',
			message: 'Refresh canceled as previous refresh is still running',
		});
	}
	refreshing = true;
	logger.log({
		level: 'info',
		message: 'Refreshing database',
	});
	await updateDatabase();
	updateIndex();
	refreshing = false;
}
refreshData();

// TODO replace this with a file watching script
setInterval(refreshData, 60000 * 60 * 12); // Refresh every 12 hours

async function listShows(req, res) {
	const data = await showIndex;
	const shows = Object.entries(data).sort((a, b) => {
		const A = a[0];
		const B = b[0];
		return A < B ? -1 : A > B ? 1 : 0;
	});
	// res.send(nunjucks.render('index.html', { shows }));
	res.send(nunjucks.render('seriesList.html', { shows }));
}

async function aboutShow(req, res) {
	const data = await showIndex;
	const show = data[req.params.show];
	if (!show) {
		res.status(404).send("Sorry can't find that!");
	} else {
		res.send(nunjucks.render('show.html', { show, title: req.params.show }));
	}
}

async function refreshNow(req, res) {
	res.send(nunjucks.render('refreshNow.html', { refreshing }));
	refreshData();
}

async function titleHomepage(req, res) {
	const allData = await showIndex;
	const { title } = req.params;
	const show = allData[title];
	if (!show) {
		res.status(404).send("Sorry can't find that!");
	} else {
		res.send(nunjucks.render('titleHomepage.html', { show, title }));
	}
}

async function episodePage(req, res) {
	const allData = await showIndex;
	const { title, episode: episodeId } = req.params;
	const episode = allData[title].find(episode => episode.filename === episodeId);
	if (!episode) {
		res.status(404).send("Sorry can't find that!");
	} else {
		res.send(nunjucks.render('episode.html', { episode, title }));
	}
}

async function aboutShowRSS(req, res) {
	const data = await showIndex;
	const show = data[req.params.show];
	if (!show) {
		res.status(404).send("Sorry can't find that!");
	} else {
		let rss_data = filterMetaData(show);
		const feed = new podcast({
			title: req.params.show,
			feedUrl: http_path + encodeURIComponent(req.params.show) + '/rss',
			siteUrl: http_path + encodeURIComponent(req.params.show),
			description: 'BBC radio programs collected using get_iplayer',
			imageUrl: rss_data[0].image,
		});
		rss_data.forEach(item => feed.addItem(item));
		const xml = feed.buildXml('    ');
		res.set('Content-Type', 'application/rss+xml');
		res.send(xml);
	}
}

async function serveDebugData(req, res) {
	const data = await showIndex;
	// Images are expensive!
	Object.keys(data).forEach(key => data[key].forEach(item => (item.metadata.common.picture = 'placeholder')));
	res.set('Content-Type', 'application/json');
	res.send(JSON.stringify(data, undefined, 4));
}

module.exports = { listShows, aboutShow, aboutShowRSS, serveDebugData, titleHomepage, episodePage, refreshNow };
