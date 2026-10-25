import { expect, test } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

type Call = { method: string; route: string; body: Record<string, unknown> | null };
async function configure(scenario: string) {
    const directory = await mkdtemp(path.join(tmpdir(), 'majorpodo-github-settings-'));
    try {
        const bin = path.join(directory, 'bin');
        await mkdir(bin);
        const log = path.join(directory, 'calls');
        await writeFile(
            path.join(bin, 'gh'),
            `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'repo') { console.log(JSON.stringify({nameWithOwner:'test/majorpodo'})); process.exit(0); }
const method = args[2], route = args[3];
const text = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({method, route, body: text ? JSON.parse(text) : null})+'\\n');
// GitHub accepts either legacy contexts or app-bound checks, never both.
const body = text ? JSON.parse(text) : null;
const status = body?.required_status_checks ?? body;
if (status && Object.hasOwn(status, 'contexts') && Object.hasOwn(status, 'checks')) {
  console.error('HTTP 422: contexts and checks are mutually exclusive'); process.exit(1);
}
const scenario = process.env.SCENARIO;
const missing = () => { console.error('HTTP 404'); process.exit(1); };
let result = {};
if (route === 'repos/test/majorpodo' && method === 'GET') result = {visibility:scenario === 'private' ? 'private':'public', permissions:{admin:true}, default_branch:'master'};
else if (route.includes('/contents/')) { if (scenario === 'v1') missing(); result={type:'file'}; }
else if (route.endsWith('/protection') && method === 'GET') {
  if (scenario !== 'protected') missing();
  result={required_status_checks:{contexts:['Existing check'], checks:[{context:'Existing check',app_id:123}]}, enforce_admins:{enabled:true}, required_pull_request_reviews:{required_approving_review_count:2}};
}
else if (route === 'apps/github-actions') result={id:15368};
console.log(JSON.stringify(result));
`,
            { mode: 0o755 },
        );
        const result = spawnSync(
            process.execPath,
            [fileURLToPath(new URL('../../../scripts/configure-github.mjs', import.meta.url))],
            {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: bin + path.delimiter + process.env.PATH,
                    SCENARIO: scenario,
                    CALL_LOG: log,
                },
            },
        );
        const calls: Call[] = (await readFile(log, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        return { ...result, calls };
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('settings setup refuses private repositories before any mutations', async () => {
    const result = await configure('private');
    expect(result.status).not.toBe(0);
    expect(result.calls.every((call) => call.method === 'GET')).toBe(true);
});

test('v1 cannot be locked behind status checks that have not been installed', async () => {
    const result = await configure('v1');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Push/merge the v2 workflows');
    expect(result.calls.some((call) => call.route.includes('/protection'))).toBe(false);
});

test('initial protection requires the CI/security jobs from GitHub Actions without forcing a second reviewer', async () => {
    const result = await configure('new');
    expect(result.status).toBe(0);
    const policy = result.calls.find(
        (call) => call.method === 'PUT' && call.route.endsWith('/protection'),
    );
    expect(policy?.body?.required_status_checks).not.toHaveProperty('contexts');
    expect(policy?.body).toMatchObject({
        required_status_checks: {
            strict: true,
            checks: expect.arrayContaining([
                { context: 'Docker smoke', app_id: 15368 },
                { context: 'CodeQL', app_id: 15368 },
                { context: 'Container scan (postgres)', app_id: 15368 },
            ]),
        },
        required_pull_request_reviews: { required_approving_review_count: 0 },
    });
});

test('updating existing protection preserves review/admin restrictions and unrelated app bindings', async () => {
    const result = await configure('protected');
    expect(result.status).toBe(0);
    const writes = result.calls.filter(
        (call) => call.method !== 'GET' && call.route.includes('/protection'),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
        method: 'PATCH',
        route: 'repos/test/majorpodo/branches/master/protection/required_status_checks',
        body: {
            strict: true,
            checks: expect.arrayContaining([{ context: 'Existing check', app_id: 123 }]),
        },
    });
    expect(writes[0].body).not.toHaveProperty('contexts');
    expect(writes[0].body).not.toHaveProperty('enforce_admins');
    expect(writes[0].body).not.toHaveProperty('required_pull_request_reviews');
});
