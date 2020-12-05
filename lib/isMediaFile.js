const config = require('config');
const { logger } = require('./log');

const isMediaFile = function (configName, internal) {
	try {
		const regex = config.get(configName);
		if (regex) {
			const compiled = new RegExp(regex);
			logger.log({
				level: 'info',
				message: `Filter regular expression is ${regex}`,
			});
			return compiled;
		}
	} catch (e) {
		// Using default regex
	}
	logger.log({
		level: 'info',
		message: 'Filter regular expression is default',
	});
	return internal;
};

const isPodcastAudioFile = isMediaFile('videoRegExp', /(m4a|mp3)$/);
const isPodcastVideoFile = isMediaFile('audioRegExp', /mp4$/);

module.exports = { isPodcastAudioFile, isPodcastVideoFile };
