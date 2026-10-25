import { waitForDatabase } from '@majorpodo/configuration';
import { createApp } from '../app';
import configuration from './configuration';

export const startServer = async () => {
    await waitForDatabase(configuration.database, configuration.databaseStartup, {
        onRetry: (attempt, maximum) =>
            console.warn(`Database not ready (${attempt}/${maximum}); retrying`),
    });
    const { host, port } = configuration.listen;
    return createApp().listen({ host, port }, (error?: Error) => {
        if (error) {
            console.error('HTTP server failed to listen:', error);
            process.exitCode = 1;
            return;
        }
        console.log(`Express server is listening at ${host}:${port}`);
    });
};
