const fs = require('fs');
const config = require('config');
const rootPath = config.get('path');
const httpRoot = config.get('httpRoot');
const { logger } = require('./log');
const path = require('path');
const imagePath = config.get('imagePath');

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

module.exports = { handleImage };
