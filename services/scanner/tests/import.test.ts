import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import scan from '../lib/scan_for_new';
import importFile from '../lib/update_metadata_for_file';
import getFileList from '../lib/get_file_list';
import { HAS_MEDIA_EXTENSION } from '../lib/constants';
import * as metadataParser from 'music-metadata';
import * as filesystem from 'node:fs/promises';
import filters from '../lib/filters';
import deletionScan from '../lib/scan_for_deleted';
import ensureRefreshSchema from '../lib/database/ensure_refresh_schema';

const state = vi.hoisted(() => ({ media: '', images: '' }));
const database = await vi.hoisted(async () => {
    const { createTestDatabase } = await import('../../../tests/postgres');
    return createTestDatabase();
});
const { pool } = database;

vi.mock('music-metadata', async (importOriginal) => {
    const actual = await importOriginal<typeof import('music-metadata')>();
    return { ...actual, parseFile: vi.fn(actual.parseFile) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, readFile: vi.fn(actual.readFile), writeFile: vi.fn(actual.writeFile) };
});
vi.mock('../lib/database/database', () => ({ default: database.pool }));
vi.mock('../lib/log', () => ({ default: { log: vi.fn() }, log: vi.fn(), error: vi.fn() }));
vi.mock('../lib/filters', () => ({
    default: {
        remove: [': Series \\d+$'],
        replace: [{ expression: '^Old Show$', title: 'Renamed Show' }],
    },
}));
vi.mock('../lib/constants', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/constants')>()),
    get MEDIA_PATH() {
        return state.media;
    },
    get IMAGE_PATH() {
        return state.images;
    },
}));

// A tiny synthetic MP3: real ID3v2.3 tags followed by valid MPEG frame headers.
// The production music-metadata parser reads this fixture, not a mock.
function mp3(tags: Record<string, string>, picture?: Buffer) {
    const frames = Object.entries(tags).map(([id, value]) =>
        frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')])),
    );
    if (picture)
        frames.push(
            frame(
                'APIC',
                Buffer.concat([
                    Buffer.from([0]),
                    Buffer.from('image/jpeg\0'),
                    Buffer.from([3, 0]),
                    picture,
                ]),
            ),
        );
    const payload = Buffer.concat(frames);
    const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) header[9 - i] = (payload.length >> (7 * i)) & 0x7f;
    const audioFrame = Buffer.alloc(417);
    Buffer.from([0xff, 0xfb, 0x90, 0]).copy(audioFrame);
    return Buffer.concat([header, payload, audioFrame, audioFrame, audioFrame]);
}

function frame(id: string, data: Buffer) {
    const header = Buffer.alloc(10);
    header.write(id);
    header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
}

let directory: string;
const tags = {
    TALB: 'Old Show: Series 2',
    TIT2: 'Episode One',
    TPE1: 'The Artist',
    TPOS: '2/3',
    TRCK: '4/6',
    TDRC: '2024-02-03',
};
const artwork = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'majorpodo-import-'));
    state.media = path.join(directory, 'media') + path.sep;
    state.images = path.join(directory, 'images') + path.sep;
});

beforeEach(async () => {
    await database.reset();
    filters.replace[0].title = 'Renamed Show';
    await rm(state.media, { recursive: true, force: true });
    await rm(state.images, { recursive: true, force: true });
    await mkdir(state.media, { recursive: true });
});

afterAll(async () => {
    await pool.end();
    if (directory) await rm(directory, { recursive: true, force: true });
});

test('imports real media tags, normalises the series, and persists extracted artwork', async () => {
    const file = path.join(state.media, 'Episode One.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const row = await database.row(
        'SELECT episode.*, series_title FROM episode JOIN series ON series.id = episode.series_id',
    );
    expect(row).toMatchObject({
        series_title: 'Renamed Show',
        episode_title: 'Renamed Show: Episode One',
        author: 'The Artist',
        season_num: 2,
        episode_num: 4,
        is_video: false,
        file_path: file,
        file_url: '/media/Episode One.mp3',
        date: new Date('2024-02-03'),
    });
    expect(String(row.image_url)).toMatch(/^\/images\/[a-f0-9]{2}\/[a-f0-9]{64}\.jpeg$/);
    expect(await readFile(String(row.image_path))).toEqual(artwork);
});

