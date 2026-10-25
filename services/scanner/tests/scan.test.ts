import { expect, test, vi } from 'vitest';
import scan from '../lib/scan_for_new';
import getFileList from '../lib/get_file_list';
import importFile from '../lib/update_metadata_for_file';
import { error } from '../lib/log';

vi.mock('../lib/with_scan_lock', () => ({ default: (work: () => Promise<void>) => work() }));
vi.mock('../lib/get_file_list', () => ({ default: vi.fn() }));
vi.mock('../lib/update_metadata_for_file', () => ({
    default: vi.fn(),
    filtersSignature: () => 'filters',
}));
vi.mock('../lib/database/ensure_refresh_schema', () => ({ default: vi.fn() }));
vi.mock('../lib/database/database', () => ({
    default: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock('../lib/log', () => ({ log: vi.fn(), error: vi.fn() }));

test('an import failure is reported and the remaining files are still processed', async () => {
    const failure = new Error('Database insert failed');
    vi.mocked(getFileList).mockResolvedValue(['broken.mp3', 'good.mp3']);
    vi.mocked(importFile).mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    await scan();
    expect(error).toHaveBeenCalledWith(failure);
    expect(importFile).toHaveBeenNthCalledWith(1, 'broken.mp3', {
        existing: null,
        filtersSignature: 'filters',
    });
    expect(importFile).toHaveBeenNthCalledWith(2, 'good.mp3', {
        existing: null,
        filtersSignature: 'filters',
    });
});

test('an empty media directory completes without importing anything', async () => {
    vi.mocked(getFileList).mockResolvedValue([]);
    await scan();
    expect(importFile).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
});
