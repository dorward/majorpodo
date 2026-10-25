import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const project = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'majorpodo-package-check-'));
const run = (command, args, cwd = project) =>
    execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
    const archive = path.join(temporary, 'majorpodo.tar.gz');
    run(process.execPath, ['scripts/package.mjs', archive]);
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
        .trim()
        .split('\n');
    assert.ok(
        entries.every(
            (name) => name.startsWith('majorpodo/') && !name.split('/').includes('..'),
        ),
    );
    assert.ok(
        !entries.some((name) =>
            /(^|\/)(node_modules|build|\.git|edited|dist|postgres-password|\.env)(\/|$)/.test(
                name,
            ),
        ),
    );
    run('tar', ['-xzf', archive, '-C', temporary]);
    const root = path.join(temporary, 'majorpodo');
    assert.equal(
        await readFile(path.join(root, 'configuration/default.yml'), 'utf8'),
        await readFile(path.join(project, 'configuration/sample.yml'), 'utf8'),
    );
    assert.ok((await stat(path.join(root, 'run.sh'))).mode & 0o111);
    run('pnpm', ['install', '--frozen-lockfile'], root);
    run('pnpm', ['build'], root);
    const source = path.join(root, 'services/http/views');
    const built = path.join(root, 'services/http/build/views');
    const files = await readdir(source, { recursive: true });
    for (const file of files) {
        if (!(await stat(path.join(source, file))).isFile()) continue;
        assert.deepEqual(
            await readFile(path.join(source, file)),
            await readFile(path.join(built, file)),
            file,
        );
    }
    console.log('Extracted archive installs, builds and preserves every template asset.');
} finally {
    await rm(temporary, { recursive: true, force: true });
}
