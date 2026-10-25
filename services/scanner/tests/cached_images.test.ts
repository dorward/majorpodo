import { expect, test, vi } from 'vitest';
import { removeUnusedImages } from '../lib/cached_images';

const { unlink } = vi.hoisted(() => ({ unlink: vi.fn<(filename: string) => Promise<void>>() }));
vi.mock('node:fs/promises', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs/promises')>()),
    unlink,
}));
vi.mock('../lib/log', () => ({ log: vi.fn() }));

test('an image already removed by another process does not stop remaining cleanup', async () => {
    unlink
        .mockRejectedValueOnce(Object.assign(new Error('Gone'), { code: 'ENOENT' }))
        .mockResolvedValueOnce(undefined);
    await removeUnusedImages(['/cache/gone.jpeg', '/cache/orphan.jpeg'], []);
    expect(unlink).toHaveBeenCalledTimes(2);
});

test('failed image removal is reported and can be retried by the next scan', async () => {
    const failure = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
    unlink.mockRejectedValueOnce(failure);
    await expect(removeUnusedImages(['/cache/orphan.jpeg'], [])).rejects.toBe(failure);
    unlink.mockResolvedValueOnce(undefined);
    await expect(removeUnusedImages(['/cache/orphan.jpeg'], [])).resolves.toBeUndefined();
    expect(unlink).toHaveBeenCalledTimes(2);
});
