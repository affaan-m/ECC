# ECC 2.2.1 signed patch release runbook

Only an authorized maintainer may create or push the `v2.2.1` tag, change npm
dist-tags, or publish the GitHub Release.

## Availability model

The default npm install remains `ecc-universal@2.2.0` until the final promotion
step succeeds. The release workflow publishes `2.2.1` under the `staged` tag,
reads its registry integrity back, compares those bytes with the exact archive
that passed the three-platform lifecycle, and only then moves `latest` to
`2.2.1`.

The native Claude marketplace install remains an independent install path
throughout the npm rollout:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

Never unpublish `2.2.0` or `2.2.1`. npm dist-tags provide the reversible
switch.

## Historical exception

`v2.2.0` is already public and must stay immutable, even though
`git tag -v v2.2.0` returns `error: no signature found`. ECC-031 closes that
provenance gap by shipping a new signed patch release. Do not move, recreate, or
reuse `v2.2.0`.

## Preflight before the tag

1. The `2.2.1` version-prep PR must be merged.
2. CI and CodeQL on the exact merged `main` commit must be green.
3. `HEAD`, `origin/main`, and the intended release commit must all match.
4. `npm view ecc-universal@2.2.1 version` must return `E404`. Any other
   registry error blocks the release.
5. `npm view ecc-universal dist-tags --json` must still show `latest: 2.2.0`.
6. The release operator must have a locally available signing identity before
   creating the tag.

## The release switch

From a clean, current `main` checkout on the exact green prep commit:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

The commit IDs must match and `git status --short` must print nothing. The
authorized maintainer then creates and verifies the signed release tag:

```bash
git tag -s v2.2.1 -m "ECC 2.2.1" HEAD
git tag -v v2.2.1
git push origin refs/tags/v2.2.1
```

That tag push is the only release switch. The workflow then:

1. Requires the tag commit to equal `origin/main`.
2. Packs and hashes the npm archive once.
3. Runs the exact archive on Linux, macOS, and Windows.
4. Publishes the archive to the npm `staged` tag with provenance.
5. Reads back and verifies registry integrity.
6. Atomically promotes the verified version to `latest`.
7. Creates the GitHub Release from the reviewed notes.

## Immediate canary

After the workflow succeeds:

```bash
npm view ecc-universal dist-tags --json
npm view ecc-universal@2.2.1 version dist.integrity
gh release view v2.2.1 --repo affaan-m/ECC
npx --yes ecc-universal@2.2.1 setup --help
npx --yes ecc-universal@latest setup --help
```

Expected:

- both exact-version and `latest` resolve to `2.2.1`;
- registry integrity matches the workflow output;
- the GitHub Release exists and uses the reviewed notes;
- both package invocations return the guided setup help;
- the native Claude marketplace path remains installable.

Treat an HTTP failure, integrity mismatch, missing public binary, or failed
disposable install as critical.

## Rollback

If `2.2.1` has an install-critical regression, an authorized npm owner restores
the known installable fallback immediately:

```bash
npm dist-tag add ecc-universal@2.2.0 latest
npm view ecc-universal dist-tags --json
ECC_ROLLBACK_ROOT=$(mktemp -d)
npm install --ignore-scripts --prefix "$ECC_ROLLBACK_ROOT" ecc-universal@2.2.0
node "$ECC_ROLLBACK_ROOT/node_modules/ecc-universal/scripts/ecc.js" --help
gh release edit v2.2.0 --repo affaan-m/ECC --latest
```

Then open a release incident, state that `2.2.1` remains available only by
exact version while the incident is investigated, and repair forward with a new
patch version. Do not unpublish either package version and do not reuse the
`v2.2.1` tag.
