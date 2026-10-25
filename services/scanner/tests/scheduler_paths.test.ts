import { expect, test } from 'vitest';
import Bree from 'bree';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';

test('the compiled scheduler resolves real Bree workers beside its module, independently of cwd', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'majorpodo-scheduler-'));
    let scheduler: Bree | undefined;
    try {
        const lib = path.join(root, 'build/lib');
        const jobs = path.join(root, 'build/jobs');
        await mkdir(lib, { recursive: true });
        await mkdir(jobs);
        for (const name of ['scan-for-new', 'scan-for-deleted'])
            await writeFile(path.join(jobs, name + '.js'), '// worker fixture\n');
        const source = await readFile(
            new URL('../lib/start_scheduler.ts', import.meta.url),
            'utf8',
        );
        const compiled = transpileModule(source, {
            compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true },
        }).outputText;
        const exported = {} as { startScheduler: () => Promise<Bree> };
        // Use the real scheduler and Bree; replace only database readiness, config and logging.
        runInNewContext(compiled, {
            exports: exported,
            __dirname: lib,
            require: (name: string) => {
                if (name === 'node:path') return path;
                if (name === 'bree') return Bree;
                if (name === '@majorpodo/configuration')
                    return { waitForDatabase: async () => {} };
                if (name === './configuration') return {};
                if (name === './log') return { log: () => {} };
                throw new Error('Unexpected import: ' + name);
            },
        });
        scheduler = await exported.startScheduler();
        expect(scheduler.config.root).toBe(jobs);
        expect(
            scheduler.config.jobs.map((job) => (typeof job === 'string' ? job : job.name)),
        ).toEqual(['scan-for-new', 'scan-for-deleted']);
    } finally {
        await scheduler?.stop();
        await rm(root, { recursive: true, force: true });
    }
});
