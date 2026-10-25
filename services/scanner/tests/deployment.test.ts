import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { load } from 'js-yaml';

test('Compose waits for a PostgreSQL TCP health check using configured credential files', async () => {
    const compose = load(
        await readFile(new URL('../../../docker-compose.yml', import.meta.url), 'utf8'),
    ) as {
        services: Record<
            string,
            {
                healthcheck?: {
                    test: string[];
                    retries: number;
                    interval: string;
                    timeout: string;
                };
                depends_on?: Record<string, { condition: string }>;
                environment?: Record<string, string>;
            }
        >;
    };
    const health = compose.services['majorpodo-postgres'].healthcheck;
    expect(health).toBeDefined();
    expect(health?.test[0]).toBe('CMD-SHELL');
    expect(health?.test[1]).toContain('pg_isready -h 127.0.0.1');
    expect(health?.test[1]).toContain('$$POSTGRES_USER_FILE');
    expect(health?.test[1]).toContain('$$POSTGRES_DB_FILE');
    expect(health?.retries).toBeGreaterThan(0);
    for (const name of ['majorpodo-http', 'majorpodo-scanner']) {
        expect(compose.services[name].depends_on?.['majorpodo-postgres'].condition).toBe(
            'service_healthy',
        );
        expect(compose.services[name].environment).not.toHaveProperty('WAIT_HOSTS');
    }
});

test('only loopback can reach the unauthenticated HTTP upstream and PostgreSQL is not published', async () => {
    const compose = load(
        await readFile(new URL('../../../docker-compose.yml', import.meta.url), 'utf8'),
    ) as {
        services: Record<string, { ports?: { host_ip?: string }[] }>;
    };
    const ports = compose.services['majorpodo-http'].ports;
    expect(ports?.length).toBeGreaterThan(0);
    for (const port of ports ?? []) expect(['127.0.0.1', '::1']).toContain(port.host_ip);
    expect(compose.services['majorpodo-postgres'].ports).toBeUndefined();
});
