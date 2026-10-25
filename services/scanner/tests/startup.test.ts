import { expect, test, vi } from 'vitest';
import { startScheduler } from '../lib/start_scheduler';
import { runScan } from '../lib/run_scan';

const { ready, start, Bree, end } = vi.hoisted(() => {
    const ready = vi.fn();
    const start = vi.fn(async () => {});
    const end = vi.fn(async () => {});
    return {
        ready,
        start,
        end,
        Bree: vi.fn(function (_options: unknown) {
            return { start };
        }),
    };
});
vi.mock('@majorpodo/configuration', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@majorpodo/configuration')>()),
    waitForDatabase: ready,
}));
vi.mock('bree', () => ({ default: Bree }));
vi.mock('../lib/log', () => ({ log: vi.fn() }));
vi.mock('../lib/database/database', () => ({ default: { end } }));

test('scheduler starts only after database readiness succeeds', async () => {
    let succeed: () => void = () => {};
    ready.mockReturnValueOnce(
        new Promise<void>((resolve) => {
            succeed = resolve;
        }),
    );
    const result = startScheduler();
    expect(Bree).not.toHaveBeenCalled();
    succeed();
    await result;
    expect(start).toHaveBeenCalledOnce();
});

test('scheduler failure leaves all workers unscheduled', async () => {
    const failure = new Error('Database unavailable');
    ready.mockRejectedValueOnce(failure);
    await expect(startScheduler()).rejects.toBe(failure);
    expect(Bree).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
});

test('every worker waits for readiness again before scanning and closes its pool afterwards', async () => {
    let succeed: () => void = () => {};
    ready.mockReturnValueOnce(
        new Promise<void>((resolve) => {
            succeed = resolve;
        }),
    );
    const scan = vi.fn(async () => {});
    const result = runScan(scan);
    expect(scan).not.toHaveBeenCalled();
    succeed();
    await result;
    expect(scan).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
});

test('worker readiness failure cannot trigger metadata updates or deletion cleanup', async () => {
    const failure = new Error('Database unavailable');
    ready.mockRejectedValueOnce(failure);
    const scan = vi.fn();
    await expect(runScan(scan)).rejects.toBe(failure);
    expect(scan).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
});

test('a scan failure still closes its database pool', async () => {
    ready.mockResolvedValueOnce(undefined);
    const failure = new Error('Scan failed');
    await expect(
        runScan(async () => {
            throw failure;
        }),
    ).rejects.toBe(failure);
    expect(end).toHaveBeenCalledOnce();
});
