import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const tag = process.env.RELEASE_TAG;
assert.match(tag ?? '', /^v\d+\.\d+\.\d+$/, 'Release tags must be vMAJOR.MINOR.PATCH');
for (const file of [
    'package.json',
    'services/http/package.json',
    'services/scanner/package.json',
    'packages/configuration/package.json',
]) {
    const manifest = JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'));
    assert.equal('v' + manifest.version, tag, `${file} version must match the release tag`);
}
console.log(`All package versions match ${tag}.`);
