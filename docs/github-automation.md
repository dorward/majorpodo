# GitHub security, updates and releases

The workflows use standard Ubuntu GitHub-hosted runners and free security
features for the public `dorward/majorpodo` repository. They become active when
these files are pushed to GitHub. Scheduled workflows run from the default
branch (`master`); pull requests run against their proposed source. GitHub can
disable schedules after prolonged public-repository inactivity; re-enable them
in Actions if that happens. No production credentials are needed.

## Workflows

| File                             | Trigger                                                    | Checks/output                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`       | PRs, pushes to master, manual runs, release workflow calls | Unit/integration tests, typecheck, lint, formatting, builds, clean tarball installation/build, Docker smoke, all-dependency and production-only audits, PR dependency review.    |
| `.github/workflows/security.yml` | PRs, pushes to master, Mondays at 06:23 UTC, manual runs   | CodeQL JavaScript/TypeScript `security-extended` queries; Trivy scans of both runtime images and the configured PostgreSQL image. Scheduled/manual runs also audit dependencies. |
| `.github/workflows/release.yml`  | Pushed `v*` tags                                           | Runs CI again, checks every manifest version matches a stable `vMAJOR.MINOR.PATCH` tag, creates the deployment archive and SHA-256 checksum, then publishes a GitHub Release.    |

Audit, dependency review and container scans fail on high/critical findings.
Trivy includes unfixed vulnerabilities so they remain visible and require review.
Container SARIF reports appear under Security/code scanning and are retained as
Actions artifacts for seven days. Fork PR scans still run and retain reports,
but do not attempt privileged SARIF upload. CodeQL uses GitHub's supported PR
analysis flow.

Actions are pinned to commit SHAs. Workflow permissions are read-only except
for SARIF/code-scanning upload and the final release-publishing job. Checkouts
do not persist Git credentials. The workflows do not use `pull_request_target`,
deploy to production, or receive production secrets. Only the release publisher
has repository content write permission, after CI and packaging pass.

## Initial container-scan baseline

The 25 October 2026 local scan found no high/critical vulnerabilities in the
HTTP/scanner images after removing unused npm/Yarn tooling from their runtime
stages. Both rebuilt images passed the Docker smoke test.

The freshly pulled official `postgres:18.6-alpine` image still reported 27
high/critical findings: one Alpine package finding and 26 Go standard-library
findings in its bundled `gosu` helper. These are scanner findings, not a
reachability/exploitability assessment. They are **not suppressed**: the
PostgreSQL scan will fail until the upstream image is fixed or findings receive
an explicit, justified review. See [the recorded baseline](security-baseline.json)
for component versions and advisory IDs. Keep weekly scans enabled to detect
upstream image fixes and new advisories. Do not treat successful application
CI or an npm audit as proof that the PostgreSQL image is clear.

## Update pull requests

`renovate.json` configures the hosted [Renovate app](https://github.com/apps/renovate):

- Weekly update windows before 07:00 Monday, Europe/London.
- Grouped non-major package, image, action and tool updates; no automatic merging.
- Separate major updates requiring Dependency Dashboard approval before a PR.
- PostgreSQL major updates explicitly require a migration plan and smoke testing.
- Lockfile maintenance plus pinned-action and Docker image digest refreshes.
- Coverage for pnpm workspace manifests/lockfile, Dockerfiles, Compose, `.nvmrc`,
  Actions, and the pnpm/Trivy versions embedded in build/workflow commands.

Install the app for **only this repository**, and review its onboarding PR or
Dependency Dashboard. Installing it grants the app access to create branches,
pull requests and issues; an owner must approve that GitHub App installation.
A repository configuration file alone does not install the app.

Dependabot alerts and automated security fixes complement Renovate. There is
no second Dependabot version-update configuration, avoiding duplicate update
PRs. GitHub currently documents pnpm support only through version 10; this
project uses pnpm 12, so frozen installs, the actual pnpm audit command and
container scans are independent checks rather than relying solely on GitHub's
lockfile interpretation. Confirm Renovate's first lockfile update succeeds
before considering update automation verified.

## Repository settings and required checks

Enable the following in Settings → Advanced Security for this public repository:

- Dependency graph and Dependabot alerts/security updates.
- Secret scanning and push protection.
- Code scanning through the checked-in advanced CodeQL workflow. Do not enable
  default setup simultaneously; advanced setup owns the workflow configuration.

Dependabot alerts/security fixes, secret scanning and push protection were
enabled through the repository API during this setup. These settings live on
GitHub, not in the Git checkout. Secret scanning recognises supported patterns;
it is not a guarantee of detecting arbitrary database passwords.

Once the v2 workflows have been pushed and their first PR run has completed,
protect `master` and require these exact status checks before merging:

- `Checks`
- `Docker smoke`
- `Dependency audit`
- `Dependency review`
- `CodeQL`
- `Container scan (http)`
- `Container scan (scanner)`
- `Container scan (postgres)`

Use strict/up-to-date checks. The `configure:github` command applies these
settings after confirming the default branch contains the workflows; it refuses
to install new required checks against the still-unmigrated v1 default branch.
Existing protection settings are retained when updating required checks.
The initial policy requires PRs with passing checks but no second person's
approval, suitable for a solo-maintained repository. Administrators retain the
ability to bypass it deliberately. Do not enable auto-merge for major updates.

```sh
# Requires gh authentication and repository admin rights; public repositories only.
pnpm configure:github
```

## Run the checks locally

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm test:package
pnpm test:docker
pnpm audit --audit-level high
pnpm audit --prod --audit-level high
```

`test:package` extracts a fresh archive, installs the frozen workspace and builds
both services; it compares every template/icon with build output.
`test:docker` needs a running Docker engine. It generates its own Compose file,
configuration, synthetic media and password in a temporary directory, uses unique
container names and a random loopback port, and uses disposable database/artwork
volumes. It never uses production mounts or credentials. It exercises actual
scheduled discovery/import, page/feed/media serving, admin reports, invalid and
missing records, unchanged rescans, alias/tag refresh, missing-cache repair, and
deleted episode/series/artwork cleanup. It prints logs on failure and removes
containers, networks and volumes on exit. Images/build cache may remain locally.
This test covers the HTTP upstream; live Nginx account/isolation checks remain
part of deployment verification.

## Publish a release

Update all four `package.json` versions together and review/merge the changes.
Then create and push a matching stable tag, for example:

```sh
git tag v2.0.0
git push origin v2.0.0
```

The workflow publishes `majorpodo.tar.gz` and `majorpodo.tar.gz.sha256` only after
CI and archive checks pass. It does not deploy or modify the production server.
After downloading both files from that release, verify:

```sh
sha256sum -c majorpodo.tar.gz.sha256
```

A checksum detects corruption; verify that it came from the intended GitHub
Release. Follow [SETUP.md](../SETUP.md) for transfer, fresh release extraction,
configuration and deployment. Failed workflows can be inspected and rerun from
the Actions tab. Reusing an existing tag/release is intentionally not automatic.
