# Majorpodo v2 setup

Majorpodo runs an HTTP service, a scanner and PostgreSQL under Docker Compose.
Nginx on the host provides HTTPS and Basic Auth. These instructions use
`majorpodo.example.com`; replace it with your own hostname.

## Requirements and server layout

On the machine creating the package, use Node.js 24+, pnpm 12.14.0 and `tar`.
On the production Linux server, install Node.js 24+ (the project pins 24.22.1),
pnpm 12.14.0, Docker Engine with Docker Compose, and `tar`. Use an account that
can run Docker and write to the deployment directories. Dependencies and images
are downloaded during installation/build, so the server needs network access.
Git is not required on the server. Docker manages the processes; do not use PM2.

Install the pinned pnpm version if needed:

```sh
npm install --global pnpm@12.14.0
node --version
pnpm --version
docker compose version
```

The examples assume these host directories have been prepared with appropriate
ownership for the deployment account and Docker:

| Host directory                                | Purpose                                                             |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `/srv/majorpodo/incoming`                     | Transferred release archives.                                       |
| `/srv/majorpodo/releases/<release>/majorpodo` | Extracted application and configuration for one release.            |
| `/srv/majorpodo/postgresql-fresh`             | Dedicated PostgreSQL data directory, empty for the next deployment. |
| `/var/media/get_iplayer`                      | Existing source media and optional companion `.jpg` artwork.        |
| `/var/media/cached_majorpodo_images`          | Writable generated artwork cache.                                   |

Keep database, media and cache directories outside release directories. The
application needs read access to media and read/write access to cached artwork.
The PostgreSQL entrypoint manages ownership within its data directory. Do not
point database storage at a directory containing unrelated files.

## Build and transfer the tarball

Run in your local checkout:

```sh
pnpm package
ssh majorpodo@majorpodo.example.com \
  'mkdir -p /srv/majorpodo/incoming /srv/majorpodo/releases/v2-20261025'
scp dist/majorpodo.tar.gz \
  majorpodo@majorpodo.example.com:/srv/majorpodo/incoming/majorpodo-v2-20261025.tar.gz
```

Replace `majorpodo` with the server's SSH account and choose a unique release
name for each deployment. If `/srv/majorpodo` is not writable, have the server
administrator create it and assign it to the deployment account first.

The tarball contains source and build/deployment files, not Linux images or an
installed dependency tree. It uses the current working files, including
uncommitted changes. Its `configuration/default.yml` is copied from `sample.yml`;
your local runtime settings and password are not included. See
[archive contents and packaging options](docs/packaging.md).

Connect and extract on the server:

```sh
ssh majorpodo@majorpodo.example.com
cd /srv/majorpodo/releases/v2-20261025
tar -xzf /srv/majorpodo/incoming/majorpodo-v2-20261025.tar.gz
cd majorpodo
pnpm install --frozen-lockfile
```

Always extract into a new release directory. Extracting over a running release
would overwrite its configuration with the packaged example. The archive has
one top-level `majorpodo/` directory. Installation builds the shared TypeScript
helper required by `run.sh`; both service images are built later by Compose.

## Prepare configuration

For a new installation, edit the packaged `configuration/default.yml`. Create
the password file before startup:

```sh
cp configuration/postgres-password.example configuration/postgres-password
chmod 600 configuration/postgres-password
# Replace change-me with a strong database password in the file.
```

For an existing installation, copy its settings and credential files from the
old release instead. For example, from the new release directory:

```sh
cp /srv/majorpodo/releases/PREVIOUS/majorpodo/configuration/default.yml configuration/
cp /srv/majorpodo/releases/PREVIOUS/majorpodo/configuration/postgres-user configuration/
cp /srv/majorpodo/releases/PREVIOUS/majorpodo/configuration/postgres-database configuration/
cp /srv/majorpodo/releases/PREVIOUS/majorpodo/configuration/postgres-password configuration/
chmod 600 configuration/postgres-password
```

Replace `PREVIOUS` with the old release name. Include any additional credential
files referenced by your YAML. Review copied settings against the reference
below, particularly database storage and paths. Preserve any required title
filters: the packaged sample contains only example rules. Changes previously
made to Compose mounts or port mappings must also be applied to the new release.

