import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import selectShows from '../lib/database/select_shows';
import selectEpisodes from '../lib/database/select_episodes_for_show';
import selectEpisode from '../lib/database/select_episode_by_id';

const database = await vi.hoisted(async () => {
    const { createTestDatabase } = await import('../../../tests/postgres');
    return createTestDatabase();
});
const { pool } = database;
vi.mock('../lib/database/database', () => ({ default: database.pool }));
vi.mock('../lib/log', () => ({ log: vi.fn(), error: vi.fn() }));
beforeEach(async () => {
    await database.reset();
});
afterAll(async () => {
    await pool.end();
});

async function addEpisode(title: string, file: string, date: string, video = false) {
    let series = (await pool.query('SELECT id FROM series WHERE series_title = $1', [title]))
        .rows[0];
    if (!series)
        series = (
            await pool.query('INSERT INTO series(series_title) VALUES ($1) RETURNING id', [
                title,
            ])
        ).rows[0];
    const result = await pool.query(
        `INSERT INTO episode
        (series_id, is_video, episode_title, author, file_path, file_url, image_path, image_url, date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
            series.id,
            video,
            file,
            'The Author',
            `/files/${file}`,
            `/media/${file}`,
            '',
            '/static/default_image.png',
            date,
        ],
    );
    return result.rows[0].id as number;
}

test('episode queries return only the requested show, newest first, with RSS metadata', async () => {
    await addEpisode('Other Show', 'other.mp3', '2026-03-01');
    await addEpisode('A Show', 'older.mp3', '2026-01-01');
    const newest = await addEpisode('A Show', 'newer.mp3', '2026-02-01');
    const episodes = await selectEpisodes('A Show');
    expect(episodes.map((row) => row.episode_title)).toEqual(['newer.mp3', 'older.mp3']);
    expect(episodes[0]).toMatchObject({
        id: newest,
        author: 'The Author',
        series_title: 'A Show',
        file_url: '/media/newer.mp3',
    });
    expect(await selectEpisodes('Missing Show')).toEqual([]);
});

test('episode IDs cannot be used to read an episode through another series URL', async () => {
    const id = await addEpisode('A Show', 'one.mp3', '2026-01-01');
    expect(await selectEpisode(id, 'A Show')).toHaveLength(1);
    expect(await selectEpisode(id, 'Another Show')).toEqual([]);
    expect(await selectEpisode(id + 1, 'A Show')).toEqual([]);
});

test('show index is alphabetical, counts episodes, and excludes empty series', async () => {
    await addEpisode('Zebra', 'z.mp3', '2026-01-01');
    await addEpisode('Alpha', 'a.mp3', '2026-01-01');
    await addEpisode('Alpha', 'a.mp4', '2026-02-01', true);
    await pool.query('INSERT INTO series(series_title) VALUES ($1)', ['Empty Show']);
    const shows = await selectShows();
    expect(shows.map((show) => show.series_title)).toEqual(['Alpha', 'Zebra']);
    expect(shows[0]).toMatchObject({
        episode_count: expect.anything(),
        image: '/static/default_image.png',
    });
    expect(Number(shows[0].episode_count)).toBe(2);
    expect(Number(shows[0].is_video)).toBe(1);
});
