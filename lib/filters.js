const config = require('config');
const { logger } = require('./log');

let filters = {};
try {
	filters = config.get('filters');
	if (!(filters.remove instanceof Array)) {
		if (filters.remove) {
			const message = 'Config file error: filters.remove is not an array or is undefined';
			logger.log({ level: 'error', message });
		}
		filters.remove = [];
	}
	if (!(filters.replace instanceof Array)) {
		if (filters.replace) {
			const message = 'Config file error: filters.replace is not an array or is undefined';
			logger.log({ level: 'error', message });
		}
		filters.replace = [];
	}
} catch (e) {
	logger.log({ level: 'info', message: 'No title filters provided' });
}

module.exports = { filters };
