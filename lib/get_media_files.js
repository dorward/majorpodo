const klaw = require('klaw');
const { logger } = require('./log');

function getMediaFiles(path, regex) {
	return new Promise(resolve => {
		const paths = [];
		klaw(path)
			.on('data', item => {
				paths.push(item.path);
				logger.log({ level: 'info', message: `Found file: ${item.path}` });
			})
			.on('end', () => {
				const mediaFiles = paths.filter(file => regex.test(file));
				resolve(mediaFiles);
			});
	});
}

module.exports = { getMediaFiles };
