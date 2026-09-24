# ECC 2.2 launch and rollback runbook

Affaan is the only release operator for ECC 2.2. Everyone else may prepare,
review, and verify the release candidate, but must not merge the release PR,
create or push `v2.2.0`, change npm dist-tags, or publish the GitHub Release.

## Availability model

The default npm install remains `ecc-universal@2.1.0` until the final promotion
step succeeds. The release workflow publishes 2.2.0 under the `staged` tag,
reads its registry integrity back, compares those bytes with the exact archive
that passed the three-platform lifecycle, and only then moves `latest` to
2.2.0. There is no interval where `latest` points at an unpublished version.

The native Claude marketplace install remains an independent install path
throughout the npm rollout:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

Never unpublish 2.1.0 or 2.2.0. npm dist-tags provide the reversible switch.

## Current fallback baseline

Before merge, confirm all of these:

```bash
npm view ecc-universal dist-tags --json
npm view ecc-universal@2.1.0 dist.integrity
curl -fsSIL https://registry.npmjs.org/ecc-universal/-/ecc-universal-2.1.0.tgz
gh release view v2.1.0 --repo affaan-m/ECC
```

Expected:

- `latest` is `2.1.0`.
- The 2.1.0 tarball returns HTTP 200 and immutable caching headers.
- A clean `npm install ecc-universal@2.1.0` succeeds.
- A disposable managed install and uninstall succeed.

The published 2.1 Cursor adapter can report one non-blocking doctor warning for
an adapted Markdown link. This does not prevent installation or uninstall. ECC
2.2 corrects the packed lifecycle and doctor behavior.

## Preflight before Affaan merges

1. PR #2863 must be mergeable and all required hosted checks must pass.
2. The full local suite, npm audit, IOC scan, and exact packed lifecycle must
   pass at the PR head.
3. The packed README must describe 2.2 as available and contain no unpublished
   2.2 warning.
4. The Nasiko surface must say experimental CLI lifecycle bridge.
5. `npm view ecc-universal@2.2.0 version` must return E404. Any other registry
   error blocks the release.
6. `npm view ecc-universal dist-tags --json` must still show `latest: 2.1.0`.

## The release switch

After Affaan merges PR #2863, wait for CI on the exact `origin/main` commit.
From a clean, current `main` checkout:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

The two commit IDs must match and `git status --short` must print nothing.
Affaan then creates and pushes the signed release tag:

```bash
git tag -s v2.2.0 -m "ECC 2.2.0" HEAD
git tag -v v2.2.0
git push origin refs/tags/v2.2.0
```

That tag push is the only launch switch. The workflow then:

1. Requires the tag commit to equal `origin/main`.
2. Packs and hashes the npm archive once.
3. Runs the exact archive on Linux, macOS, and Windows.
4. Publishes the archive to the npm `staged` tag.
5. Reads back and verifies registry integrity.
6. Atomically promotes the verified version to `latest`.
7. Creates the GitHub Release from the reviewed notes.

## Immediate canary

After the workflow succeeds:

```bash
npm view ecc-universal dist-tags --json
npm view ecc-universal@2.2.0 version dist.integrity
gh release view v2.2.0 --repo affaan-m/ECC
npx --yes ecc-universal@2.2.0 setup --help
npx --yes ecc-universal@latest setup --help
```

Expected:

- Both exact-version and `latest` resolve to 2.2.0.
- Registry integrity matches the workflow output.
- The GitHub Release exists and uses the reviewed notes.
- Both package invocations return the guided setup help.
- The native Claude marketplace remains installable.

Keep watching npm and GitHub install paths during the launch window. Treat an
HTTP failure, integrity mismatch, missing public binary, or failed disposable
install as critical.

## Rollback

If 2.2.0 has an install-critical regression, Affaan or another authorized npm
owner restores the known installable fallback immediately:

```bash
npm dist-tag add ecc-universal@2.1.0 latest
npm view ecc-universal dist-tags --json
ECC_ROLLBACK_ROOT=$(mktemp -d)
npm install --ignore-scripts --prefix "$ECC_ROLLBACK_ROOT" ecc-universal@2.1.0
node "$ECC_ROLLBACK_ROOT/node_modules/ecc-universal/scripts/ecc.js" --help
gh release edit v2.1.0 --repo affaan-m/ECC --latest
```

Then open a release incident, state that 2.2.0 remains available only by exact
version while the incident is investigated, and repair forward with a new patch
version. Do not unpublish either package version and do not reuse the `v2.2.0`
tag.
