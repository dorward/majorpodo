const md = require('markdown-it')();
const config = require('config');
const { logger } = require('./log');
const mm = require('music-metadata');
const httpRoot = config.get('httpRoot');
const httpAudioRoot = `${httpRoot}audio/`;
const { handleImage } = require('./handle_image');
const path = require('path');

async function getMetaDataForMediaFilePath(isVideo, db, rootPath, absPath) {
	const filename = path.basename(absPath);
	const existing = await db.getItem(filename);
	if (existing && 'title' in existing) {
		logger.log({
			level: 'info',
			message: 'Using existing metadata for : ' + filename,
		});
		return existing;
	}
	let metadata;
	try {
		metadata = await mm.parseFile(absPath);
		delete metadata.common.picture; // This is a lot of data we don't need to persist so free up memory here
		metadata.description = md.render((metadata.common.lyrics && metadata.common.lyrics.toString()) || '');
		metadata.video = isVideo;
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

	const imageData = await handleImage(absPath, metadata);
	const url = absPath.replace(rootPath, httpAudioRoot);
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

module.exports = { getMetaDataForMediaFilePath };
