import path from 'node:path';
import Bree from 'bree';
import { waitForDatabase } from '@majorpodo/configuration';
import configuration from './configuration';
import { log } from './log';

export const startScheduler = async () => {
    await waitForDatabase(configuration.database, configuration.databaseStartup, {
        onRetry: (attempt, maximum) =>
            log(`Database not ready (${attempt}/${maximum}); retrying`),
    });
    const bree = new Bree({
        root: path.resolve(__dirname, '../jobs'),
        jobs: [
            { name: 'scan-for-new', timeout: '30s', interval: '2h' },
            { name: 'scan-for-deleted', timeout: '30s', interval: '2h' },
        ],
    });
    await bree.start();
    log('Bree running');
    return bree;
};
