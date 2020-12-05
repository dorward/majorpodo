const storage = require('node-persist');
const config = require('config');
const rootPath = config.get('path');
const { logger } = require('./log');

const { getMediaFiles } = require('./get_media_files');
const { isPodcastAudioFile, isPodcastVideoFile } = require('./isMediaFile');
const { getMetaDataForAudioFilePath } = require('./get_metadata');

const dbPath = config.get('databasePath');
const dbPromise = (async function () {
	await storage.init({ dir: dbPath });
	return storage;
})();

async function updateDatabase() {
	const audioFiles = await getMediaFiles(rootPath, isPodcastAudioFile);
	const videoFiles = await getMediaFiles(rootPath, isPodcastVideoFile);
	const files = [
		...audioFiles.map(path => ({ path, mdFunc: getMetaDataForAudioFilePath })),
		...videoFiles.map(path => ({
			path,
			mdFunc: () => {
				return undefined;
			},
		})),
	];
	// TODO purge database of files that no longer exist
	for (let i = 0; i < audioFiles.length; i++) {
		const path = audioFiles[i];
		const data = await getMetaDataForAudioFilePath(rootPath, path);
		if (data) {
			const db = await dbPromise;
			await db.setItem(data.filename, data);
		} else {
			logger.log({ level: 'error', message: `No metadata found for ${path}` });
		}
	}
}

module.exports = { dbPromise, updateDatabase };