A typical production `configuration/default.yml` is:

```yaml
deployment:
  postgresDataDirectory: /srv/majorpodo/postgresql-fresh
publicUrl: https://majorpodo.example.com
listen:
  host: 0.0.0.0
  port: 3000
paths:
  media: /var/media/get_iplayer/
  images: /var/media/images/
database:
  host: majorpodo-postgres
  port: 5432
  databaseFile: postgres-database
  userFile: postgres-user
  passwordFile: postgres-password
databaseStartup:
  attempts: 30
  intervalMs: 1000
  timeoutMs: 2000
media:
  pattern: "(m4a|mp3|mp4)$"
  videoPattern: "mp4$"
filters:
  remove: [': Series \d+$']
  replace:
    - expression: "^Paul Scott - The Raj Quartet$"
      title: "The Raj Quartet"
```

## Configuration reference

The shared loader validates `configuration/default.yml` before a process starts
work. Except for the defaults and alternatives listed below, fields are
required. Unknown keys are ignored; old v1 keys such as `path` and `imagePath`
have no effect. There are no `NODE_ENV` overlays and no `.env` file is needed.

### Host deployment and public HTTP settings

| Field                              | What to set                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployment.postgresDataDirectory` | Dedicated **host** directory for PostgreSQL. Default `./data/postgresql` if omitted. An absolute path such as `/srv/majorpodo/postgresql-fresh` keeps it stable across release directories. Relative paths resolve from the Compose project/release directory. `~` and shell variables are not expanded; the filesystem root and empty paths are rejected. Changing this switches storage; it does not move or migrate data. |
| `publicUrl`                        | Public HTTP(S) origin used in RSS/page/media/artwork URLs, e.g. `https://majorpodo.example.com`. Include a nonstandard public port if needed. No path, query, fragment or embedded credentials; a trailing `/` is accepted and normalised away. Use the externally visible URL, not the Docker hostname.                                                                                                                     |
| `listen.host`                      | Address the HTTP process binds **inside its container**. Keep `0.0.0.0` for Compose so Docker can forward requests. This is separate from the host-side publishing address.                                                                                                                                                                                                                                                  |
| `listen.port`                      | Integer from 1 to 65535, normally `3000`. Match the HTTP Compose `ports.target` and proxy upstream port if changing the published port.                                                                                                                                                                                                                                                                                      |
| `paths.media`                      | Absolute media directory **inside both application containers**, normally `/var/media/get_iplayer/`. Match the media bind mount target in both services. The scanner traverses it; HTTP serves it under `/media/`.                                                                                                                                                                                                           |
| `paths.images`                     | Absolute artwork cache directory **inside both application containers**, normally `/var/media/images/`. Match both cache mount targets. It must not overlap `paths.media`: neither directory may contain the other, and they must not be equal. Neither path may be the filesystem root. HTTP serves it under `/images/`. Trailing separators are normalised.                                                                |

`run.sh` reads the deployment field directly from this release's
`configuration/default.yml` each time it runs. Its internal Compose environment
variable is generated from YAML; obsolete shell/`.env` storage overrides do not
select another directory. Use `./run.sh` rather than invoking Compose directly.

### Database connection and credential files

