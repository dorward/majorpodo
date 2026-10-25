import { waitForDatabase } from '@majorpodo/configuration';
import configuration from './configuration';
import pool from './database/database';
import { log } from './log';

export const runScan = async (scan: () => Promise<unknown>) => {
    try {
        await waitForDatabase(configuration.database, configuration.databaseStartup, {
            onRetry: (attempt, maximum) =>
                log(`Database not ready (${attempt}/${maximum}); retrying`),
        });
        await scan();
    } finally {
        await pool.end();
    }
};
