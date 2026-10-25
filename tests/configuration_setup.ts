import { afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Tests use a fixture, independently of deployment settings or credentials.
const directory = mkdtempSync(path.join(tmpdir(), 'majorpodo-test-settings-'));
writeFileSync(
    path.join(directory, 'default.yml'),
    readFileSync(new URL('./fixtures/configuration.yml', import.meta.url)),
);
writeFileSync(path.join(directory, 'postgres-user'), 'majorpodo-postgres\n');
writeFileSync(path.join(directory, 'postgres-database'), 'majorpodo\n');
writeFileSync(path.join(directory, 'postgres-password'), 'test-password\n');
process.env.MAJORPODO_CONFIGURATION_DIR = directory;
afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
});
