import { Client, type ClientConfig } from 'pg';

const delay = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export type DatabaseStartup = { attempts: number; intervalMs: number; timeoutMs: number };
export const defaultDatabaseStartup: DatabaseStartup = {
    attempts: 30,
    intervalMs: 1000,
    timeoutMs: 2000,
};

type Probe = {
    connect(): Promise<unknown>;
    query(sql: string): Promise<unknown>;
    end(): Promise<unknown>;
};
type Options = {
    onRetry?: (attempt: number, maximum: number) => void;
    createClient?: (configuration: ClientConfig) => Probe;
};

export const waitForDatabase = async (
    database: ClientConfig,
    startup: DatabaseStartup = defaultDatabaseStartup,
    options: Options = {},
): Promise<void> => {
    let failure: unknown;
    for (let attempt = 1; attempt <= startup.attempts; attempt++) {
        let client: Probe | undefined;
        let ready = false;
        try {
            const configuration: ClientConfig = {
                ...database,
                connectionTimeoutMillis: startup.timeoutMs,
                query_timeout: startup.timeoutMs,
                statement_timeout: startup.timeoutMs,
            };
            client = options.createClient
                ? options.createClient(configuration)
                : new Client(configuration);
            await client.connect();
            // Authenticated SQL, not just an open TCP port. Empty databases are
            // valid, but the application's required tables must already exist.
            await client.query('SELECT 1 FROM series, episode LIMIT 0');
            ready = true;
        } catch (error) {
            failure = error;
        } finally {
            if (client) {
                try {
                    await client.end();
                } catch (error) {
                    if (ready) failure = error;
                    ready = false;
                }
            }
        }
        if (ready) return;
        if (attempt < startup.attempts) {
            options.onRetry?.(attempt, startup.attempts);
            await delay(startup.intervalMs);
        }
    }
    throw new Error(`Database was not ready after ${startup.attempts} attempts`, {
        cause: failure,
    });
};
