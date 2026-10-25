import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import { fileURLToPath } from 'node:url';
import type { Request, Response, NextFunction } from 'express';
import { createApp } from '../app';

const database = await vi.hoisted(async () => {
    const { createTestDatabase } = await import('../../../tests/postgres');
    return createTestDatabase();
});
vi.mock('../lib/database/database', () => ({ default: database.pool }));
vi.mock('../lib/log', () => ({
    log: vi.fn(),
    error: vi.fn(),
    requestLogger: (_req: Request, _res: Response, next: NextFunction) => next(),
    errorLogger: (error: unknown, _req: Request, _res: Response, next: NextFunction) =>
        next(error),
}));
const app = createApp(fileURLToPath(new URL('..', import.meta.url)));
app.set('env', 'test');
beforeEach(() => database.reset());
afterAll(() => database.pool.end());

test('admin index links to discovery and reserves unknown admin paths', async () => {
    await request(app).get('/_admin').expect(308).expect('Location', '/_admin/');
    const response = await request(app)
        .get('/_admin/')
        .expect(200)
        .expect('Cache-Control', 'no-store');
    expect(response.text).toContain('href="/_admin/discovery/"');
    await request(app)
        .get('/_admin/discovery')
        .expect(308)
        .expect('Location', '/_admin/discovery/');
    await request(app).get('/_admin/rss').expect(404);
    await request(app).get('/_admin/unknown/').expect(404);
});

test.each(['/_ADMIN/discovery/', '/_Admin/', '/%5fadmin/discovery/', '/_admin/DISCOVERY/'])(
    'alternate casing or encoding cannot expose admin pages at %s',
    async (url) => {
        const response = await request(app).get(url);
        expect(response.text).not.toContain('<title>Media discovery</title>');
        expect(response.text).not.toContain('href="/_admin/discovery/"');
    },
);

test('discovery renders UTC times, failures, escaped aliases, and pending records', async () => {
    await database.pool.query(
        `INSERT INTO media_discovery(file_path, discovered_at, processed_at, original_title, series_title, alias_rules, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            '/files/<script>.mp3',
            '2026-01-02T03:04:05Z',
            '2026-01-02T04:00:00Z',
            '<original>',
            'Result',
            JSON.stringify([
                {
                    kind: 'replace',
                    rule: 1,
                    expression: '<.*>',
                    before: '<original>',
                    after: 'Result',
                },
            ]),
            '<failed refresh>',
        ],
    );
    await database.pool.query(
        "INSERT INTO media_discovery(file_path) VALUES ('/files/pending.mp3')",
    );
    const response = await request(app)
        .get('/_admin/discovery/')
        .expect(200)
        .expect('Cache-Control', 'no-store');
    expect(response.text).toContain('2026-01-02T03:04:05.000Z');
    expect(response.text).toContain('2026-01-02T04:00:00.000Z');
    expect(response.text).toContain('&lt;script&gt;.mp3');
    expect(response.text).not.toContain('<script>');
    expect(response.text).toContain('&lt;failed refresh&gt;');
    expect(response.text).toContain('replace rule 1');
    expect(response.text).toContain('&lt;.*&gt;');
    expect(response.text).toContain('Alias rules have not yet been recorded.');
    expect(response.text).toContain('No current episode');
});

test('discovery paginates deterministically and distinguishes no matches from missing audits', async () => {
    await database.pool
        .query(`INSERT INTO media_discovery(file_path, discovered_at, alias_rules)
        SELECT '/files/' || lpad(i::text, 3, '0') || '.mp3', '2026-01-01T00:00:00Z', '[]'::jsonb
        FROM generate_series(1, 101) AS i`);
    const first = await request(app).get('/_admin/discovery/').expect(200);
    expect(first.text).toContain('/files/001.mp3');
    expect(first.text).not.toContain('/files/101.mp3');
    expect(first.text).toContain('No alias rules matched.');
    expect(first.text).toContain('href="?page=2"');
    const second = await request(app).get('/_admin/discovery/?page=2').expect(200);
    expect(second.text).toContain('/files/101.mp3');
    expect(second.text).not.toContain('/files/001.mp3');
    expect(second.text).toContain('href="?page=1"');
    expect(second.text).not.toContain('Next page');
    const empty = await request(app).get('/_admin/discovery/?page=3').expect(200);
    expect(empty.text).toContain('No media discoveries on this page.');
});

test.each(['0', '-1', '1.5', 'abc', '1000000', '1&page=2', '1%27'])(
    'rejects invalid discovery page %s',
    async (value) => {
        await request(app).get(`/_admin/discovery/?page=${value}`).expect(400);
    },
);

test('reports schema not ready and forwards database failures as server errors', async () => {
    const spy = vi.spyOn(database.pool, 'query');
    spy.mockRejectedValueOnce(Object.assign(new Error('missing table'), { code: '42P01' }));
    const pending = await request(app).get('/_admin/discovery/').expect(503);
    expect(pending.text).toContain('scanner');
    spy.mockRejectedValueOnce(new Error('connection lost'));
    await request(app).get('/_admin/discovery/').expect(500);
});
