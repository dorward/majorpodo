const fs = require('fs');
const path = require('path');
const klaw = require('klaw');
const mm = require('music-metadata');
const md = require('markdown-it')();
const config = require('config');
const { logger } = require('./log');
const rootPath = config.get('path');
const imagePath = config.get('imagePath');
const httpRoot = config.get('httpRoot');
const httpAudioRoot = `${httpRoot}audio/`;
const getMetaData = getMetaDataFactory(rootPath);
const { dbPromise } = require('./database');
const { isPodcastAudioFile, isPodcastVideoFile } = require('./isMediaFile');
const { filters } = require('./filters');

function getAudioFiles(path) {
	return new Promise(resolve => {
		const paths = [];
		klaw(path)
			.on('data', item => {
				paths.push(item.path);
				logger.log({ level: 'info', message: `Found file: ${item.path}` });
			})
			.on('end', () => {
				const m4as = paths.filter(file => isPodcastAudioFile.test(file));
				resolve(m4as);
			});
	});
}

async function getMetaDataForPath(rootPath, absPath) {
	let metadata;
	try {
		metadata = await mm.parseFile(absPath);
	} catch (error) {
		logger.log({
			level: 'error',
			message: 'Error parsing file: ' + JSON.stringify({ absPath, error }),
		});
		return null;
	}
	logger.log({
		level: 'info',
		message: `Getting meta data for ${absPath}`,
	});
	const url = absPath.replace(rootPath, httpAudioRoot);
	const imageData = await handleImage(absPath, metadata);
	metadata.description = md.render((metadata.common.lyrics && metadata.common.lyrics.toString()) || '');
	delete metadata.common.picture; // This is a lot of data we don't need to persist
	// TODO: Fix this path
	const filename = path.basename(absPath);
	const data = {
		url,
		path: absPath,
		filename,
		metadata,
		title: `${metadata.common.album}: ${metadata.common.title}`,
		image: imageData.url,
	};
	return data;
}

async function handleImage(absPath, metadata) {
	// Determine if we have an manually selected image file already
	const manualFile = absPath.replace(/\.[0-9a-zA-Z]{3,4}$/, '.jpg');
	if (fs.existsSync(manualFile)) {
		const url = manualFile.replace(rootPath, `${httpRoot}audio/`);
		const image = { path: manualFile, url };
		logger.log({
			level: 'info',
			message: `Using manual image for audio file ${absPath}`,
			image,
		});
		return image;
	}

	// If not, determine if we have a cached image file already
	const absImageUrl = absPath.replace(/\.[^.]*$/, '.jpeg').replace(rootPath, `${httpRoot}images/`);
	const absImagePath = absPath.replace(/\.[^.]*$/, '.jpeg').replace(rootPath, imagePath);
	const baseDir = path.dirname(absImagePath);
	logger.log({
		level: 'info',
		message: `Searching for image ${absImagePath} for audio file ${absPath}`,
	});

	if (fs.existsSync(absImagePath)) {
		const image = { path: absImagePath, url: absImageUrl };
		logger.log({
			level: 'info',
			message: `Using pre-cached image  for audio file ${absPath}`,
			image,
		});
		return image;
	}

	// If not, generate a cached image file and use that
	if (metadata.common.picture) {
		// image = "data:image/jpeg;base64," + metadata.common.picture[0].data.toString("base64");
		const image = { path: absImagePath, url: absImageUrl };
		logger.log({
			level: 'info',
			message: `Writing image for audio file ${absPath}`,
			image,
		});
		await new Promise(res => fs.mkdir(baseDir, { recursive: true }, res));
		if (!fs.existsSync(absImagePath)) {
			/* await */ new Promise(res => fs.writeFile(absImagePath, metadata.common.picture[0].data, res));
		}
		return image;
	}
	return { path: '', url: '' };
}

function getMetaDataFactory(rootPath) {
	// return function getMetaData(episodes) {
	//     const promises = episodes.map(path => getMetaDataForPath(rootPath, path));
	//     return Promise.all(promises);
	// };
	return async function getMetaData(episodes) {
		const metadata = [];
		for (let i = 0; i < episodes.length; i++) {
			const path = episodes[i];
			const data = await getMetaDataForPath(rootPath, path);
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
	files = await getAudioFiles(rootPath);
	meta = await getMetaData(files);
	meta = meta.filter(element => element !== null);
	filtered = await removeEpisodesWithMissingMetaData(meta);
	grouped = await groupByAlbum(filtered);
	return grouped;
}

async function updateDatabase() {
	const files = await getAudioFiles(rootPath);
	// TODO purge database of files that no longer exist
	for (let i = 0; i < files.length; i++) {
		const path = files[i];
		const data = await getMetaDataForPath(rootPath, path);
		if (data) {
			const db = await dbPromise;
			await db.setItem(data.filename, data);
		} else {
			logger.log({ level: 'error', message: `No metadata found for ${path}` });
		}
	}
}

async function getMetaDataFromDatabase() {
	const db = await dbPromise;
	return db.values();
}

async function getShowIndexFromDatabase() {
	const meta = await getMetaDataFromDatabase();
	filtered = await removeEpisodesWithMissingMetaData(meta);
	grouped = await groupByAlbum(filtered);
	return grouped;
}

module.exports = {
	getAudioFiles,
	getMetaDataFactory,
	filterMetaDataFactory,
	groupByAlbum,
	removeEpisodesWithMissingMetaData,
	updateShowIndex,
	updateDatabase,
	getMetaDataFromDatabase,
	getShowIndexFromDatabase,
};