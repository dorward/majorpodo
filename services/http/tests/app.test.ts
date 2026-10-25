import { beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import winston from 'winston';
import { createApp } from '../app';
import selectShows from '../lib/database/select_shows';
import selectEpisodes from '../lib/database/select_episodes_for_show';
import selectEpisode from '../lib/database/select_episode_by_id';

vi.mock('../lib/database/select_shows', () => ({ default: vi.fn() }));
vi.mock('../lib/database/select_episodes_for_show', () => ({ default: vi.fn() }));
vi.mock('../lib/database/select_episode_by_id', () => ({ default: vi.fn() }));

const app = createApp(fileURLToPath(new URL('..', import.meta.url)));
app.set('env', 'test');
const title = 'A Show & More';
const showPath = `/${encodeURIComponent(title)}`;
const episode = {
    id: 42,
    author: 'Example Author',
    episode_title: 'An example episode',
    series_title: title,
    is_video: false,
    episode_description: '<p>Episode description</p>',
    season_num: 1,
    episode_num: 2,
    file_url: '/media/example.mp3',
    image_url: '/images/example.jpg',
    date: new Date('2026-01-01'),
};

beforeEach(() => {
    vi.spyOn(winston.transports.Console.prototype, 'log').mockImplementation(
        (_info, callback) => {
            if (typeof callback === 'function') callback();
        },
    );
    vi.mocked(selectShows).mockResolvedValue([]);
    vi.mocked(selectEpisodes).mockResolvedValue([episode]);
    vi.mocked(selectEpisode).mockResolvedValue([episode]);
});

test('renders the show index through Express and Nunjucks', async () => {
    const response = await request(app).get('/').expect(200).expect('Content-Type', /html/);
    expect(response.text).toContain('Majorpodo');
    expect(selectShows).toHaveBeenCalledOnce();
});

test('decodes the series title and renders its episodes', async () => {
    const response = await request(app).get(showPath).expect(200);
    expect(selectEpisodes).toHaveBeenCalledWith(title);
    expect(response.text).toContain(episode.episode_title);
});

test('RSS uses the series title in its feed and site URLs', async () => {
    const response = await request(app)
        .get(`${showPath}/rss`)
        .expect(200)
        .expect('Content-Type', /application\/rss\+xml/);
    expect(selectEpisodes).toHaveBeenCalledWith(title);
    expect(response.text).toContain(`https://majorpodo.example.com${showPath}/rss`);
    expect(response.text).toContain(`<link>https://majorpodo.example.com${showPath}</link>`);
    expect(response.text).not.toContain('undefined');
});

test('renders an episode with its image and scoped lookup', async () => {
    const response = await request(app).get(`${showPath}/episode/42`).expect(200);
    expect(selectEpisode).toHaveBeenCalledWith(42, title);
    expect(response.text).toContain(`<img src="${episode.image_url}"`);
});

test('invalid episode IDs return 404 without a lookup', async () => {
    await request(app).get(`${showPath}/episode/12abc`).expect(404);
    expect(selectEpisode).not.toHaveBeenCalled();
});

test('missing episodes and mismatched series return 404', async () => {
    vi.mocked(selectEpisode).mockImplementation(async (_id, series) =>
        series === title ? [episode] : [],
    );
    await request(app).get('/Another%20Show/episode/42').expect(404);
    expect(selectEpisode).toHaveBeenCalledWith(42, 'Another Show');
    vi.mocked(selectEpisode).mockResolvedValue([]);
    await request(app).get(`${showPath}/episode/99`).expect(404);
});

test.each([showPath, `${showPath}/rss`])('missing show returns 404 at %s', async (url) => {
    vi.mocked(selectEpisodes).mockResolvedValue([]);
    await request(app).get(url).expect(404);
});

test.each(['/', showPath, `${showPath}/rss`, `${showPath}/episode/42`])(
    'Express forwards database rejection at %s and returns 500',
    async (url) => {
        const failure = new Error('Database unavailable');
        vi.mocked(selectShows).mockRejectedValue(failure);
        vi.mocked(selectEpisodes).mockRejectedValue(failure);
        vi.mocked(selectEpisode).mockRejectedValue(failure);
        await request(app).get(url).expect(500);
    },
);

test('serves static assets with their Express 5 content type', async () => {
    await request(app)
        .get('/static/style.css')
        .expect(200)
        .expect('Content-Type', /text\/css/);
});

test('RSS includes author credits, episode page links, absolute artwork, and media enclosures', async () => {
    const response = await request(app).get(`${showPath}/rss`).expect(200);
    const item = response.text.match(/<item>([\s\S]*?)<\/item>/)?.[1];
    expect(item).toBeDefined();
    expect(item).toContain(`<link>https://majorpodo.example.com${showPath}/episode/42</link>`);
    expect(item).toContain('<dc:creator><![CDATA[Example Author]]></dc:creator>');
    expect(item).toContain('<itunes:author>Example Author</itunes:author>');
    expect(item).toContain(
        '<guid isPermaLink="false">https://majorpodo.example.com/media/example.mp3</guid>',
    );
    expect(item).toContain('enclosure url="https://majorpodo.example.com/media/example.mp3"');
    expect(item).toContain('type="audio/mpeg"');
    expect(item).toContain(
        '<itunes:image href="https://majorpodo.example.com/images/example.jpg"',
    );
    expect(response.text).toContain(
        '<itunes:image href="https://majorpodo.example.com/images/example.jpg"',
    );
    expect(response.text).not.toMatch(/(?:href|url)="\//);
});

test('RSS encodes special characters and literal percent escapes in asset filenames', async () => {
    vi.mocked(selectEpisodes).mockResolvedValue([
        {
            ...episode,
            file_url: '/media/Épisode %20 ?#&.mp3',
            image_url: '/images/Épisode %20 ?#&.jpg',
        },
    ]);
    const response = await request(app).get(`${showPath}/rss`).expect(200);
    expect(response.text).toContain(
        'enclosure url="https://majorpodo.example.com/media/%C3%89pisode%20%2520%20%3F%23%26.mp3"',
    );
    expect(response.text).toContain(
        '<itunes:image href="https://majorpodo.example.com/images/%C3%89pisode%20%2520%20%3F%23%26.jpg"',
    );
});

test.each([null, '', '   '])('RSS omits unavailable author credits (%j)', async (author) => {
    vi.mocked(selectEpisodes).mockResolvedValue([{ ...episode, author, image_url: '' }]);
    const response = await request(app).get(`${showPath}/rss`).expect(200);
    expect(response.text).not.toContain('<dc:creator>');
    expect(response.text).not.toContain('<itunes:author>');
    expect(response.text).not.toContain('<itunes:image');
    expect(response.text).not.toContain('undefined');
    expect(response.text).not.toContain('null');
});

test('RSS converts fallback artwork to an absolute URL', async () => {
    vi.mocked(selectEpisodes).mockResolvedValue([
        { ...episode, image_url: '/static/default_image.png' },
    ]);
    const response = await request(app).get(`${showPath}/rss`).expect(200);
    expect(response.text).toContain(
        '<itunes:image href="https://majorpodo.example.com/static/default_image.png"',
    );
});

test('show index displays show links, episode counts, artwork, and audio/video indicators', async () => {
    const shows = [
        {
            series_title: 'Audio & More',
            episode_count: '2',
            image: '/images/audio.jpg',
            is_video: '0',
        },
        {
            series_title: 'Video Show',
            episode_count: '1',
            image: '/images/video.jpg',
            is_video: '1',
        },
    ];
    vi.mocked(selectShows).mockResolvedValue(shows);
    const response = await request(app).get('/').expect(200);
    expect(response.text).toContain('href="/Audio%20%26%20More"');
    expect(response.text).toContain('Audio &amp; More');
    expect(response.text).toContain('2 episodes');
    expect(response.text).toContain('href="/Video%20Show/rss"');
    expect(response.text).toContain('src="/images/audio.jpg"');
    expect(response.text).toContain('src="/images/video.jpg"');
    // Each kind of show receives the corresponding inline icon.
    for (const name of ['headset', 'videocam']) {
        const icon = await readFile(
            new URL(`../views/icons/${name}-black-18dp.svg`, import.meta.url),
            'utf8',
        );
        expect(response.text).toContain(icon.trim());
    }
});

test('show page displays each episode, its position, artwork, and working detail links', async () => {
    vi.mocked(selectEpisodes).mockResolvedValue([
        episode,
        { ...episode, id: 43, episode_title: 'Second episode', season_num: 2, episode_num: 3 },
    ]);
    const response = await request(app).get(showPath).expect(200);
    expect(response.text).toContain(`${showPath}/episode/42`);
    expect(response.text).toContain(`${showPath}/episode/43`);
    expect(response.text).toContain('Second episode');
    expect(response.text).toContain('Season 2 Episode 3');
    expect(response.text).toContain(`href="${episode.file_url}" download`);
    expect(response.text).toContain(`src="${episode.image_url}"`);
});

test.each([false, true])(
    'episode detail uses the correct player for is_video=%s',
    async (is_video) => {
        vi.mocked(selectEpisode).mockResolvedValue([{ ...episode, is_video }]);
        const response = await request(app).get(`${showPath}/episode/42`).expect(200);
        expect(response.text).toContain(
            `<${is_video ? 'video' : 'audio'} controls src="${episode.file_url}"`,
        );
        expect(response.text).not.toContain(`<${is_video ? 'audio' : 'video'} controls`);
        expect(response.text).toContain(episode.episode_description);
        expect(response.text).toContain(`href="${episode.file_url}" download`);
        if (is_video) expect(response.text).toContain(`poster="${episode.image_url}"`);
    },
);

test('episode pages escape titles and omit missing artwork', async () => {
    vi.mocked(selectEpisode).mockResolvedValue([
        { ...episode, episode_title: '<script>alert(1)</script>', image_url: '' },
    ]);
    const response = await request(app).get(`${showPath}/episode/42`).expect(200);
    expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(response.text).not.toContain('<script>');
    expect(response.text).not.toContain('<img ');
});

test('RSS contains every episode with distinct stable identities and preserves date order', async () => {
    vi.mocked(selectEpisodes).mockResolvedValue([
        {
            ...episode,
            id: 43,
            episode_title: 'Newer episode',
            file_url: '/media/new.mp3',
            date: new Date('2026-02-01'),
        },
        episode,
    ]);
    const response = await request(app).get(`${showPath}/rss`).expect(200);
    const items = [...response.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(
        (match) => match[1],
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Newer episode');
    expect(items[0]).toContain(`${showPath}/episode/43`);
    expect(items[0]).toContain('<pubDate>Sun, 01 Feb 2026 00:00:00 GMT</pubDate>');
    expect(items[1]).toContain(episode.episode_title);
    expect(items[1]).toContain(`${showPath}/episode/42`);
    expect(items[0]).toContain('https://majorpodo.example.com/media/new.mp3</guid>');
    expect(items[1]).toContain('https://majorpodo.example.com/media/example.mp3</guid>');
});

test('unknown nested routes and malformed URL encoding return errors', async () => {
    await request(app).get('/no/such/page').expect(404);
    await request(app).get('/bad%ZZ/episode/42').expect(400);
});
