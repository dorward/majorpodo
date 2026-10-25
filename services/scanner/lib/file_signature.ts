import { stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';

export const signature = (stats: BigIntStats) =>
    [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':');

export const fileStats = async (filename: string) => {
    try {
        const stats = await stat(filename, { bigint: true });
        if (!stats.isFile()) throw new Error(`Not a regular file: ${filename}`);
        return stats;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
};