test('reimporting a known file keeps one record and does not reread missing media', async () => {
    const file = path.join(state.media, 'known.mp3');
    await writeFile(file, mp3(tags));
    await importFile(file);
    const original = await database.row('SELECT * FROM episode');
    await rm(file);
    expect(await importFile(file)).toEqual(original);
    expect(await database.rows('SELECT * FROM episode')).toHaveLength(1);
    expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
});

test('missing tags use a standalone series, filename, file date, and default artwork', async () => {
    const file = path.join(state.media, 'A_lonely-episode.mp3');
    await writeFile(file, mp3({}));
    const created = (await stat(file)).birthtime;
    await importFile(file);
    const row = await database.row(
        'SELECT episode.*, series_title FROM episode JOIN series ON series.id = episode.series_id',
    );
    expect(row).toMatchObject({
        series_title: '__ Standalone Episode',
        episode_title: 'A lonely episode',
        season_num: 0,
        episode_num: 0,
        image_url: '/static/default_image.png',
        image_path: '',
    });
    expect(Math.abs((row.date as Date).getTime() - created.getTime())).toBeLessThanOrEqual(1);
});

test('manual artwork wins over embedded artwork, and stale caches do not override changed sources', async () => {
    const manual = path.join(state.media, 'manual.mp3');
    await writeFile(manual, mp3(tags, artwork));
    await writeFile(path.join(state.media, 'manual.jpg'), 'manual image');
    await importFile(manual);
    const manualRow = await database.row('SELECT * FROM episode');
    expect(String(manualRow.image_url)).toMatch(/^\/images\/[a-f0-9]{2}\/[a-f0-9]{64}\.jpeg$/);
    expect(await readFile(String(manualRow.image_path), 'utf8')).toBe('manual image');
    const cached = path.join(state.media, 'cached.mp3');
    await writeFile(cached, mp3(tags, artwork));
    await mkdir(state.images, { recursive: true });
    await writeFile(path.join(state.images, 'cached.jpeg'), 'existing cached image');
    await importFile(cached);
    expect(await readFile(path.join(state.images, 'cached.jpeg'), 'utf8')).toBe(
        'existing cached image',
    );
    expect(await database.rows('SELECT * FROM episode')).toHaveLength(2);
    expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
});

test('scans nested media, ignores other files, skips corrupt media, and tolerates repeat scans', async () => {
    await mkdir(path.join(state.media, 'nested'));
    await writeFile(path.join(state.media, 'broken.m4a'), 'not media');
    await writeFile(path.join(state.media, 'notes.txt'), 'not media');
    await writeFile(path.join(state.media, 'nested', 'one.mp3'), mp3(tags));
    await writeFile(
        path.join(state.media, 'nested', 'two.mp3'),
        mp3({ ...tags, TIT2: 'Episode Two' }),
    );
    const files = await getFileList(state.media, HAS_MEDIA_EXTENSION);
    expect(files.map((file) => path.relative(state.media, file)).sort()).toEqual([
        'broken.m4a',
        'nested/one.mp3',
        'nested/two.mp3',
    ]);
    await scan();
    await scan();
    expect(await database.rows('SELECT * FROM episode')).toHaveLength(2);
    expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
});

test('imports reuse series and the production schema prevents duplicate series', async () => {
    for (const name of ['one.mp3', 'two.mp3']) {
        const file = path.join(state.media, name);
        await writeFile(file, mp3(tags));
        await importFile(file);
    }
    expect(await database.rows('SELECT * FROM series')).toHaveLength(1);
    await expect(
        pool.query('INSERT INTO series(series_title) VALUES ($1)', ['Renamed Show']),
    ).rejects.toThrow();
});

function atom(type: string, ...contents: Buffer[]) {
    const content = Buffer.concat(contents);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(content.length + 8);
    header.write(type, 4, 'latin1');
    return Buffer.concat([header, content]);
}

