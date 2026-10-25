import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import scan from '../lib/scan_for_deleted';

const state = vi.hoisted(() => ({ media: '', images: '' }));
const database = await vi.hoisted(async () => {
    const { createTestDatabase } = await import('../../../tests/postgres');
    return createTestDatabase();
});
vi.mock('../lib/database/database', () => ({ default: database.pool }));
vi.mock('../lib/log', () => ({ default: { log: vi.fn() }, log: vi.fn(), error: vi.fn() }));
vi.mock('../lib/constants', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/constants')>()),
    get MEDIA_PATH() {
        return state.media;
    },
    get IMAGE_PATH() {
        return state.images;
    },
}));

let directory: string;
beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'majorpodo-delete-'));
});
beforeEach(async () => {
    await database.reset();
    state.media = path.join(directory, 'media') + path.sep;
    state.images = path.join(directory, 'images') + path.sep;
    for (const root of [state.media, state.images]) {
        await rm(path.resolve(root), { recursive: true, force: true });
        await mkdir(root, { recursive: true });
    }
});
afterAll(async () => {
    await database.pool.end();
    if (directory) await rm(directory, { recursive: true, force: true });
});

async function seed(
    filename: string,
    title: string,
    live = true,
    image = path.join(state.images, filename + '.jpeg'),
) {
    const {
        rows: [series],
    } = await database.pool.query<{ id: number }>(
        `INSERT INTO series(series_title) VALUES ($1)
         ON CONFLICT(series_title) DO UPDATE SET series_title = EXCLUDED.series_title RETURNING id`,
        [title],
    );
    const file = path.join(state.media, filename);
    if (live) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, 'media');
    }
    if (image) {
        await mkdir(path.dirname(image), { recursive: true });
        await writeFile(image, 'artwork');
    }
    await database.pool.query(
        `INSERT INTO episode
        (series_id, episode_title, file_path, file_url, image_path, image_url, date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            series.id,
            filename,
            file,
            '/media/' + filename,
            image,
            '/images/' + path.basename(image),
            '2026-01-01',
        ],
    );
    return { file, image };
}

test('removes missing episodes, empty series, and orphaned cached images while preserving live data', async () => {
    const live = await seed('nested/live.mp3', 'Shared Show');
    const missing = await seed('missing.mp3', 'Shared Show', false);
    const last = await seed('last.mp4', 'Removed Show', false);
    await database.pool.query('INSERT INTO series(series_title) VALUES ($1)', [
        'Already Empty',
    ]);
    const orphan = path.join(state.images, 'old-orphan.jpeg');
    await writeFile(orphan, 'unused');
    await scan();
    expect(await database.rows('SELECT episode_title FROM episode')).toEqual([
        { episode_title: 'nested/live.mp3' },
    ]);
    expect(await database.rows('SELECT series_title FROM series')).toEqual([
        { series_title: 'Shared Show' },
    ]);
    expect(await readFile(live.file, 'utf8')).toBe('media');
    expect(await readFile(live.image, 'utf8')).toBe('artwork');
    for (const image of [missing.image, last.image, orphan])
        await expect(readFile(image)).rejects.toMatchObject({ code: 'ENOENT' });
    await scan();
    expect(await database.rows('SELECT * FROM episode')).toHaveLength(1);
});

test('shared cached artwork survives until its final referencing episode is deleted', async () => {
    const shared = path.join(state.images, 'shared.jpeg');
    const live = await seed('live.mp3', 'A Show', true, shared);
    await seed('missing.mp3', 'A Show', false, shared);
    await scan();
    expect(await readFile(shared, 'utf8')).toBe('artwork');
    await rm(live.file);
    await scan();
    expect(await database.rows('SELECT * FROM episode')).toEqual([]);
    expect(await database.rows('SELECT * FROM series')).toEqual([]);
    await expect(readFile(shared)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('manual artwork and symlinks to files or directories outside the cache are never removed', async () => {
    const manual = path.join(state.media, 'manual.jpg');
    await seed('missing.mp3', 'A Show', false, manual);
    const outside = path.join(directory, 'outside');
    await mkdir(outside, { recursive: true });
    const externalImage = path.join(outside, 'external.jpeg');
    await writeFile(externalImage, 'external artwork');
    await symlink(outside, path.join(state.images, 'linked-directory'));
    await symlink(externalImage, path.join(state.images, 'linked-file.jpeg'));
    const note = path.join(state.images, 'keep.txt');
    await writeFile(note, 'not generated artwork');
    await scan();
    expect(await readFile(manual, 'utf8')).toBe('artwork');
    expect(await readFile(externalImage, 'utf8')).toBe('external artwork');
    expect(await readFile(path.join(state.images, 'linked-file.jpeg'), 'utf8')).toBe(
        'external artwork',
    );
    expect(await readFile(note, 'utf8')).toBe('not generated artwork');
});

test('an unavailable media root aborts before deleting database records or artwork', async () => {
    const entry = await seed('one.mp3', 'A Show');
    state.media = path.join(directory, 'unavailable') + path.sep;
    await expect(scan()).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await database.rows('SELECT * FROM episode')).toHaveLength(1);
    expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
    expect(await readFile(entry.image, 'utf8')).toBe('artwork');
});

test('a failed cache traversal also aborts before changing the database', async () => {
    await seed('missing.mp3', 'A Show', false);
    await rm(state.images, { recursive: true });
    await symlink(state.media, state.images.slice(0, -1));
    await expect(scan()).rejects.toThrow('Image cache is not a directory');
    expect(await database.rows('SELECT * FROM episode')).toHaveLength(1);
    expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
});

test('an absent cache directory does not prevent stale episode and series cleanup', async () => {
    await seed('missing.mp3', 'A Show', false, '');
    await rm(state.images, { recursive: true });
    await scan();
    expect(await database.rows('SELECT * FROM episode')).toEqual([]);
    expect(await database.rows('SELECT * FROM series')).toEqual([]);
});

test('a database failure rolls back episode deletions and leaves artwork untouched', async () => {
    const entry = await seed('missing.mp3', 'A Show', false);
    await database.pool.query(`CREATE FUNCTION reject_series_deletion() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test deletion failure'; END $$`);
    await database.pool.query(`CREATE TRIGGER reject_series_deletion BEFORE DELETE ON series
        FOR EACH ROW EXECUTE FUNCTION reject_series_deletion()`);
    try {
        await expect(scan()).rejects.toThrow('test deletion failure');
        expect(await database.rows('SELECT * FROM episode')).toHaveLength(1);
        expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
        expect(await readFile(entry.image, 'utf8')).toBe('artwork');
    } finally {
        await database.pool.query('DROP TRIGGER reject_series_deletion ON series');
        await database.pool.query('DROP FUNCTION reject_series_deletion()');
    }
    // Failure must release the scanner lock so the next run can finish cleanup.
    await scan();
    expect(await database.rows('SELECT * FROM episode')).toEqual([]);
});
