import path from 'node:path';
import { expect, test, vi } from 'vitest';

const { start, Bree } = vi.hoisted(() => {
    const start = vi.fn();
    const Bree = vi.fn(function (_options: unknown) {
        return { start };
    });
    return { start, Bree };
});
vi.mock('@majorpodo/configuration', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@majorpodo/configuration')>()),
    waitForDatabase: vi.fn(async () => {}),
}));
vi.mock('bree', () => ({ default: Bree }));
vi.mock('../lib/log', () => ({ log: vi.fn() }));

test('startup schedules and starts both import and deletion jobs every two hours', async () => {
    // Import the actual startup module, replacing only the worker scheduler.
    await import('../index');
    expect(Bree).toHaveBeenCalledWith({
        root: path.resolve(__dirname, '../jobs'),
        jobs: expect.arrayContaining([
            { name: 'scan-for-new', timeout: '30s', interval: '2h' },
            { name: 'scan-for-deleted', timeout: '30s', interval: '2h' },
        ]),
    });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
});