test.each(['m4a', 'mp4'])(
    'imports %s metadata, renders Markdown, and classifies video',
    async (extension) => {
        const file = path.join(state.media, `episode.${extension}`);
        const tag = (name: string, text: string) =>
            atom(name, atom('data', Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(text)));
        await writeFile(
            file,
            Buffer.concat([
                atom('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42isom')),
                atom(
                    'moov',
                    atom(
                        'udta',
                        atom(
                            'meta',
                            Buffer.alloc(4),
                            atom(
                                'ilst',
                                tag('©alb', 'Old Show: Series 2'),
                                tag('©nam', 'M4A episode'),
                                tag('©lyr', '**Description**'),
                                tag('©day', '2024-02-03'),
                            ),
                        ),
                    ),
                ),
            ]),
        );
        await importFile(file);
        expect(await database.row('SELECT * FROM episode')).toMatchObject({
            episode_title: 'Renamed Show: M4A episode',
            episode_description: '<p><strong>Description</strong></p>\n',
            file_url: `/media/episode.${extension}`,
            is_video: extension === 'mp4',
        });
    },
);

test('unchanged scans skip parsing, artwork reads, per-file queries, and writes', async () => {
    for (const name of ['one.mp3', 'two.mp3'])
        await writeFile(path.join(state.media, name), mp3(tags, artwork));
    await scan();
    const original = await database.rows('SELECT * FROM episode ORDER BY id');
    const discoveries = await database.rows('SELECT * FROM media_discovery ORDER BY file_path');
    const parse = vi.mocked(metadataParser.parseFile).mockClear();
    const read = vi.mocked(filesystem.readFile).mockClear();
    const write = vi.mocked(filesystem.writeFile).mockClear();
    const connections = vi.spyOn(pool, 'connect');
    const queries = vi.spyOn(pool, 'query');
    await scan();
    expect(parse).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    // One lock session; three schema checks, one episode batch read and one discovery batch.
    // No per-file queries or updates, and existing discovery/audit times remain unchanged.
    expect(connections).toHaveBeenCalledOnce();
    expect(queries).toHaveBeenCalledTimes(5);
    expect(await database.rows('SELECT * FROM episode ORDER BY id')).toEqual(original);
    expect(await database.rows('SELECT * FROM media_discovery ORDER BY file_path')).toEqual(
        discoveries,
    );
});

test('tag edits update the existing ID, author, date, episode numbers, and series', async () => {
    const file = path.join(state.media, 'changing.mp3');
    await writeFile(file, mp3(tags));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await writeFile(
        file,
        mp3({
            ...tags,
            TALB: 'Different Show',
            TIT2: 'Updated title',
            TPE1: 'Updated artist',
            TPOS: '3',
            TRCK: '9',
            TDRC: '2025-02-05',
        }),
    );
    await scan();
    const after = await database.row('SELECT * FROM episode');
    expect(after).toMatchObject({
        id: before.id,
        episode_title: 'Different Show: Updated title',
        author: 'Updated artist',
        season_num: 3,
        episode_num: 9,
        date: new Date('2025-02-05'),
    });
    expect(after.file_signature).not.toBe(before.file_signature);
    expect(await database.rows('SELECT series_title FROM series')).toEqual([
        { series_title: 'Different Show' },
    ]);
});

