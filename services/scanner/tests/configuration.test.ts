import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfiguration } from '@majorpodo/configuration';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let directory: string;
beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'majorpodo-settings-'));
});
afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
});
const settings = () => ({
    publicUrl: 'https://podcasts.example.test:8443/',
    listen: { host: '127.0.0.1', port: 4050 },
    paths: { media: '/tmp/custom-audio', images: '/tmp/custom-images' },
    database: {
        host: 'custom-db',
        port: 5433,
        database: 'podcasts',
        user: 'listener',
        password: 'p@ss:#$word',
    },
    media: { pattern: '\\.(mp3|ogg|webm)$', videoPattern: '\\.webm$' },
    filters: { remove: [], replace: [] },
});
const save = async (value: unknown) =>
    writeFile(path.join(directory, 'default.yml'), JSON.stringify(value));

test('loads all settings and normalises paths and public origin', async () => {
    await save(settings());
    const loaded = loadConfiguration(directory);
    expect(loaded).toMatchObject({
        publicUrl: 'https://podcasts.example.test:8443',
        listen: { host: '127.0.0.1', port: 4050 },
        paths: { media: '/tmp/custom-audio/', images: '/tmp/custom-images/' },
        database: settings().database,
        media: settings().media,
    });
});

test('credential files preserve special characters and match PostgreSQL _FILE newline handling', async () => {
    await writeFile(path.join(directory, 'user'), 'user with spaces\n');
    await writeFile(path.join(directory, 'database'), 'podcasts\n');
    await writeFile(path.join(directory, 'password'), ' leading and trailing :@#$ spaces \n\n');
    const value = {
        ...settings(),
        database: {
            host: 'db',
            port: 5432,
            databaseFile: 'database',
            userFile: 'user',
            passwordFile: 'password',
        },
    };
    await save(value);
    expect(loadConfiguration(directory).database).toEqual({
        host: 'db',
        port: 5432,
        database: 'podcasts',
        user: 'user with spaces',
        password: ' leading and trailing :@#$ spaces ',
    });
});

test.each([
    ['paths', { media: '/tmp/library', images: '/tmp/library/cache' }],
    ['paths', { media: '/tmp/cache/media', images: '/tmp/cache' }],
    ['paths', { media: '/tmp/library/./media', images: '/tmp/library/media/../' }],
    ['databaseStartup', { attempts: 0 }],
    ['databaseStartup', { timeoutMs: 0 }],
    ['databaseStartup', { intervalMs: -1 }],
    ['databaseStartup', { attempts: null }],
    ['databaseStartup', { timeoutMs: 2147483648 }],
    ['publicUrl', 'javascript:alert(1)'],
    ['publicUrl', 'https://example.test/path'],
    ['publicUrl', 'https://user:secret@example.test'],
    ['publicUrl', 'https://example.test/?query=1'],
    ['listen', { host: '0.0.0.0', port: 0 }],
    ['listen', { host: '', port: 3000 }],
    ['listen', { host: '0.0.0.0', port: 65536 }],
    ['listen', { host: '0.0.0.0', port: 3000.5 }],
    ['paths', { media: 'relative', images: '/tmp/images' }],
    ['paths', { media: '/tmp/same', images: '/tmp/same/' }],
    ['database', { host: 'db', port: '5432', database: 'db', user: 'user', password: 'pw' }],
    ['database', { host: 'db', port: 5432, database: 'db', user: 'user' }],
    ['media', { pattern: '[', videoPattern: 'mp4$' }],
])('rejects invalid %s before a service starts', async (key, value) => {
    await save({ ...settings(), [key]: value });
    expect(() => loadConfiguration(directory)).toThrow();
});

test('missing credential files fail clearly without including secret contents in validation errors', async () => {
    await save({
        ...settings(),
        database: {
            host: 'db',
            port: 5432,
            database: 'db',
            user: 'user',
            passwordFile: 'absent',
        },
    });
    expect(() => loadConfiguration(directory)).toThrow();
});

const freshRuntime = () =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
        const require = createRequire(import.meta.url);
        const worker = new Worker(
            `
        const { parentPort, workerData } = require('node:worker_threads');
        require(workerData.tsnode).register({ project: workerData.project, transpileOnly: true });
        const settings = require(workerData.configuration).default;
        const constants = require(workerData.constants);
        const pool = require(workerData.database).default;
        parentPort.postMessage({ publicUrl: settings.publicUrl, listen: settings.listen,
            mediaPath: constants.MEDIA_PATH, imagePath: constants.IMAGE_PATH,
            acceptsOgg: constants.HAS_MEDIA_EXTENSION.test('episode.ogg'),
            acceptsMp3: constants.HAS_MEDIA_EXTENSION.test('episode.mp3'),
            webmIsVideo: constants.HAS_VIDEO_EXTENSION.test('episode.webm'),
            databaseHost: pool.options.host, databasePort: pool.options.port,
            databaseName: pool.options.database, databaseUser: pool.options.user });
    `,
            {
                eval: true,
                env: { ...process.env, MAJORPODO_CONFIGURATION_DIR: directory },
                workerData: {
                    tsnode: require.resolve('ts-node'),
                    project: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
                    configuration: fileURLToPath(
                        new URL('../lib/configuration.ts', import.meta.url),
                    ),
                    constants: fileURLToPath(new URL('../lib/constants.ts', import.meta.url)),
                    database: fileURLToPath(
                        new URL('../lib/database/database.ts', import.meta.url),
                    ),
                },
            },
        );
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker exited ${code}`));
        });
    });

test('fresh workers use edited origins, listeners, roots, database options, and extension patterns', async () => {
    await save(settings());
    expect(await freshRuntime()).toMatchObject({
        publicUrl: 'https://podcasts.example.test:8443',
        listen: settings().listen,
        mediaPath: '/tmp/custom-audio/',
        imagePath: '/tmp/custom-images/',
        acceptsOgg: true,
        acceptsMp3: true,
        webmIsVideo: true,
        databaseHost: 'custom-db',
        databasePort: 5433,
        databaseName: 'podcasts',
        databaseUser: 'listener',
    });
    const changed = settings();
    changed.publicUrl = 'http://localhost:4001';
    changed.listen.port = 4001;
    changed.paths.media = '/tmp/other-audio';
    changed.database.port = 5434;
    changed.media.pattern = '\\.ogg$';
    await save(changed);
    expect(await freshRuntime()).toMatchObject({
        publicUrl: 'http://localhost:4001',
        listen: { host: '127.0.0.1', port: 4001 },
        mediaPath: '/tmp/other-audio/',
        databasePort: 5434,
        acceptsOgg: true,
        acceptsMp3: false,
    });
});