| Field                   | What to set                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.host`         | PostgreSQL hostname reachable from the application containers. Use `majorpodo-postgres` for the bundled service; `localhost` would mean the application container itself.                                        |
| `database.port`         | Integer from 1 to 65535; `5432` for bundled PostgreSQL. No database host port is published by the supplied Compose file.                                                                                         |
| `database.databaseFile` | Path to a plain text file containing the database name; default configuration uses `postgres-database`. Relative paths resolve from the configuration directory; absolute paths refer to the runtime filesystem. |
| `database.userFile`     | Credential file path containing the PostgreSQL role name; default configuration uses `postgres-user`.                                                                                                            |
| `database.passwordFile` | Credential file path containing that role's password; default configuration uses `postgres-password`.                                                                                                            |
| `database.database`     | Optional inline alternative to `databaseFile`; a nonempty database name.                                                                                                                                         |
| `database.user`         | Optional inline alternative to `userFile`; a nonempty role name.                                                                                                                                                 |
| `database.password`     | Optional inline alternative to `passwordFile`; a nonempty password. Prefer the separate ignored password file.                                                                                                   |

For each credential, supply the file field or its inline alternative. An inline
value takes precedence if both are set. File contents are literal text, not YAML
and not `KEY=value` assignments; quote characters would become part of the
credential. Trailing line-feed characters are stripped. The packaged files are:

| File                                      | Contents/purpose                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `configuration/postgres-database`         | Database name, initially `majorpodo`.                                                                         |
| `configuration/postgres-user`             | Database role name, initially `majorpodo-postgres`.                                                           |
| `configuration/postgres-password.example` | Template containing `change-me`; not used at runtime.                                                         |
| `configuration/postgres-password`         | Your chosen database password; create it, restrict permissions, and keep it out of Git and transfer archives. |
| `configuration/sample.yml`                | Example settings; not loaded at runtime. Packaging copies it to the archive's `default.yml`.                  |
| `configuration/default.yml`               | Active YAML settings for this release.                                                                        |

The supplied Compose file bootstraps PostgreSQL from those same three runtime
files using `POSTGRES_DB_FILE`, `POSTGRES_USER_FILE` and `POSTGRES_PASSWORD_FILE`
at `/configuration/...`. If changing credential filenames or using inline values,
update the PostgreSQL bootstrap settings to match; YAML alone does not change
those Compose entries. With the bundled database, retain file-based credentials.
Editing credential files does not change credentials already stored in an
existing database: update PostgreSQL itself and keep the application settings
in agreement.

An external PostgreSQL server can be selected with `database.host`/`port`, but
its schema must already be installed. Adapt Compose to remove the bundled
PostgreSQL service and its `depends_on` entries if it is not needed. The current
loader exposes no SSL/TLS connection options. Authentication and connectivity
must work from the application containers before startup can succeed.

### Startup retries

`databaseStartup` may be omitted; individual omitted fields use these defaults.

| Field                        | Default and meaning                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `databaseStartup.attempts`   | `30`; positive safe integer, maximum probe attempts per process startup.                                                                        |
| `databaseStartup.intervalMs` | `1000`; nonnegative integer delay in milliseconds between failed attempts. Maximum `2147483647`.                                                |
| `databaseStartup.timeoutMs`  | `2000`; positive integer timeout in milliseconds, applied separately to connection establishment and the probe SQL query. Maximum `2147483647`. |

Compose first waits for its TCP PostgreSQL health check. Applications then run
an authenticated query requiring both `series` and `episode` tables. HTTP does
not listen, and scans do not begin, until that succeeds. Exhausting retries
exits the process nonzero; container restart policies then apply. These are
startup probes, not retries of arbitrary application queries.

### Media matching and title filters

| Field                          | What to set                                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media.pattern`                | Nonempty JavaScript regular expression string selecting media paths. Default configuration is `(m4a\|mp3\|mp4)$`. Matching is case-sensitive, so uppercase extensions are not matched by that expression. |
| `media.videoPattern`           | Nonempty regular expression string identifying selected files as video, normally `mp4$`; other selected files are audio.                                                                                  |
| `filters.remove`               | Array of regular expression strings applied in order to album/series titles. Each expression removes its first matching portion. An omitted list defaults to `[]`.                                        |
| `filters.replace`              | Array of replacement rule objects, applied in order after removals. An omitted list defaults to `[]`; the `filters` object itself is required.                                                            |
| `filters.replace[].expression` | Regular expression string testing the current title. Use anchors if an exact whole-title match is intended.                                                                                               |
| `filters.replace[].title`      | String replacing the **entire** title when the expression matches. Later rules test the resulting title, so rules may chain.                                                                              |

These are expression strings, without `/.../` delimiters or flags. Use YAML
single quotes for backslashes: `': Series \d+$'`. In double-quoted YAML the
backslash must itself be escaped: `": Series \\d+$"`. `/` needs no escaping.
Invalid expressions stop the process. Use `filters: { remove: [], replace: [] }`
if no title normalisation is wanted. Filter edits refresh existing series from
stored original metadata on the next scan without reparsing unchanged media.