test('filter changes reuse original tags without parsing media or reading artwork', async () => {
    const file = path.join(state.media, 'filters.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    filters.replace[0].title = 'New Filter Name';
    const parse = vi.mocked(metadataParser.parseFile).mockClear();
    const read = vi.mocked(filesystem.readFile).mockClear();
    await scan();
    expect(parse).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    const after = await database.row('SELECT * FROM episode');
    expect(after).toMatchObject({
        id: before.id,
        image_path: before.image_path,
        episode_title: 'New Filter Name: Episode One',
        source_metadata: before.source_metadata,
    });
    expect(after.filters_signature).not.toBe(before.filters_signature);
    expect(await database.rows('SELECT series_title FROM series')).toEqual([
        { series_title: 'New Filter Name' },
    ]);
});

test('adding, replacing, and removing manual artwork does not reparse unchanged media', async () => {
    const file = path.join(state.media, 'artwork.mp3');
    const manual = path.join(state.media, 'artwork.jpg');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const original = await database.row('SELECT * FROM episode');
    const parse = vi.mocked(metadataParser.parseFile).mockClear();
    await writeFile(manual, 'first manual image');
    await scan();
    const first = await database.row('SELECT * FROM episode');
    expect(first.id).toBe(original.id);
    expect(await readFile(String(first.image_path), 'utf8')).toBe('first manual image');
    await writeFile(manual, 'other manual image');
    await scan();
    const second = await database.row('SELECT * FROM episode');
    expect(second.image_url).not.toBe(first.image_url);
    expect(await readFile(String(second.image_path), 'utf8')).toBe('other manual image');
    // Cleanup must retain the embedded fallback even while manual artwork is active.
    await deletionScan();
    expect(await readFile(String(original.image_path))).toEqual(artwork);
    await rm(manual);
    await scan();
    expect(parse).not.toHaveBeenCalled();
    expect((await database.row('SELECT * FROM episode')).image_path).toBe(original.image_path);
    await deletionScan();
    await expect(readFile(String(first.image_path))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(String(second.image_path))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('embedded artwork replacement and removal update URLs without overwriting old artwork', async () => {
    const file = path.join(state.media, 'embedded.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    const replacement = Buffer.from('replacement artwork');
    await writeFile(file, mp3(tags, replacement));
    await importFile(file);
    const after = await database.row('SELECT * FROM episode');
    expect(after.id).toBe(before.id);
    expect(after.image_url).not.toBe(before.image_url);
    expect(await readFile(String(after.image_path))).toEqual(replacement);
    expect(await readFile(String(before.image_path))).toEqual(artwork);
    await writeFile(file, mp3(tags));
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        image_path: '',
        image_url: '/static/default_image.png',
    });
    await deletionScan();
    await expect(readFile(String(after.image_path))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('failed database refresh preserves the old metadata and artwork, then retries successfully', async () => {
    const file = path.join(state.media, 'retry.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await writeFile(file, mp3({ ...tags, TALB: 'Changed Show' }, Buffer.from('new image')));
    await pool.query(`CREATE FUNCTION reject_refresh() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'refresh failed'; END $$`);
    await pool.query(`CREATE TRIGGER reject_refresh BEFORE UPDATE ON episode
        FOR EACH ROW EXECUTE FUNCTION reject_refresh()`);
    try {
        await importFile(file);
        expect(await database.row('SELECT * FROM episode')).toEqual(before);
        expect(await readFile(String(before.image_path))).toEqual(artwork);
        expect(await database.rows('SELECT series_title FROM series')).toEqual([
            { series_title: 'Renamed Show' },
        ]);
    } finally {
        await pool.query('DROP TRIGGER reject_refresh ON episode');
        await pool.query('DROP FUNCTION reject_refresh()');
    }
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        episode_title: 'Changed Show: Episode One',
    });
});

test('legacy installations add fingerprint columns idempotently and backfill on the first scan', async () => {
    const file = path.join(state.media, 'legacy.mp3');
    await writeFile(file, mp3(tags));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await pool.query(`ALTER TABLE episode DROP COLUMN file_signature, DROP COLUMN artwork_signature,
        DROP COLUMN filters_signature, DROP COLUMN source_metadata`);
    await ensureRefreshSchema();
    await ensureRefreshSchema();
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        source_metadata: null,
    });
    await scan();
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        file_signature: expect.any(String),
        filters_signature: expect.any(String),
        source_metadata: expect.objectContaining({ album: tags.TALB }),
    });
});

test('same-size edits with a restored mtime are still detected through ctime', async () => {
    const file = path.join(state.media, 'same-size.mp3');
    await writeFile(file, mp3(tags));
    await filesystem.utimes(file, 1000000000, 1000000000);
    await importFile(file);
    const before = await stat(file);
    const id = (await database.row('SELECT * FROM episode')).id;
    await writeFile(file, mp3({ ...tags, TIT2: 'Episode Two' }));
    await filesystem.utimes(file, 1000000000, 1000000000);
    const after = await stat(file);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id,
        episode_title: 'Renamed Show: Episode Two',
    });
});

test('failed parsing keeps the previous record and retries on the next scan', async () => {
    const file = path.join(state.media, 'parse-error.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await writeFile(file, mp3({ ...tags, TIT2: 'Changed title' }));
    const parse = vi
        .mocked(metadataParser.parseFile)
        .mockClear()
        .mockRejectedValueOnce(new Error('Incomplete download'));
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toEqual(before);
    await importFile(file);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        episode_title: 'Renamed Show: Changed title',
    });
});

