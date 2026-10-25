import { afterEach, expect, test, vi } from 'vitest';
import { waitForDatabase } from '@majorpodo/configuration';

const database = {
    host: 'configured-db',
    port: 5439,
    database: 'podcasts',
    user: 'podcast-user',
    password: 'test-secret',
};
const startup = { attempts: 3, intervalMs: 1000, timeoutMs: 2000 };
const probe = () => ({
    connect: vi.fn(async () => {}),
    query: vi.fn(async (_sql: string) => ({})),
    end: vi.fn(async () => {}),
});
afterEach(() => {
    vi.useRealTimers();
});

test('probes configured credentials, required tables, and timeouts before returning ready', async () => {
    const client = probe();
    const createClient = vi.fn(() => client);
    const onRetry = vi.fn();
    await waitForDatabase(database, startup, { createClient, onRetry });
    expect(createClient).toHaveBeenCalledWith({
        ...database,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        statement_timeout: 2000,
    });
    expect(client.query).toHaveBeenCalledWith('SELECT 1 FROM series, episode LIMIT 0');
    expect(client.end).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
});

test('retries refused connections and releases failed clients before succeeding', async () => {
    vi.useFakeTimers();
    const first = probe();
    first.connect.mockRejectedValue(new Error('Connection refused'));
    const second = probe();
    const createClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const onRetry = vi.fn();
    const result = waitForDatabase(database, startup, { createClient, onRetry });
    await vi.advanceTimersByTimeAsync(999);
    expect(createClient).toHaveBeenCalledOnce();
    expect(first.query).not.toHaveBeenCalled();
    expect(first.end).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(second.end).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(1, 3);
});

test('a reachable server with missing tables is retried rather than treated as ready', async () => {
    vi.useFakeTimers();
    const first = probe();
    first.query.mockRejectedValue(new Error('relation series does not exist'));
    const second = probe();
    const createClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const result = waitForDatabase(database, startup, { createClient });
    await vi.runAllTimersAsync();
    await result;
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(first.end).toHaveBeenCalledOnce();
    expect(second.end).toHaveBeenCalledOnce();
});

test('permanent failures stop at the configured limit with no trailing retry delay', async () => {
    vi.useFakeTimers();
    const failure = new Error('Authentication failed');
    const clients = Array.from({ length: 3 }, () => {
        const client = probe();
        client.connect.mockRejectedValue(failure);
        return client;
    });
    const createClient = vi.fn(() => clients[createClient.mock.calls.length - 1]);
    const onRetry = vi.fn();
    const result = waitForDatabase(database, startup, { createClient, onRetry });
    const assertion = expect(result).rejects.toMatchObject({
        message: 'Database was not ready after 3 attempts',
        cause: failure,
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    for (const client of clients) expect(client.end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});

test('query timeouts close their client and a later attempt can recover', async () => {
    const first = probe();
    first.query.mockRejectedValue(new Error('Query read timeout'));
    const second = probe();
    const createClient = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    await waitForDatabase(database, { ...startup, intervalMs: 0 }, { createClient });
    expect(first.end).toHaveBeenCalledOnce();
    expect(second.end).toHaveBeenCalledOnce();
});

test('constructor and cleanup errors are bounded and reported', async () => {
    const failure = new Error('Cannot construct client');
    await expect(
        waitForDatabase(
            database,
            { ...startup, attempts: 1 },
            {
                createClient: () => {
                    throw failure;
                },
            },
        ),
    ).rejects.toHaveProperty('cause', failure);
    const client = probe();
    client.end.mockRejectedValue(failure);
    await expect(
        waitForDatabase(database, { ...startup, attempts: 1 }, { createClient: () => client }),
    ).rejects.toHaveProperty('cause', failure);
});

test('the SQL probe accepts an empty application schema and rejects missing tables', async () => {
    const { createTestDatabase } = await import('../../../tests/postgres');
    const database = await createTestDatabase();
    const client = () => ({
        connect: async () => {},
        query: database.pool.query,
        end: async () => {},
    });
    try {
        await expect(
            waitForDatabase(
                {},
                { attempts: 1, intervalMs: 0, timeoutMs: 1000 },
                { createClient: client },
            ),
        ).resolves.toBeUndefined();
        await database.pool.query('DROP TABLE episode');
        await expect(
            waitForDatabase(
                {},
                { attempts: 1, intervalMs: 0, timeoutMs: 1000 },
                { createClient: client },
            ),
        ).rejects.toThrow('Database was not ready');
    } finally {
        await database.pool.end();
    }
});

test('a cleanup error does not hide the original connection failure', async () => {
    const client = probe();
    const failure = new Error('Authentication failed');
    client.connect.mockRejectedValue(failure);
    client.end.mockRejectedValue(new Error('Connection already lost'));
    await expect(
        waitForDatabase(database, { ...startup, attempts: 1 }, { createClient: () => client }),
    ).rejects.toHaveProperty('cause', failure);
});
