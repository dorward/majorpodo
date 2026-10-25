import { lstat, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { log } from './log';

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

// Only extracted .jpeg files inside the cache are eligible. Never follow
// symlinks or inspect the media directory containing manually supplied artwork.
export const listCachedImages = async (root: string): Promise<string[]> => {
    root = path.resolve(root);
    let stats;
    try {
        stats = await lstat(root);
    } catch (error) {
        if (isMissing(error)) return [];
        throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Image cache is not a directory: ${root}`);
    }
    const visit = async (directory: string): Promise<string[]> => {
        const files: string[] = [];
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) files.push(...(await visit(filename)));
            else if (entry.isFile() && entry.name.endsWith('.jpeg')) files.push(filename);
        }
        return files;
    };
    return visit(root);
};

export const removeUnusedImages = async (images: string[], references: string[]) => {
    const inUse = new Set(references.map((filename) => path.resolve(filename)));
    for (const image of images) {
        if (inUse.has(path.resolve(image))) continue;
        try {
            await unlink(image);
            log(`Deleted unused cached image: ${image}`);
        } catch (error) {
            if (!isMissing(error)) throw error;
        }
    }
};
