import { expect, test, vi } from 'vitest';
import getFileList from '../lib/get_file_list';

const { walker } = await vi.hoisted(async () => {
    const { EventEmitter } = await import('node:events');
    return { walker: new EventEmitter() };
});
vi.mock('klaw', () => ({ default: () => walker }));
vi.mock('../lib/log', () => ({ default: { log: vi.fn() } }));

test('a traversal error rejects the complete scan rather than returning a partial file list', async () => {
    walker.removeAllListeners();
    const scan = getFileList('/media', /mp3$/);
    const failure = new Error('Cannot read nested media directory');
    walker.emit('data', { path: '/media/found.mp3', stats: { isFile: () => true } });
    walker.emit('error', failure);
    walker.emit('end');
    await expect(scan).rejects.toBe(failure);
});

test('directory names ending in a media extension are not returned as files', async () => {
    walker.removeAllListeners();
    const scan = getFileList('/media', /mp3$/);
    walker.emit('data', { path: '/media/directory.mp3', stats: { isFile: () => false } });
    walker.emit('data', { path: '/media/real.mp3', stats: { isFile: () => true } });
    walker.emit('end');
    await expect(scan).resolves.toEqual(['/media/real.mp3']);
});
