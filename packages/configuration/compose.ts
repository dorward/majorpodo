#!/usr/bin/env node
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import path from 'node:path';
import { loadDeploymentConfiguration } from './index';

type Run = (
    command: string,
    args: string[],
    options: SpawnSyncOptions,
) => { status: number | null; error?: Error };

export const runCompose = (
    args: string[],
    projectDirectory = process.cwd(),
    run: Run = spawnSync,
): number => {
    const project = path.resolve(projectDirectory);
    const settings = loadDeploymentConfiguration(path.join(project, 'configuration'), project);
    const result = run(
        'docker',
        [
            'compose',
            '--project-directory',
            project,
            '--file',
            path.join(project, 'docker-compose.yml'),
            ...(args.length ? args : ['up', '--build', '--remove-orphans']),
        ],
        {
            cwd: project,
            stdio: 'inherit',
            // YAML wins over any obsolete shell/.env setting. This is an internal
            // handoff to Compose, not a second user-maintained source of configuration.
            env: {
                ...process.env,
                MAJORPODO_COMPOSE_POSTGRES_DATA_DIR: settings.postgresDataDirectory,
            },
        },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
};

if (require.main === module) {
    try {
        process.exitCode = runCompose(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
