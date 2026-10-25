import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { image_path_to_url } from './path_to_url';
import { IMAGE_PATH } from './constants';
import type { Image } from './types';

// Content-addressed filenames refresh client caches and leave the previous image
// intact if parsing or the database update fails. Cleanup removes obsolete copies.
export const cacheImage = async (data: Uint8Array): Promise<Image> => {
    const hash = createHash('sha256').update(data).digest('hex');
    // Deduplicate shared artwork and keep filenames bounded even for long media names.
    const filename = path.join(IMAGE_PATH, hash.slice(0, 2), `${hash}.jpeg`);
    try {
        await stat(filename);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(path.dirname(filename), { recursive: true });
        const temporary = `${filename}.${randomUUID()}.tmp.jpeg`;
        try {
            await writeFile(temporary, data);
            await rename(temporary, filename);
        } finally {
            await rm(temporary, { force: true });
        }
    }
    return { path: filename, url: image_path_to_url(filename) };
};

export const cacheManualImage = async (manualPath: string) =>
    cacheImage(await readFile(manualPath));

export const defaultImage: Image = { path: '', url: '/static/default_image.png' };
