import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { load, dump } from 'js-yaml';

const project = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'majorpodo-docker-smoke-'));
const composeFile = path.join(temporary, 'compose.yml');
const composeArgs = [
    'compose',
    '--project-name',
    `majorpodo-smoke-${process.pid}`,
    '--project-directory',
    project,
    '--file',
    composeFile,
];
const configuration = path.join(temporary, 'configuration');
const media = path.join(temporary, 'media');
const compose = (args, capture = false) => {
    const result = spawnSync('docker', [...composeArgs, ...args], {
        cwd: project,
        encoding: 'utf8',
        stdio: capture ? 'pipe' : 'inherit',
        timeout: 15 * 60 * 1000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
        throw new Error(
            `docker compose ${args.join(' ')} failed: ${result.stderr ?? result.status}`,
        );
    return result.stdout?.trim();
};
const sql = (text) =>
    compose(
        ['exec', '-T', 'postgres', 'psql', '-U', 'smoke', '-d', 'smoke', '-tA', '-c', text],
        true,
    );
const scan = (name) =>
    compose(['run', '--rm', '--no-deps', 'scanner', 'node', `jobs/scan-for-${name}.js`]);
const assertHttp = async (base, route, status = 200) => {
    const response = await fetch(base + route, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status, route);
    return response.text();
};
function frame(id, bytes) {
    const header = Buffer.alloc(10);
    header.write(id);
    header.writeUInt32BE(bytes.length, 4);
    return Buffer.concat([header, bytes]);
}
function mp3(album, title, picture) {
    const tags = { TALB: album, TIT2: title, TPE1: 'CI Author', TDRC: '2024-02-03' };
    const frames = Object.entries(tags).map(([id, value]) =>
        frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(value, 'latin1')])),
    );
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
    const audio = Buffer.alloc(417);
    Buffer.from([0xff, 0xfb, 0x90, 0]).copy(audio);
    return Buffer.concat([header, payload, audio, audio, audio]);
}
const firstName = 'Episode ?#% &.mp3';
const first = path.join(media, firstName);
const picture = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
let created = false;
try {
    for (const directory of [configuration, media]) await mkdir(directory);
    const settings = load(
        await readFile(path.join(project, 'configuration/sample.yml'), 'utf8'),
    );
    settings.publicUrl = 'https://majorpodo.example.com';
    settings.paths = { media: '/media-source/', images: '/artwork-cache/' };
    settings.database = {
        host: 'postgres',
        port: 5432,
        databaseFile: 'postgres-database',
        userFile: 'postgres-user',
        passwordFile: 'postgres-password',
    };
    settings.filters = {
        remove: [': Series \\d+$'],
        replace: [{ expression: '^Original Show$', title: 'CI Show' }],
    };
    await writeFile(path.join(configuration, 'default.yml'), dump(settings));
    await writeFile(path.join(configuration, 'postgres-user'), 'smoke\n');
    await writeFile(path.join(configuration, 'postgres-database'), 'smoke\n');
    await writeFile(
        path.join(configuration, 'postgres-password'),
        'disposable-smoke-password\n',
    );
    await writeFile(first, mp3('Original Show: Series 2', 'First Episode', picture));
    await writeFile(first.replace('.mp3', '.jpg'), 'manual artwork');
    await writeFile(
        path.join(media, 'other.mp3'),
        mp3('Other Show', 'Second Episode', Buffer.from([...picture, 0])),
    );
    await writeFile(path.join(media, 'broken.mp3'), 'not a valid media file');
    const production = load(await readFile(path.join(project, 'docker-compose.yml'), 'utf8'));
    const app = (service) => ({
        build: { context: project, dockerfile: `services/${service}/Dockerfile` },
        environment: { MAJORPODO_CONFIGURATION_DIR: '/configuration' },
        volumes: [
            `${configuration}:/configuration:ro`,
            `${media}:/media-source:ro`,
            'artwork:/artwork-cache',
        ],
        depends_on: { postgres: { condition: 'service_healthy' } },
    });
    // Deliberately independent of production container names, storage and host ports.
    await writeFile(
        composeFile,
        dump({
            services: {
                postgres: {
                    image: production.services['majorpodo-postgres'].image,
                    environment: {
                        POSTGRES_DB_FILE: '/configuration/postgres-database',
                        POSTGRES_USER_FILE: '/configuration/postgres-user',
                        POSTGRES_PASSWORD_FILE: '/configuration/postgres-password',
                    },
                    volumes: [
                        `${configuration}:/configuration:ro`,
                        'database:/var/lib/postgresql',
                        `${path.join(project, 'services/postgresql/docker_postgres_init.sql')}:/docker-entrypoint-initdb.d/init.sql:ro`,
                    ],
                    healthcheck: {
                        test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U smoke -d smoke'],
                        interval: '2s',
                        timeout: '3s',
                        retries: 60,
                    },
                },
                http: { ...app('http'), ports: ['127.0.0.1::3000'] },
                scanner: app('scanner'),
            },
            volumes: { database: {}, artwork: {} },
        }),
    );
    created = true;
    compose(['pull', 'postgres']);
    compose(['build', '--pull', 'http', 'scanner']);
    compose(['up', '-d', '--wait', '--wait-timeout', '180']);
    const port = compose(['port', 'http', '3000'], true);
    assert.match(port, /^127\.0\.0\.1:\d+$/);
    const base = `http://${port}`;
    // Exercise the real Bree scheduler, not just one-shot imports.
    const deadline = Date.now() + 120000;
    while (
        sql('SELECT count(*) FROM episode') !== '2' ||
        sql('SELECT count(*) FROM media_discovery WHERE last_error IS NOT NULL') !== '1'
    ) {
        if (Date.now() > deadline)
            throw new Error('Scheduled discovery/import did not complete');
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const episode = JSON.parse(
        sql(
            "SELECT row_to_json(e) FROM (SELECT id, file_url, image_path FROM episode WHERE file_path LIKE '%Episode%') e",
        ),
    );
    assert.ok((await assertHttp(base, '/')).includes('CI Show'));
    assert.ok((await assertHttp(base, '/CI%20Show')).includes('First Episode'));
    const detail = await assertHttp(base, `/CI%20Show/episode/${episode.id}`);
    assert.ok(detail.includes(`/media/${encodeURIComponent(firstName)}`));
    await assertHttp(base, `/media/${encodeURIComponent(firstName)}`);
    await assertHttp(
        base,
        '/images/' +
            path.relative('/artwork-cache', episode.image_path).split(path.sep).join('/'),
    );
    const rss = await assertHttp(base, '/CI%20Show/rss');
    assert.ok(rss.includes('CI Author'));
    assert.ok(
        rss.includes(`https://majorpodo.example.com/media/${encodeURIComponent(firstName)}`),
    );
    await assertHttp(base, '/CI%20Show/episode/invalid', 404);
    await assertHttp(base, `/Other%20Show/episode/${episode.id}`, 404);
    await assertHttp(base, '/Missing', 404);
    assert.ok((await assertHttp(base, '/_admin/')).includes('/_admin/discovery/'));
    const discovery = await assertHttp(base, '/_admin/discovery/');
    assert.ok(
        discovery.includes('Original Show: Series 2') && discovery.includes('replace rule 1'),
    );
    assert.ok(discovery.includes('broken.mp3') && discovery.includes('Latest import error'));
    const snapshot = sql(
        'SELECT json_agg(row_to_json(e) ORDER BY file_path) FROM (SELECT * FROM episode) e',
    );
    const audit = sql(
        'SELECT json_agg(row_to_json(d) ORDER BY file_path) FROM (SELECT * FROM media_discovery WHERE processed_at IS NOT NULL) d',
    );
    scan('new');
    assert.equal(
        sql(
            'SELECT json_agg(row_to_json(e) ORDER BY file_path) FROM (SELECT * FROM episode) e',
        ),
        snapshot,
    );
    assert.equal(
        sql(
            'SELECT json_agg(row_to_json(d) ORDER BY file_path) FROM (SELECT * FROM media_discovery WHERE processed_at IS NOT NULL) d',
        ),
        audit,
    );
    const cachedRoute =
        '/images/' +
        path.relative('/artwork-cache', episode.image_path).split(path.sep).join('/');
    compose([
        'exec',
        '-T',
        'scanner',
        'node',
        '-e',
        "require('node:fs').unlinkSync(process.argv[1])",
        episode.image_path,
    ]);
    scan('new');
    assert.equal(await assertHttp(base, cachedRoute), 'manual artwork');
    await writeFile(first, mp3('Original Show: Series 2', 'Updated Episode', picture));
    settings.filters.replace[0].title = 'Updated Show';
    await writeFile(path.join(configuration, 'default.yml'), dump(settings));
    scan('new');
    assert.equal(
        sql("SELECT id FROM episode WHERE episode_title LIKE '%Updated Episode'"),
        String(episode.id),
    );
    assert.ok((await assertHttp(base, '/Updated%20Show')).includes('Updated Episode'));
    await unlink(first);
    scan('deleted');
    assert.equal(sql('SELECT count(*) FROM episode'), '1');
    assert.equal(sql('SELECT count(*) FROM series'), '1');
    assert.equal(sql('SELECT count(*) FROM media_discovery'), '3');
    await assertHttp(base, cachedRoute, 404);
    assert.equal(await readFile(first.replace('.mp3', '.jpg'), 'utf8'), 'manual artwork');
    console.log(
        'Docker smoke passed: scheduled discovery, pages, RSS, aliases, errors, stable rescans, cache repair, refresh and deletion.',
    );
} catch (error) {
    if (created) {
        try {
            compose(['logs', '--no-color', '--tail', '200']);
        } catch {
            /* Preserve the original failure. */
        }
    }
    throw error;
} finally {
    if (created) {
        try {
            compose(['down', '--volumes', '--remove-orphans', '--timeout', '10']);
        } finally {
            await rm(temporary, { recursive: true, force: true });
        }
    } else await rm(temporary, { recursive: true, force: true });
}
