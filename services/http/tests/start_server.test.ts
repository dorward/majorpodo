import { expect, test, vi } from 'vitest';
import { startServer } from '../lib/start_server';
import configuration from '../lib/configuration';

const { ready, listen, createApp } = vi.hoisted(() => {
    const ready = vi.fn();
    const listen = vi.fn();
    return { ready, listen, createApp: vi.fn(() => ({ listen })) };
});
vi.mock('@majorpodo/configuration', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@majorpodo/configuration')>()),
    waitForDatabase: ready,
}));
vi.mock('../app', () => ({ createApp }));

test('HTTP does not initialise or listen before readiness succeeds', async () => {
    let succeed: () => void = () => {};
    ready.mockReturnValueOnce(
        new Promise<void>((resolve) => {
            succeed = resolve;
        }),
    );
    const started = startServer();
    expect(createApp).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    succeed();
    await started;
    expect(ready).toHaveBeenCalledWith(
        configuration.database,
        configuration.databaseStartup,
        expect.any(Object),
    );
    expect(listen).toHaveBeenCalledWith(configuration.listen, expect.any(Function));
});

test('exhausted readiness retries never expose an HTTP listener', async () => {
    const failure = new Error('Database unavailable');
    ready.mockRejectedValueOnce(failure);
    await expect(startServer()).rejects.toBe(failure);
    expect(createApp).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
});
