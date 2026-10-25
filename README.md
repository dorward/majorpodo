# Majorpodo

Majorpodo turns a directory of audio and video files into podcast feeds and web
pages. It groups episodes using embedded metadata, extracts artwork, and serves
the original media files. It works well with recordings from
[get_iplayer](https://github.com/get-iplayer/get_iplayer).

Version 2 runs three Docker Compose services: an Express HTTP server, a Bree
scanner, and PostgreSQL. HTTPS and podcast account authentication are provided
by a reverse proxy; the application itself does not authenticate requests.

## Installation

Use [SETUP.md](SETUP.md) for the complete production procedure, including every
configuration field, server directories, HTTPS authentication, and verification.

1. On your development machine, run `pnpm package` in the checkout. This creates
   `dist/majorpodo.tar.gz` from the current source, with example configuration.
2. Transfer it to the server with `scp` and extract into a new release directory.
   The archive excludes your local settings, passwords, media and database data.
3. On the server, install Node.js 24+, pnpm 12.14.0, Docker Engine and Docker
   Compose. Run `pnpm install --frozen-lockfile` in the extracted `majorpodo/`
   directory to build the YAML-aware deployment helper.
4. Configure `configuration/default.yml`, the database credential files, and
   Compose bind mounts. Set the public URL to your own origin, for example
   `https://majorpodo.example.com`. Protect the upstream with the reverse proxy.
5. Run `./run.sh config --quiet`, then
   `./run.sh up -d --build --remove-orphans`. Check `./run.sh ps` and logs.

The tarball contains source, not prebuilt images. The server needs network
access to install dependencies and build Linux images. See
[packaging details](docs/packaging.md) for archive contents and custom filenames.
A Git checkout can also be deployed using the same server configuration and
startup steps.

The agreed next deployment starts with a new empty PostgreSQL directory and
rescans the existing media. Keep that directory stable on later deployments.
See [fresh database deployment](SETUP.md#fresh-database-deployment); the images
do not migrate a PostgreSQL 14 data directory to PostgreSQL 18.

## Configuration and operation

[SETUP.md](SETUP.md#configuration-reference) is the configuration reference.
The shared loader reads `configuration/default.yml` at process startup. Each
scanner worker rereads it; HTTP settings require an HTTP restart. Configuration
is mounted into containers rather than baked into images.

HTTP is published on `127.0.0.1:3000` by default; remote access goes through the
host reverse proxy. Keep that binding when customising Compose.

Both scan jobs start 30 seconds after database readiness and repeat every two
hours. Unchanged files receive stat checks without metadata parsing, artwork
reads, or database updates. Changes to tags, companion artwork or title filters
refresh existing records while retaining episode IDs. Filter changes reuse
stored source tags. Manual `.jpg` artwork beside a media file takes precedence
over embedded artwork; both are copied into a shared content-addressed cache.
Missing cache files are repaired on the next scan; only missing embedded artwork
requires reparsing unchanged media.

Deletion scans remove missing episodes, empty series, and unreferenced generated
cache images. They preserve source media and companion artwork. A shared
PostgreSQL advisory lock prevents concurrent scans; a failed directory traversal
aborts cleanup. Failed imports keep the previous record and retry on a later scan.
The old `/__refresh` endpoint is not supported.

Compose gates application startup on PostgreSQL health. HTTP, the scheduler and
scan workers also run bounded authenticated SQL probes against the required
schema before starting. All three containers use `restart: unless-stopped`.
Use `./run.sh` for Compose commands so the database host directory is loaded
from YAML; there is no separate `.env` storage setting.

For HTTPS and Basic Auth, follow [the Nginx guide](docs/authentication.md).
Show pages, feeds, media, artwork and static assets must all be protected.

## Administration

Open `/_admin/` for the admin page index and `/_admin/discovery/` for media
discovery times, import errors, and the alias rules used by the latest successful
import or refresh. Configure [nominated Nginx administrators](docs/authentication.md#nominate-administrators)
before exposing these routes; ordinary podcast accounts must not have access.
See [discovery tracking](SETUP.md#discovery-tracking) for history and upgrade details.

## Development

Use the Node version in `.nvmrc` (`nvm use`) and pnpm 12.14.0:

```sh
npm install --global pnpm@12.14.0
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

The pnpm workspace contains `services/http`, `services/scanner`, and
`packages/configuration`, with one root lockfile. Installation builds the shared
configuration package. The services use strict TypeScript and compile to
CommonJS under `build/`; scanner module resolution is NodeNext for compatibility
with the ESM media parser on Node 24. Docker uses Node 24.22.1 and PostgreSQL
18.6. Runtime images contain isolated production packages from `pnpm deploy`.

Oxlint and Oxfmt handle linting and formatting. Use `pnpm lint:fix` and
`pnpm format:fix` for automatic fixes. The Oxc editor extension is `oxc.oxc-vscode`.
Templates, generated CSS, source maps and the lockfile are excluded from formatting.

Vitest tests use isolated configuration fixtures, PGlite for the production SQL,
and synthetic MP3/M4A/MP4 fixtures for the real metadata parser. They do not need
a running PostgreSQL server or Docker. Coverage includes page rendering, feeds,
missing records, database failures, imports, refresh performance and deletion.
Use `pnpm test:watch` or `pnpm --filter @majorpodo/scanner test` for narrower work.

Individual commands use workspace filters:

```sh
pnpm --filter @majorpodo/http build
pnpm --filter @majorpodo/scanner start:dev
```

Scanner `start:dev` watches TypeScript sources, rebuilds, and runs the compiled
scheduler and JavaScript workers together. `start:prod` runs a prior build;
worker paths are resolved relative to the scheduler module, independently of
the working directory.

Running a service needs valid runtime configuration and a reachable database
with the schema installed. In Docker, build both images with `./run.sh build`
after completing the server configuration. The repository root is the build
context so both services can access the shared package and lockfile.

Local tests, builds, archive installation and a full Docker startup/import against
disposable PostgreSQL storage have been exercised. `pnpm test:docker` runs that
smoke test; it never uses production data. Live Nginx verification remains a
deployment task.

## GitHub automation

Pull requests run checks, Docker smoke tests, dependency audits/review, CodeQL
and container scans. Weekly scans revisit newly disclosed vulnerabilities.
Renovate is configured for weekly update PRs with major updates requiring review.
Stable version tags build a release tarball and checksum after CI passes.
See [GitHub setup and release procedures](docs/github-automation.md) for app
installation, repository settings, required checks and local commands.

## License

Distributed under the [GNU General Public License version 2 only](LICENSE)
(SPDX: `GPL-2.0-only`). The root project and all workspace packages use this
license. Third-party dependencies retain their own licenses.

## Contributing

The repository is [dorward/majorpodo](https://github.com/dorward/majorpodo/).
Fork it, create a branch, make your changes, run the development checks above,
and open a pull request.
