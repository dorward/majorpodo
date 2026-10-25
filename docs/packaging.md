# Packaging and deploying a release

Run from a working checkout with Node.js 24+ and pnpm 12.14.0:

```sh
pnpm package
# Or choose an output filename:
pnpm package /tmp/majorpodo-release.tar.gz
```

The default output is `dist/majorpodo.tar.gz`, containing a single `majorpodo/`
directory. Packaging takes the current working files, including uncommitted
changes. It does not require Git, Docker, an installed dependency tree, or a
running database. It requires the system `tar` command. An existing output
archive is replaced only after packaging succeeds.

This is a source deployment bundle. It includes both services, the shared
configuration package, SQL, Dockerfiles, the frozen pnpm lockfile, templates,
static assets, tests, documentation, scripts and license texts. The target builds
Linux images itself, so archives created on macOS do not carry macOS dependencies.
It excludes dependency/build directories, local configuration, passwords, media,
database files, Git history and historical snapshots. `configuration/default.yml`
is generated from `sample.yml`; database/user files contain the standard example
names. Review the sample before packaging if you have customised it.

## GitHub Releases

Once the automation is active, pushing a matching stable version tag runs CI and
publishes the archive and its SHA-256 checksum as GitHub Release downloads.
See [the release procedure](github-automation.md#publish-a-release). Verify both
downloaded files with `sha256sum -c majorpodo.tar.gz.sha256` before transfer.

## On the production server

Follow [the v2 setup guide](../SETUP.md), starting with
[build and transfer](../SETUP.md#build-and-transfer-the-tarball). It includes SSH
and `scp` commands, extraction into a new release directory, dependency
installation, the complete configuration reference, Docker mounts, proxy
authentication and startup checks.

The server needs Node.js 24+, pnpm 12.14.0, Docker Engine and Docker Compose,
plus network access for dependency installation and image builds. Extract into
a new release directory; do not overwrite active settings with packaged examples.
For the next deployment, select a new empty PostgreSQL 18 directory and rescan
existing media. On subsequent releases, retain the configured absolute database
path and copy the active settings/credentials into the new release.