test('edits during parsing are retried without committing an outdated fingerprint', async () => {
    const file = path.join(state.media, 'mid-write.mp3');
    await writeFile(file, mp3(tags));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await writeFile(file, mp3({ ...tags, TIT2: 'First edit' }));
    const { parseFile } =
        await vi.importActual<typeof import('music-metadata')>('music-metadata');
    vi.mocked(metadataParser.parseFile)
        .mockClear()
        .mockImplementationOnce(async (filename, options) => {
            const parsed = await parseFile(filename, options);
            await writeFile(file, mp3({ ...tags, TIT2: 'Final edit' }));
            return parsed;
        });
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toEqual(before);
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        episode_title: 'Renamed Show: Final edit',
    });
});

test('removed tags clear old values and a missing title falls back to the filename', async () => {
    const file = path.join(state.media, 'fallback-title.mp3');
    await writeFile(file, mp3(tags));
    await importFile(file);
    const id = (await database.row('SELECT * FROM episode')).id;
    await writeFile(file, mp3({ TALB: 'New Album' }));
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id,
        episode_title: 'New Album: fallback title',
        season_num: 0,
        episode_num: 0,
        author: null,
    });
    await writeFile(file, mp3({}));
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id,
        episode_title: 'fallback title',
    });
    expect(await database.rows('SELECT series_title FROM series')).toEqual([
        { series_title: '__ Standalone Episode' },
    ]);
});

test('identical artwork is shared, and long media filenames do not produce oversized cache names', async () => {
    for (const name of ['short.mp3', 'x'.repeat(230) + '.mp3']) {
        const file = path.join(state.media, name);
        await writeFile(file, mp3(tags, artwork));
        await importFile(file);
    }
    const rows = await database.rows('SELECT * FROM episode ORDER BY id');
    expect(rows).toHaveLength(2);
    expect(rows[0].image_path).toBe(rows[1].image_path);
    expect(await readFile(String(rows[0].image_path))).toEqual(artwork);
    await rm(String(rows[0].file_path));
    await deletionScan();
    expect(await readFile(String(rows[1].image_path))).toEqual(artwork);
});

test('a failed manual image read keeps the old image and is retried', async () => {
    const file = path.join(state.media, 'manual-error.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await writeFile(path.join(state.media, 'manual-error.jpg'), 'new manual artwork');
    vi.mocked(filesystem.readFile).mockRejectedValueOnce(
        Object.assign(new Error('Cannot read artwork'), { code: 'EACCES' }),
    );
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toEqual(before);
    await importFile(file);
    const after = await database.row('SELECT * FROM episode');
    expect(after.id).toBe(before.id);
    expect(await readFile(String(after.image_path), 'utf8')).toBe('new manual artwork');
});

test('corrupt media does not replace a good record with empty metadata', async () => {
    const file = path.join(state.media, 'corrupt.mp3');
    await writeFile(file, mp3(tags, artwork));
    await importFile(file);
    const before = await database.row('SELECT * FROM episode');
    await writeFile(file, 'not an audio file');
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toEqual(before);
    await writeFile(file, mp3({ ...tags, TIT2: 'Recovered' }));
    await importFile(file);
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        episode_title: 'Renamed Show: Recovered',
    });
});

test('discovery records first observation and exact ordered alias snapshots across refreshes', async () => {
    const file = path.join(state.media, 'audit.mp3');
    await writeFile(file, mp3(tags));
    await scan();
    const first = await database.row('SELECT * FROM media_discovery');
    expect(first).toMatchObject({
        file_path: file,
        discovered_at: expect.any(Date),
        processed_at: expect.any(Date),
        original_title: 'Old Show: Series 2',
        series_title: 'Renamed Show',
        last_error: null,
        alias_rules: [
            {
                kind: 'remove',
                rule: 1,
                expression: ': Series \\d+$',
                before: 'Old Show: Series 2',
                after: 'Old Show',
            },
            {
                kind: 'replace',
                rule: 1,
                expression: '^Old Show$',
                before: 'Old Show',
                after: 'Renamed Show',
            },
        ],
    });
    filters.replace[0].title = 'Changed Alias';
    // Merely editing rules does not rewrite the historical audit.
    expect((await database.row('SELECT * FROM media_discovery')).series_title).toBe(
        'Renamed Show',
    );
    const parse = vi.mocked(metadataParser.parseFile).mockClear();
    await scan();
    const refreshed = await database.row('SELECT * FROM media_discovery');
    expect(parse).not.toHaveBeenCalled();
    expect(refreshed.discovered_at).toEqual(first.discovered_at);
    expect(refreshed.series_title).toBe('Changed Alias');
    expect(refreshed.alias_rules).toEqual([
        (first.alias_rules as unknown[])[0],
        expect.objectContaining({ before: 'Old Show', after: 'Changed Alias' }),
    ]);
    await rm(file);
    await deletionScan();
    expect(await database.rows('SELECT * FROM episode')).toEqual([]);
    expect(await database.row('SELECT * FROM media_discovery')).toEqual(refreshed);
    await writeFile(file, mp3(tags));
    await scan();
    expect((await database.row('SELECT * FROM media_discovery')).discovered_at).toEqual(
        first.discovered_at,
    );
});

