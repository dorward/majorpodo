import { defaultDatabaseStartup, type DatabaseStartup } from './wait_for_database';
export { waitForDatabase, defaultDatabaseStartup } from './wait_for_database';
export type { DatabaseStartup } from './wait_for_database';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

export type Filters = { remove: string[]; replace: { title: string; expression: string }[] };

const configurationDirectory = () => {
    if (process.env.MAJORPODO_CONFIGURATION_DIR) return process.env.MAJORPODO_CONFIGURATION_DIR;
    // Find the repository configuration from either source or compiled code,
    // independently of the current working directory used by pnpm or Bree.
    let directory = __dirname;
    for (;;) {
        const candidate = path.join(directory, 'configuration');
        if (existsSync(path.join(candidate, 'default.yml'))) return candidate;
        const parent = path.dirname(directory);
        if (parent === directory)
            throw new Error(
                'Configuration directory not found; set MAJORPODO_CONFIGURATION_DIR',
            );
        directory = parent;
    }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const readDocument = (directory: string) => {
    const filename = path.join(directory, 'default.yml');
    return {
        filename,
        document: load(readFileSync(filename, 'utf8'), { filename }) as unknown,
    };
};

const parseFilters = (document: unknown, filename: string): Filters => {
    if (!isObject(document) || !isObject(document.filters)) {
        throw new Error(`${filename}: filters must be an object`);
    }
    const remove = document.filters.remove === undefined ? [] : document.filters.remove;
    const replace = document.filters.replace === undefined ? [] : document.filters.replace;
    if (!Array.isArray(remove) || !remove.every((rule) => typeof rule === 'string')) {
        throw new Error(`${filename}: filters.remove must be an array of strings`);
    }
    if (
        !Array.isArray(replace) ||
        !replace.every(
            (rule) =>
                isObject(rule) &&
                typeof rule.expression === 'string' &&
                typeof rule.title === 'string',
        )
    ) {
        throw new Error(`${filename}: filters.replace must contain expression/title strings`);
    }
    // Validate all expressions before any episode can be regrouped. Invalid live
    // edits fail the worker rather than silently replacing filters with defaults.
    for (const expression of [...remove, ...replace.map((rule) => rule.expression)]) {
        try {
            new RegExp(expression);
        } catch {
            throw new Error(
                `${filename}: invalid regular expression ${JSON.stringify(expression)}`,
            );
        }
    }
    return { remove, replace };
};

export const loadFilters = (directory = configurationDirectory()): Filters => {
    const { filename, document } = readDocument(directory);
    return parseFilters(document, filename);
};

export type Configuration = {
    publicUrl: string;
    listen: { host: string; port: number };
    paths: { media: string; images: string };
    database: { host: string; port: number; database: string; user: string; password: string };
    media: { pattern: string; videoPattern: string };
    filters: Filters;
    databaseStartup: DatabaseStartup;
};

export const loadConfiguration = (directory = configurationDirectory()): Configuration => {
    const { filename, document } = readDocument(directory);
    const fail = (setting: string): never => {
        throw new Error(`${filename}: invalid ${setting}`);
    };
    if (!isObject(document)) return fail('configuration');
    const section = (name: string) => {
        const value = document[name];
        if (!isObject(value)) return fail(name);
        return value;
    };
    const text = (value: unknown, key: string) => {
        if (typeof value !== 'string' || value.length === 0) return fail(key);
        return value;
    };
    const port = (value: unknown, key: string) => {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535)
            return fail(key);
        return value;
    };
    const publicUrl = text(document.publicUrl, 'publicUrl');
    let origin: URL;
    try {
        origin = new URL(publicUrl);
    } catch {
        return fail('publicUrl');
    }
    if (
        !['http:', 'https:'].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash
    )
        return fail('publicUrl (expected an HTTP(S) origin)');
    const listen = section('listen');
    const paths = section('paths');
    const directoryPath = (value: unknown, key: string) => {
        const name = text(value, key);
        if (!path.isAbsolute(name)) return fail(key + ' (expected an absolute path)');
        const resolved = path.resolve(name);
        if (resolved === path.parse(resolved).root)
            return fail(key + ' (must not be a filesystem root)');
        return resolved + path.sep;
    };
    const mediaPath = directoryPath(paths.media, 'paths.media');
    const imagePath = directoryPath(paths.images, 'paths.images');
    const contains = (parent: string, child: string) => {
        const relative = path.relative(parent, child);
        return (
            relative === '' ||
            (relative !== '..' &&
                !relative.startsWith('..' + path.sep) &&
                !path.isAbsolute(relative))
        );
    };
    if (contains(mediaPath, imagePath) || contains(imagePath, mediaPath))
        return fail('paths (media and images must not overlap)');
    const database = section('database');
    const credential = (key: string) => {
        if (database[key] !== undefined) return text(database[key], `database.${key}`);
        const file = text(database[`${key}File`], `database.${key}File`);
        // Match the official postgres image's _FILE handling: strip trailing newlines only.
        return text(
            readFileSync(path.resolve(directory, file), 'utf8').replace(/\n+$/, ''),
            `database.${key}File`,
        );
    };
    const media = section('media');
    const pattern = text(media.pattern, 'media.pattern');
    const videoPattern = text(media.videoPattern, 'media.videoPattern');
    for (const expression of [pattern, videoPattern]) {
        try {
            new RegExp(expression);
        } catch {
            return fail('media regular expression');
        }
    }
    const startup = document.databaseStartup === undefined ? {} : section('databaseStartup');
    const positive = (key: keyof DatabaseStartup, allowZero = false) => {
        const value = startup[key] === undefined ? defaultDatabaseStartup[key] : startup[key];
        if (
            typeof value !== 'number' ||
            !Number.isSafeInteger(value) ||
            value < (allowZero ? 0 : 1)
        )
            return fail(`databaseStartup.${key}`);
        if (key !== 'attempts' && value > 2147483647) return fail(`databaseStartup.${key}`);
        return value;
    };
    return {
        databaseStartup: {
            attempts: positive('attempts'),
            intervalMs: positive('intervalMs', true),
            timeoutMs: positive('timeoutMs'),
        },
        publicUrl: origin.origin,
        listen: {
            host: text(listen.host, 'listen.host'),
            port: port(listen.port, 'listen.port'),
        },
        paths: { media: mediaPath, images: imagePath },
        database: {
            host: text(database.host, 'database.host'),
            port: port(database.port, 'database.port'),
            database: credential('database'),
            user: credential('user'),
            password: credential('password'),
        },
        media: { pattern, videoPattern },
        filters: parseFilters(document, filename),
    };
};

export const loadDeploymentConfiguration = (
    directory = configurationDirectory(),
    projectDirectory = process.cwd(),
): { postgresDataDirectory: string } => {
    const { filename, document } = readDocument(directory);
    if (
        !isObject(document) ||
        (document.deployment !== undefined && !isObject(document.deployment))
    ) {
        throw new Error(`${filename}: deployment must be an object`);
    }
    const configured = (document.deployment as Record<string, unknown> | undefined)
        ?.postgresDataDirectory;
    const value = configured === undefined ? './data/postgresql' : configured;
    if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value.startsWith('~') ||
        value.includes('\0')
    ) {
        throw new Error(
            `${filename}: deployment.postgresDataDirectory must be an absolute or project-relative path (no ~ expansion)`,
        );
    }
    const resolved = path.resolve(projectDirectory, value);
    if (resolved === path.parse(resolved).root)
        throw new Error(`${filename}: PostgreSQL data must not use the filesystem root`);
    return { postgresDataDirectory: resolved };
};
