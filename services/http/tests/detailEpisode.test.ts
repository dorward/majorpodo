import { beforeEach, expect, test, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { EpisodeInfo } from '../lib/types';
import detailEpisode from '../lib/routes/detailEpisode';

const { connect, query, release } = vi.hoisted(() => {
    const query =
        vi.fn<
            (
                query: { text: string },
                params: (string | number)[],
            ) => Promise<{ rows: EpisodeInfo[] }>
        >();
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    return { connect, query, release };
});

vi.mock('../lib/database/database', () => ({ default: { connect } }));
vi.mock('../lib/log', () => ({ log: vi.fn(), error: vi.fn() }));

const episode: EpisodeInfo = {
    id: 42,
    author: null,
    episode_title: 'Example',
    series_title: 'A Show & More',
    is_video: false,
    episode_description: 'An example episode',
    season_num: 1,
    episode_num: 2,
    file_url: '/media/example.mp3',
    image_url: '/images/example.jpg',
    date: new Date('2026-01-01'),
};

beforeEach(() => {
    query.mockReset();
});

async function request(episode_id: string, series_title: string) {
    const sendStatus = vi.fn();
    const render = vi.fn();
    await detailEpisode(
        { params: { episode_id, series_title } } as unknown as Request<{
            series_title: string;
            episode_id: string;
        }>,
        { sendStatus, render } as unknown as Response,
    );
    return { sendStatus, render };
}

test.each([
    '',
    '0',
    '-1',
    '1.5',
    '1e2',
    '+1',
    ' 1',
    '01',
    'abc',
    '12abc',
    '2147483648',
    '9007199254740993',
])('invalid ID %j returns 404 without querying PostgreSQL', async (id) => {
    const response = await request(id, episode.series_title);
    expect(response.sendStatus).toHaveBeenCalledWith(404);
    expect(connect).not.toHaveBeenCalled();
    expect(response.render).not.toHaveBeenCalled();
});

test('episode lookup scopes the ID to the requested series using SQL parameters', async () => {
    query.mockResolvedValue({ rows: [episode] });
    const response = await request('42', episode.series_title);
    expect(query).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
            text: expect.stringMatching(/episode\.id = \$1\s+AND\s+series\.series_title = \$2/),
        }),
        [42, episode.series_title],
    );
    expect(response.render).toHaveBeenCalledWith('detailEpisode.html', { episodes: [episode] });
    expect(response.sendStatus).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
});

test.each([episode.series_title, 'Another Show'])(
    'missing episode in series %j returns 404',
    async (title) => {
        query.mockResolvedValue({ rows: [] });
        const response = await request('42', title);
        expect(query).toHaveBeenCalledWith(expect.anything(), [42, title]);
        expect(response.sendStatus).toHaveBeenCalledWith(404);
        expect(response.render).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledOnce();
    },
);

test('maximum PostgreSQL SERIAL ID is accepted', async () => {
    query.mockResolvedValue({ rows: [] });
    await request('2147483647', episode.series_title);
    expect(query).toHaveBeenCalledWith(expect.anything(), [2147483647, episode.series_title]);
});

test('database errors reject the handler promise for Express 5 and release the connection', async () => {
    const failure = new Error('Database unavailable');
    query.mockRejectedValue(failure);
    await expect(request('42', episode.series_title)).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
});
