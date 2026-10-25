import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDeploymentConfiguration } from '@majorpodo/configuration';
import { runCompose } from '../../../packages/configuration/compose';

let project: string;
let directory: string;
beforeAll(async () => {
    project = await mkdtemp(path.join(tmpdir(), 'majorpodo-compose-'));
    directory = path.join(project, 'configuration');
    await mkdir(directory);
});
afterAll(async () => {
    if (project) await rm(project, { recursive: true, force: true });
});
const save = (value: unknown) =>
    writeFile(path.join(directory, 'default.yml'), JSON.stringify(value));

test('host data directory comes from YAML and relative paths resolve against the project', async () => {
    await save({ deployment: { postgresDataDirectory: 'custom-data/postgres' } });
    expect(loadDeploymentConfiguration(directory, project)).toEqual({
        postgresDataDirectory: path.join(project, 'custom-data/postgres'),
    });
    await save({ deployment: { postgresDataDirectory: '/srv/majorpodo/fresh-postgres' } });
    expect(loadDeploymentConfiguration(directory, project).postgresDataDirectory).toBe(
        '/srv/majorpodo/fresh-postgres',
    );
});

test('a missing optional deployment section retains the portable default', async () => {
    await save({});
    expect(loadDeploymentConfiguration(directory, project).postgresDataDirectory).toBe(
        path.join(project, 'data/postgresql'),
    );
});

test.each([null, '', '   ', 123, '/', '~/postgres'])(
    'invalid host path %j fails before Compose can run',
    async (value) => {
        await save({ deployment: { postgresDataDirectory: value } });
        const run = vi.fn<NonNullable<Parameters<typeof runCompose>[2]>>(() => ({ status: 0 }));
        expect(() => runCompose(['up'], project, run)).toThrow();
        expect(run).not.toHaveBeenCalled();
    },
);

test('each invocation rereads YAML and passes an internal value instead of maintaining .env', async () => {
    const run = vi.fn<NonNullable<Parameters<typeof runCompose>[2]>>(() => ({ status: 0 }));
    await save({ deployment: { postgresDataDirectory: '/srv/postgres-one' } });
    expect(runCompose(['config', '--quiet'], project, run)).toBe(0);
    expect(run).toHaveBeenLastCalledWith(
        'docker',
        [
            'compose',
            '--project-directory',
            project,
            '--file',
            path.join(project, 'docker-compose.yml'),
            'config',
            '--quiet',
        ],
        expect.objectContaining({
            cwd: project,
            env: expect.objectContaining({
                MAJORPODO_COMPOSE_POSTGRES_DATA_DIR: '/srv/postgres-one',
            }),
        }),
    );
    await save({ deployment: { postgresDataDirectory: '/srv/postgres-two' } });
    runCompose(['ps'], project, run);
    expect(run).toHaveBeenLastCalledWith(
        'docker',
        expect.arrayContaining(['ps']),
        expect.objectContaining({
            env: expect.objectContaining({
                MAJORPODO_COMPOSE_POSTGRES_DATA_DIR: '/srv/postgres-two',
            }),
        }),
    );
});

test('YAML takes precedence over inherited storage environment variables', async () => {
    vi.stubEnv('MAJORPODO_POSTGRES_DATA_DIR', '/obsolete/env-directory');
    vi.stubEnv('MAJORPODO_COMPOSE_POSTGRES_DATA_DIR', '/another/env-directory');
    try {
        await save({ deployment: { postgresDataDirectory: '/srv/from-yaml' } });
        const run = vi.fn<NonNullable<Parameters<typeof runCompose>[2]>>(() => ({ status: 0 }));
        runCompose(['config'], project, run);
        expect(run.mock.calls[0][2].env?.MAJORPODO_COMPOSE_POSTGRES_DATA_DIR).toBe(
            '/srv/from-yaml',
        );
    } finally {
        vi.unstubAllEnvs();
    }
});

test('no-argument invocation retains the old run.sh startup behaviour', async () => {
    await save({});
    const run = vi.fn<NonNullable<Parameters<typeof runCompose>[2]>>(() => ({ status: 0 }));
    runCompose([], project, run);
    expect(run).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['up', '--build', '--remove-orphans']),
        expect.anything(),
    );
});

test('Compose failures and missing Docker are reported to the calling shell', async () => {
    await save({});
    expect(runCompose(['config'], project, () => ({ status: 7 }))).toBe(7);
    expect(runCompose(['config'], project, () => ({ status: null }))).toBe(1);
    const failure = new Error('Docker not found');
    expect(() =>
        runCompose(['config'], project, () => ({ status: null, error: failure })),
    ).toThrow(failure);
});
