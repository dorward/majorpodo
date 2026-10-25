import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Use the production schema and SQL in embedded PostgreSQL. Only the pg Pool
// transport is replaced; no query results or database constraints are mocked.
export async function createTestDatabase() {
    const db = await PGlite.create();
    await db.exec(
        await readFile(
            new URL('../services/postgresql/docker_postgres_init.sql', import.meta.url),
            'utf8',
        ),
    );
    const query = <Row = Record<string, unknown>>(
        statement: string | { text: string; values?: unknown[] },
        values?: unknown[],
    ) =>
        db.query<Row>(
            typeof statement === 'string' ? statement : statement.text,
            values ?? (typeof statement === 'string' ? undefined : statement.values),
        );
    const pool = {
        query,
        connect: async () => ({ query, release: () => {} }),
        end: () => db.close(),
    };
    return {
        pool,
        reset: () =>
            db.exec('TRUNCATE media_discovery, episode, series RESTART IDENTITY CASCADE'),
        rows: async (sql: string) => (await query(sql)).rows,
        row: async (sql: string) => (await query(sql)).rows[0],
    };
}
