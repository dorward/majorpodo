import { afterAll, beforeAll, expect, test } from 'vitest';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import filters, { loadFilters } from '../lib/filters';

let directory: string;
beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'majorpodo-config-'));
});
afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
});

const settings = `publicUrl: https://example.test
listen: { host: 127.0.0.1, port: 3000 }
paths: { media: /tmp/majorpodo-media, images: /tmp/majorpodo-images }
database: { host: database, port: 5432, database: podcasts, user: listener, password: test-password }
media: { pattern: '(mp3|m4a|mp4)$', videoPattern: 'mp4$' }
`;

const configuration = (title: string) =>
    settings +
    `filters:\n  remove: [': Series \\\\d+$']\n  replace:\n    - expression: 'Original Show'\n      title: '${title}'\n`;

test('the runtime snapshot loads the configured external file', async () => {
    const text = await readFile(
        path.join(process.env.MAJORPODO_CONFIGURATION_DIR!, 'default.yml'),
        'utf8',
    );
    expect(text).toContain('The Raj Quartet');
    expect(filters.replace).toContainEqual({
        expression: 'Paul Scott - The Raj Quartet',
        title: 'The Raj Quartet',
    });
});

test('explicit loads read edited files rather than a cached require result', async () => {
    const filename = path.join(directory, 'default.yml');
    await writeFile(filename, configuration('First Name'));
    const first = loadFilters(directory);
    await writeFile(filename, configuration('Second Name'));
    const second = loadFilters(directory);
    expect(first.replace[0].title).toBe('First Name');
    expect(second.replace[0].title).toBe('Second Name');
});

test('optional filter lists default to empty arrays', async () => {
    await writeFile(path.join(directory, 'default.yml'), 'filters: {}');
    expect(loadFilters(directory)).toEqual({ remove: [], replace: [] });
});

test.each([
    'filters: [',
    'other: value',
    'filters: { remove: not-an-array }',
    'filters: { remove: null }',
    'filters: { replace: null }',
    'filters: { remove: [123] }',
    'filters: { replace: [{ expression: 123, title: Example }] }',
    'filters: { replace: [{ expression: Example }] }',
    "filters: { remove: ['['] }",
    "filters: { replace: [{ expression: '[', title: Example }] }",
])(
    'invalid runtime configuration aborts instead of silently disabling filters: %s',
    async (text) => {
        await writeFile(path.join(directory, 'default.yml'), text);
        expect(() => loadFilters(directory)).toThrow();
    },
);

test('a missing configured file is an error', async () => {
    expect(() => loadFilters(path.join(directory, 'missing'))).toThrow();
});

const freshWorkerFilters = () =>
    new Promise<unknown>((resolve, reject) => {
        const require = createRequire(import.meta.url);
        const worker = new Worker(
            `
        const { parentPort, workerData } = require('node:worker_threads');
        require(workerData.tsnode).register({ project: workerData.project, transpileOnly: true });
        parentPort.postMessage(require(workerData.module).default);
    `,
            {
                eval: true,
                env: { ...process.env, MAJORPODO_CONFIGURATION_DIR: directory },
                workerData: {
                    tsnode: require.resolve('ts-node'),
                    project: fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
                    module: fileURLToPath(new URL('../lib/filters.ts', import.meta.url)),
                },
            },
        );
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker exited ${code}`));
        });
    });

test('successive scan workers see atomic config edits without restarting their parent process', async () => {
    const filename = path.join(directory, 'default.yml');
    await writeFile(filename, configuration('Before Edit'));
    expect(await freshWorkerFilters()).toMatchObject({ replace: [{ title: 'Before Edit' }] });
    const temporary = path.join(directory, 'edited.yml');
    await writeFile(temporary, configuration('After Edit'));
    await rename(temporary, filename);
    expect(await freshWorkerFilters()).toMatchObject({ replace: [{ title: 'After Edit' }] });
});