### When edits take effect

Each process reads a single configuration snapshot at startup. Each new scanner
worker rereads the files (normally on the next two-hour scan). Restart HTTP for
its settings, and restart the scanner scheduler to change its own database
connection/startup settings immediately:

```sh
./run.sh restart majorpodo-http majorpodo-scanner
```

YAML-only application changes do not require image rebuilds. Changes to Compose
mounts, port mappings or environment require container recreation with
`./run.sh up -d --build --remove-orphans`, rather than just `restart`.

Compose mounts `./configuration` read-only at `/configuration` in all services;
application images do not contain local configuration. Directory mounts support
editors that replace files atomically. `MAJORPODO_CONFIGURATION_DIR` overrides
the application loader's directory for direct/custom runs; supplied containers
set it to `/configuration`. Outside Docker, the loader otherwise searches
upwards from its module for `configuration/default.yml`. The Compose wrapper
always uses the configuration beside this release's `run.sh`.

## Match Docker mounts and protect the HTTP port

Edit `docker-compose.yml` in the extracted release. In **both** HTTP and scanner
services, the host side of each bind mount must point at the same media/cache
storage. The supplied mappings are:

| Host source                           | Container target             | Related YAML field               |
| ------------------------------------- | ---------------------------- | -------------------------------- |
| `/var/media/get_iplayer/`             | `/var/media/get_iplayer/`    | `paths.media`                    |
| `/var/media/cached_majorpodo_images/` | `/var/media/images/`         | `paths.images`                   |
| `./configuration`                     | `/configuration` (read-only) | Runtime configuration directory. |

For example, if media is stored on the host at `/srv/podcasts`, change the
source to `/srv/podcasts/` while keeping the target and `paths.media` unchanged.
Alternatively change the targets too and update YAML accordingly. The database
mount source comes from `deployment.postgresDataDirectory`, with container
target `/var/lib/postgresql` and actual PostgreSQL 18 cluster at `18/docker`.
Do not put a custom data directory inside the Docker build context without also
excluding it in `.dockerignore` and `.gitignore`.

For Nginx on the same host, keep the supplied loopback-only HTTP `ports` entry:

```yaml
ports:
  - target: 3000
    published: 3000
    host_ip: 127.0.0.1
```

The supplied Compose file publishes only on host loopback so remote clients
cannot connect directly and bypass Nginx's Basic Auth. Preserve this binding
when customising Compose, and verify it after recreating containers. Leave `listen.host: 0.0.0.0` **inside** the container. Configure Nginx
with `proxy_pass http://127.0.0.1:3000`, HTTPS certificates and a separate HTTP
account password file following [the authentication guide](docs/authentication.md).
The PostgreSQL password file is unrelated to podcast user accounts.

## Fresh database deployment

The next deployment starts from scratch with a full scan of existing media.
Set `deployment.postgresDataDirectory` to a **new empty** directory such as
`/srv/majorpodo/postgresql-fresh`, keeping the old database directory untouched.
Do not point PostgreSQL 18 at the old PostgreSQL 14 cluster. No old database
migration is planned for this deployment. Source media and manual artwork stay
in their existing storage.

PostgreSQL runs `services/postgresql/docker_postgres_init.sql` automatically
only when initialising an empty data directory. It does not reapply that SQL
on later restarts or migrate an existing cluster.
Keep the newly selected host directory stable for later releases so the new
catalogue persists; switching the setting does not transfer existing data.

## Validate and start

From the new release's `majorpodo/` directory, after installing dependencies and
completing configuration:

```sh
./run.sh config --quiet
./run.sh build
```

The first command validates Compose structure and the YAML database storage
setting; it does not fully validate application settings, database credentials
or source filesystem permissions. Those are checked when applications start.
The build command creates both Linux service images without starting them.

If an older installation is running, stop it from its own release directory
using `./run.sh down` before starting the replacement. Container names and host
ports are shared, so do not run both releases together. Then, in the new release:

```sh
./run.sh up -d --build --remove-orphans
./run.sh ps
./run.sh logs -f majorpodo-postgres majorpodo-scanner majorpodo-http
```

