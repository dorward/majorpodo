const md = require('markdown-it')();
const config = require('config');
const { logger } = require('./log');
const rootPath = config.get('path');
const httpRoot = config.get('httpRoot');
const httpAudioRoot = `${httpRoot}audio/`;
const getMetaData = getMetaDataFactory(rootPath);
const { dbPromise } = require('./database');
const { isPodcastAudioFile, isPodcastVideoFile } = require('./isMediaFile');
const { filters } = require('./filters');
const { getMediaFiles } = require('./get_media_files');
const { getMetaDataForAudioFilePath } = require('./get_metadata');

function getMetaDataFactory(rootPath) {
	// return function getMetaData(episodes) {
	//     const promises = episodes.map(path => getMetaDataForPath(rootPath, path));
	//     return Promise.all(promises);
	// };
	return async function getMetaData(episodes) {
		const metadata = [];
		for (let i = 0; i < episodes.length; i++) {
			const path = episodes[i];
			const data = await getMetaDataForAudioFilePath(rootPath, path);
			metadata.push(data);
		}
		return metadata;
	};
}

// This is synchronous so it doesn't need to be a promise, it is only that way so it chain in with the other ones nicely
async function removeEpisodesWithMissingMetaData(episodes) {
	return episodes.filter(episode => {
		if (!episode.metadata.common.album) {
			logger.log({
				level: 'error',
				message: `${episode.path} missing metadata`,
			});
			return false;
		}
		return true;
	});
}

async function groupByAlbum(episodes) {
	const shows = {};
	episodes.forEach(episode => {
		let show = episode.metadata.common.album;
		if (filters.remove) {
			filters.remove.forEach(filter => (show = show.replace(new RegExp(filter), '')));
		}
		if (filters.replace) {
			filters.replace.forEach(filter => {
				const r = new RegExp(filter.expression);
				if (r.test(show)) {
					logger.log({
						level: 'info',
						message: `Renaming ${show} to ${filter.title}`,
					});
					show = filter.title;
				}
			});
		}

		if (!shows[show]) {
			shows[show] = [];
		}
		logger.log({
			level: 'info',
			message: `Found an episode of ${show}`,
		});
		shows[show].push(episode);
	});

	// Now sort them
	Object.values(shows).forEach(album => album.sort(sort_rules));
	Object.values(shows).forEach(album =>
		album.forEach(episode => {
			if (episode.metadata) {
				const md = JSON.stringify({
					title: episode.title,
					disc: episode.metadata.common.disk.no,
					track: episode.metadata.common.track.no,
					top_keys: Object.keys(episode),
					metadata_keys: Object.keys(episode.metadata),
				});
				logger.log({
					level: 'info',
					message: `Metadata for episode: ${md}`,
				});
			} else {
				const data = JSON.stringify({
					episode,
					top_keys: Object.keys(episode),
					metadata_keys: Object.keys(episode.metadata),
				});
				logger.log({
					level: 'error',
					message: `No metadata for ${data}`,
				});
			}
		})
	);
	function sort_rules(a, b) {
		if (a.metadata.common.disk.no < b.metadata.common.disk.no) {
			return 1;
		}
		if (a.metadata.common.disk.no > b.metadata.common.disk.no) {
			return -1;
		}
		if (a.metadata.common.track.no < b.metadata.common.track.no) {
			return 1;
		}
		if (a.metadata.common.track.no > b.metadata.common.track.no) {
			return -1;
		}
		return 0;
	}

	return shows;
}

function filterMetaDataFactory(path) {
	return function filterMetaData(data) {
		return data.map(item => ({
			url: item.path.replace(path, httpAudioRoot),
			enclosure: {
				url: item.path.replace(path, httpAudioRoot),
				file: item.path,
			},
			date: item.metadata.common.date,
			title: `${item.metadata.common.album}: ${item.metadata.common.title}`,
			author: item.metadata.common.artist,
			description: item.metadata.description,
		}));
	};
}

async function updateShowIndex() {
	console.log('Warning updateShowIndex is deprecated');
	let files, meta, filtered, grouped;
	files = await getMediaFiles(rootPath);
	meta = await getMetaData(files);
	meta = meta.filter(element => element !== null);
	filtered = await removeEpisodesWithMissingMetaData(meta);
	grouped = await groupByAlbum(filtered);
	return grouped;
}

async function getMetaDataFromDatabase() {
	const db = await dbPromise;
	return db.values();
}

async function getShowIndexFromDatabase() {
	const meta = await getMetaDataFromDatabase();
	const filtered = await removeEpisodesWithMissingMetaData(meta);
	const grouped = await groupByAlbum(filtered);
	return grouped;
}

module.exports = {
	getAudioFiles: getMediaFiles,
	getMetaDataFactory,
	filterMetaDataFactory,
	groupByAlbum,
	removeEpisodesWithMissingMetaData,
	updateShowIndex,
	getMetaDataFromDatabase,
	getShowIndexFromDatabase,
};
