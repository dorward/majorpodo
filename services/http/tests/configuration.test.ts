import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../app';
import { url_for_show, url_for_asset } from '../lib/urls';
import selectEpisodes from '../lib/database/select_episodes_for_show';
import selectEpisode from '../lib/database/select_episode_by_id';
import selectShows from '../lib/database/select_shows';
import { Pool } from 'pg';
import '../lib/database/database';

const { configuration } = vi.hoisted(() => ({
    configuration: {
        publicUrl: 'http://podcasts.example.test:8088',
        listen: { host: '127.0.0.1', port: 4088 },
        paths: { media: '', images: '' },
        database: {
            host: 'configured-db',
            port: 5439,
            database: 'shows',
            user: 'podcast-user',
            password: 'test-only',
        },
    },
}));
vi.mock('@majorpodo/configuration', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@majorpodo/configuration')>()),
    waitForDatabase: vi.fn(async () => {}),
}));
vi.mock('../lib/configuration', () => ({ default: configuration }));
vi.mock('../lib/database/select_episodes_for_show', () => ({ default: vi.fn() }));
vi.mock('../lib/database/select_episode_by_id', () => ({ default: vi.fn() }));
vi.mock('../lib/database/select_shows', () => ({ default: vi.fn() }));
vi.mock('pg', () => ({
    Pool: vi.fn(function (_options: unknown) {
        return {};
    }),
}));
vi.mock('../lib/log', () => ({
    log: vi.fn(),
    error: vi.fn(),
    requestLogger: (_req: unknown, _res: unknown, next: () => void) => next(),
    errorLogger: (
        error: unknown,
        _req: unknown,
        _res: unknown,
        next: (error: unknown) => void,
    ) => next(error),
}));

let directory: string;
beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'majorpodo-http-config-'));
    configuration.paths.media = path.join(directory, 'media');
    configuration.paths.images = path.join(directory, 'images');
    await mkdir(configuration.paths.media);
    await mkdir(configuration.paths.images);
    await writeFile(path.join(configuration.paths.media, 'episode.mp3'), 'audio data');
    await writeFile(path.join(configuration.paths.images, 'cover.jpeg'), 'image data');
});
afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
});

test('HTTP serves media and images from the configured roots', async () => {
    const app = createApp(fileURLToPath(new URL('..', import.meta.url)));
    await request(app).get('/media/episode.mp3').expect(200);
    await request(app).get('/images/cover.jpeg').expect(200);
});

test.each(['Episode #1', 'Episode ?x&y', '100% complete', 'literal%20name', 'Épisode'])(
    'rendered asset links serve the exact filename %s',
    async (name) => {
        const mediaName = name + '.mp4';
        const imageName = name + '.jpeg';
        await writeFile(path.join(configuration.paths.media, mediaName), 'media content');
        await writeFile(path.join(configuration.paths.images, imageName), 'image content');
        const episode = {
            id: 1,
            episode_title: 'Episode',
            series_title: 'Show',
            is_video: true,
            author: null,
            episode_description: '',
            season_num: 1,
            episode_num: 1,
            file_url: '/media/' + mediaName,
            image_url: '/images/' + imageName,
            date: new Date(),
        };
        vi.mocked(selectEpisodes).mockResolvedValue([episode]);
        vi.mocked(selectEpisode).mockResolvedValue([episode]);
        vi.mocked(selectShows).mockResolvedValue([
            {
                series_title: 'Show',
                episode_count: '1',
                is_video: '1',
                image: episode.image_url,
            },
        ]);
        const app = createApp(fileURLToPath(new URL('..', import.meta.url)));
        const media = '/media/' + encodeURIComponent(mediaName);
        const image = '/images/' + encodeURIComponent(imageName);
        for (const route of ['/', '/Show', '/Show/episode/1']) {
            const response = await request(app).get(route).expect(200);
            expect(response.text).toContain(`src="${image}"`);
            if (route !== '/') expect(response.text).toContain(`href="${media}"`);
            if (route.endsWith('/1')) {
                expect(response.text).toContain(`src="${media}"`);
                expect(response.text).toContain(`poster="${image}"`);
            }
        }
        await request(app).get(media).expect(200);
        await request(app).get(image).expect(200);
    },
);

test('feed URL helpers use the configured origin and port', () => {
    expect(url_for_show('A Show')).toBe('http://podcasts.example.test:8088/A%20Show');
    expect(url_for_asset('/images/cover.jpeg')).toBe(
        'http://podcasts.example.test:8088/images/cover.jpeg',
    );
});

test('the HTTP pool receives the configured database options', async () => {
    vi.resetModules();
    await import('../lib/database/database');
    expect(Pool).toHaveBeenCalledWith(configuration.database);
});

test('startup passes the configured interface and port to listen', async () => {
    const listen = vi.fn();
    vi.doMock('../app', () => ({ createApp: () => ({ listen }) }));
    await import('../index');
    await vi.waitFor(() =>
        expect(listen).toHaveBeenCalledWith(
            { host: '127.0.0.1', port: 4088 },
            expect.any(Function),
        ),
    );
});