PostgreSQL should become healthy before the applications start. After database
readiness, both scanner jobs first run after 30 seconds and repeat every two
hours. The import and deletion jobs share a database lock, so they do not run
concurrently. The website and feeds may initially be empty during the first
scan. Deletion cleanup can remove old generated cache artwork unreferenced by
the new catalogue; companion `.jpg` files beside media are preserved.

Check the public catalogue, a show, an episode, its RSS feed, a media download
and its artwork. Run the authenticated/unauthenticated and upstream isolation
checks in [the Nginx guide](docs/authentication.md#verify-on-the-deployment).
A Basic Auth protected home page should challenge without credentials:

```sh
curl -I https://majorpodo.example.com/
curl -u podcast-user https://majorpodo.example.com/
```

The second command prompts for the podcast user's password. Confirm real feed
subscriptions and media playback in the intended podcast client. Fresh scanning
may assign different episode IDs, so old episode page links can change. Feed
GUIDs use media URLs: preserve the public origin and media paths to preserve
those identities. Legacy v1 `/title/...` and `/audio/...` links are unsupported.

## Ongoing operation and later releases

All containers use `restart: unless-stopped`; Docker restarts them after a crash
or host restart unless they have been explicitly stopped. Useful commands are:

```sh
./run.sh ps
./run.sh logs --tail=100 majorpodo-scanner
./run.sh restart majorpodo-http majorpodo-scanner
./run.sh stop
./run.sh up -d
```

`run.sh` accepts Compose arguments; with no arguments it runs
`up --build --remove-orphans` in the foreground. There is no supported manual
HTTP rescan endpoint; `/__refresh` is not implemented.

For a later release, repeat packaging/transfer into a new release directory,
copy the active configuration and credentials, preserve any Compose mount/port
customisations, and keep the absolute PostgreSQL path unchanged. Validate/build,
stop the previous release, and start the new one. Do not replace a live
configuration directory with the tarball's example.

For artwork overrides, place a `.jpg` file beside the media with the same base
name, e.g. `episode.m4a` and `episode.jpg`. The scanner copies manual or embedded
artwork into `paths.images` as `<first-two-hash-characters>/<hash>.jpeg`. It does
not modify companion files. Updated tags, artwork and filters are applied on a
later scan, while unmodified files avoid expensive metadata parsing.

## Discovery tracking

`/_admin/` lists available admin pages. `/_admin/discovery/` is a paginated
report (100 paths per page, newest first) of all files discovered by successful
media traversals, including failed imports. Configure the separate admin user
list in [Nginx](docs/authentication.md#nominate-administrators); the application
itself does not enforce user authentication or admin roles. Apply the example's
admin locations as well as its ordinary site authentication.

The scanner records first observation time separately from the media's tag/date
and filesystem modification time. Times are displayed in UTC. Each successful
import/refresh saves the original album title, resulting series, and matching
`filters.remove` and `filters.replace` rules in execution order, including their
expressions and before/after titles. These are snapshots of the rules actually
used, not a reinterpretation using today's YAML. Unchanged scans preserve the
timestamps and audit. A later refresh replaces the last successful audit; this
is not a complete log of every prior rule revision. Failed refreshes preserve
the last successful audit and show the latest error until a retry succeeds.

Discovery history remains after episodes are removed. A path that reappears
retains its original discovery time. No historical discovery time can be
reconstructed for files seen before this feature was installed: their first
scan with tracking enabled is the first recorded observation. Files that were
already removed before that scan cannot appear in the report.

New databases create `media_discovery` through the init SQL. On existing
installations, the scanner adds it automatically under the scan lock. The report
returns `503` until that table exists (normally the scanner's first job after
30 seconds). Restart the scanner when deploying this code. Existing cached source
metadata is reused to populate alias audits on the next import scan without
reparsing unchanged media; records without cached source tags need a baseline
parse. History is kept in PostgreSQL, so a fresh database starts a fresh report.

Missing generated artwork is repaired on the next scan. The scanner checks cache
file existence without reading image bytes during unchanged scans. Missing
manual copies are recopied from the companion `.jpg` without reparsing media;
missing embedded artwork requires reparsing only the affected media file, even
when a manual override is currently displayed. Episode IDs remain unchanged.
