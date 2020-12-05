const storage = require('node-persist');
const config = require('config');

const dbPath = config.get('databasePath');
const dbPromise = (async function () {
	await storage.init({ dir: dbPath });
	return storage;
})();

module.exports = { dbPromise };