test('failed imports remain discoverable and successful retry clears the error', async () => {
    const file = path.join(state.media, 'broken.mp3');
    await writeFile(file, 'not media');
    await scan();
    const failed = await database.row('SELECT * FROM media_discovery');
    expect(failed).toMatchObject({
        file_path: file,
        processed_at: null,
        alias_rules: null,
        last_error: expect.any(String),
    });
    expect(await database.rows('SELECT * FROM episode')).toEqual([]);
    await writeFile(file, mp3({}));
    await scan();
    expect(await database.row('SELECT * FROM media_discovery')).toMatchObject({
        discovered_at: failed.discovered_at,
        processed_at: expect.any(Date),
        alias_rules: [],
        last_error: null,
    });
});

test('failed refresh preserves the successful audit and existing schema upgrades are idempotent', async () => {
    const file = path.join(state.media, 'retry-audit.mp3');
    await writeFile(file, mp3(tags));
    await scan();
    const original = await database.row('SELECT * FROM media_discovery');
    await writeFile(file, 'broken replacement');
    await scan();
    expect(await database.row('SELECT * FROM media_discovery')).toEqual({
        ...original,
        last_error: expect.any(String),
    });
    await pool.query('DROP TABLE media_discovery');
    await ensureRefreshSchema();
    await ensureRefreshSchema();
    // Simulate an existing installation's pre-discovery signature. Its cached
    // source tags rebuild the audit without reparsing unchanged media.
    await writeFile(file, mp3(tags));
    await importFile(file);
    await pool.query('TRUNCATE media_discovery');
    await pool.query("UPDATE episode SET filters_signature = 'pre-discovery'");
    const parse = vi.mocked(metadataParser.parseFile).mockClear();
    await scan();
    expect(parse).not.toHaveBeenCalled();
    expect(await database.row('SELECT * FROM media_discovery')).toMatchObject({
        series_title: 'Renamed Show',
    });
});

test('missing manual cache artwork is restored without reparsing unchanged media', async () => {
    const file = path.join(state.media, 'repair-manual.mp3');
    await writeFile(file, mp3(tags));
    await writeFile(file.replace('.mp3', '.jpg'), 'manual artwork');
    await scan();
    const before = await database.row('SELECT * FROM episode');
    await rm(String(before.image_path));
    const parse = vi.mocked(metadataParser.parseFile).mockClear();
    await scan();
    expect(parse).not.toHaveBeenCalled();
    expect(await readFile(String(before.image_path), 'utf8')).toBe('manual artwork');
    expect(await database.row('SELECT * FROM episode')).toMatchObject({
        id: before.id,
        image_path: before.image_path,
    });
});

test.each([false, true])(
    'missing embedded cache artwork is repaired (manual override: %s)',
    async (manual) => {
        const file = path.join(state.media, 'repair-embedded.mp3');
        await writeFile(file, mp3(tags, artwork));
        if (manual) await writeFile(file.replace('.mp3', '.jpg'), 'manual artwork');
        await scan();
        const before = await database.row('SELECT * FROM episode');
        const embedded = (before.source_metadata as { embeddedImage: { path: string } })
            .embeddedImage.path;
        if (manual) await rm(state.images, { recursive: true });
        else await rm(embedded);
        const parse = vi.mocked(metadataParser.parseFile).mockClear();
        await scan();
        expect(parse).toHaveBeenCalledExactlyOnceWith(file);
        expect(await readFile(embedded)).toEqual(artwork);
        expect(await readFile(String(before.image_path))).toEqual(
            manual ? Buffer.from('manual artwork') : artwork,
        );
        expect(await database.row('SELECT * FROM episode')).toMatchObject({
            id: before.id,
            image_path: before.image_path,
        });
    },
);
