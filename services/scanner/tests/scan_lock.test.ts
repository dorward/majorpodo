import { expect, test, vi } from 'vitest';
import withScanLock from '../lib/with_scan_lock';

const { client, connect } = vi.hoisted(() => {
    const client = { query: vi.fn(), release: vi.fn() };
    return { client, connect: vi.fn(async () => client) };
});
vi.mock('../lib/database/database', () => ({ default: { connect } }));

test('work waits for the scanner lock and always unlocks and releases its connection', async () => {
    let grant: () => void = () => {};
    client.query.mockImplementationOnce(
        () =>
            new Promise<void>((resolve) => {
                grant = resolve;
            }),
    );
    const work = vi.fn(async () => 'completed');
    const result = withScanLock(work);
    await vi.waitFor(() => expect(client.query).toHaveBeenCalledOnce());
    expect(work).not.toHaveBeenCalled();
    grant();
    await expect(result).resolves.toBe('completed');
    const lock = client.query.mock.calls[0][1];
    expect(client.query).toHaveBeenNthCalledWith(1, 'SELECT pg_advisory_lock($1)', lock);
    expect(client.query).toHaveBeenNthCalledWith(2, 'SELECT pg_advisory_unlock($1)', lock);
    expect(client.release).toHaveBeenCalledOnce();
});

test('a failed scan releases its lock so subsequent imports or cleanup can run', async () => {
    const failure = new Error('Scan failed');
    client.query.mockResolvedValue(undefined);
    await expect(
        withScanLock(async () => {
            throw failure;
        }),
    ).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_unlock($1)',
        expect.any(Array),
    );
    expect(client.release).toHaveBeenCalledOnce();
});

test('a failed lock acquisition releases the connection without running any scan', async () => {
    const failure = new Error('Database unavailable');
    client.query.mockRejectedValueOnce(failure);
    const work = vi.fn();
    await expect(withScanLock(work)).rejects.toBe(failure);
    expect(work).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
});

test('an unlock error discards the connection so a session lock cannot leak', async () => {
    const failure = new Error('Connection lost');
    client.query.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    await expect(withScanLock(async () => {})).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
});

test('preserves the scan error when unlocking also fails', async () => {
    const scanFailure = new Error('Scan failed');
    client.query
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Unlock failed'));
    await expect(
        withScanLock(async () => {
            throw scanFailure;
        }),
    ).rejects.toBe(scanFailure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
});
