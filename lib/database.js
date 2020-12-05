const storage = require('node-persist');
const config = require('config');
const rootPath = config.get('path');
const { logger } = require('./log');

const { getMediaFiles } = require('./get_media_files');
const { isPodcastAudioFile, isPodcastVideoFile } = require('./isMediaFile');
const { getMetaDataForMediaFilePath } = require('./get_metadata');

const dbPath = config.get('databasePath');
const dbPromise = (async function () {
	await storage.init({ dir: dbPath });
	return storage;
})();

async function updateDatabase() {
	const [audioFiles, videoFiles] = await Promise.all([
		getMediaFiles(rootPath, isPodcastAudioFile),
		getMediaFiles(rootPath, isPodcastVideoFile),
	]);
	console.log({ audioFiles, videoFiles });
	const files = [
		...audioFiles.map(path => ({ path, mdFunc: getMetaDataForMediaFilePath.bind(null, false) })),
		...videoFiles.map(path => ({ path, mdFunc: getMetaDataForMediaFilePath.bind(null, true) })),
	];
	// TODO: purge database of files that no longer exist
	for (let i = 0; i < files.length; i++) {
		const path = files[i].path;
		const data = await files[i].mdFunc(rootPath, path);
		if (data) {
			const db = await dbPromise;
			await db.setItem(data.filename, data);
		} else {
			logger.log({ level: 'error', message: `No metadata found for ${path}` });
		}
	}
}

module.exports = { dbPromise, updateDatabase };
