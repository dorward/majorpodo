const { filterMetaDataFactory, updateDatabase, getShowIndexFromDatabase } = require('./audio_search');
const podcast = require('podcast');
const nunjucks = require('nunjucks');
const config = require('config');

const path = config.get('path');
const http_path = config.get('httpRoot');

const filterMetaData = filterMetaDataFactory(path);

let showIndex = {};

async function updateIndex() {
	const data = await getShowIndexFromDatabase();
	showIndex = data;
}
updateIndex();

async function refreshData() {
	const data = await updateDatabase();
	updateIndex();
}
refreshData();

// TODO replace this with a file watching script
setInterval(refreshData, 60000 * 90); // Refresh every 90 minutes

async function listShows(req, res) {
	const data = await showIndex;
	const shows = Object.keys(data).sort();
	res.send(nunjucks.render('index.html', { shows }));
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

module.exports = { listShows, aboutShow, aboutShowRSS, serveDebugData, titleHomepage, episodePage };
