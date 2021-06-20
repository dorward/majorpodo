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
	// Get old data
	const db = await dbPromise;

	// Get files for new data
	const [audioFiles, videoFiles] = await Promise.all([
		getMediaFiles(rootPath, isPodcastAudioFile),
		getMediaFiles(rootPath, isPodcastVideoFile),
	]);

	// TODO: purge database of files that no longer exist

	// Get meta data for all the files
	const files = [
		...audioFiles.map(path => ({ path, getMetaDataForThis: getMetaDataForMediaFilePath.bind(null, false, db) })),
		...videoFiles.map(path => ({ path, getMetaDataForThis: getMetaDataForMediaFilePath.bind(null, true, db) })),
	];
	
	// Update database with new data
	for (let i = 0; i < files.length; i++) {
		const path = files[i].path;
		const data = await files[i].getMetaDataForThis(rootPath, path);
		if (data) {
			await db.setItem(data.filename, data);
		} else {
			logger.log({ level: 'error', message: `No metadata found for ${path}` });
		}
	}
}

module.exports = { dbPromise, updateDatabase };
