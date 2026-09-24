# ECC Signed Patch Release Checklist

Use this when releasing `affaan-m/ECC`, especially for `ECC-031` or any follow-up
where the Git tag identity, npm provenance, GitHub Release, and announcement
evidence all need to align.

## Milestone And Contract

- Milestone: `M0` in the ECC 2.2 release train.
- Contract: ship one exact, verified artifact, keep ECC authority over release
  evidence and canonical state, and do not blur current shipped behavior with
  future plans.
- Current gate: close the unsigned `v2.2.0` exception by releasing a new signed
  `2.2.x` patch from exact green `main`.

## Non-Negotiable Invariants

- Never move, recreate, or reuse `v2.2.0`.
- The new patch tag must be a signed annotated tag on exact green `origin/main`.
- Publish only the archive packed and verified by the release workflow.
- Treat any non-`E404` npm lookup failure as blocking.
- Do not manually promote `latest`, replace release assets, or publish different
  bytes under the same version.
- Keep Itô and Nasiko wording bounded to shipped behavior only.

## ECC-031 State To Refresh Before Mutating

As of 2026-08-31:

- `v2.2.0` is live and latest, but `git tag -v v2.2.0` returns
  `error: no signature found`.
- `main` currently points at `a104765bf20fd1480a3dd30f514f18f73ca80b8a`.
- Exact-main CI run `33429642769` is green.
- Exact-main CodeQL run `33429641766` is green.
- No remote tag, GitHub Release, or npm publication exists for `2.2.1`.
- `package.json` on `main` still declares `2.2.0`, so a reviewed version-prep
  change must land before the signed tag can be pushed.

Refresh those facts before mutating:

```bash
git fetch origin main --tags
git rev-parse origin/main
gh run view 33429642769 --repo affaan-m/ECC --json status,conclusion,url
gh run view 33429641766 --repo affaan-m/ECC --json status,conclusion,url
gh release view v2.2.0 --repo affaan-m/ECC --json tagName,targetCommitish,publishedAt,url
git ls-remote --tags origin 'refs/tags/v2.2.0*'
git tag -v v2.2.0
npm view ecc-universal dist-tags --json
```

## Checklist

### 1. Reconfirm The Release Surface

- Verify the release commit you intend to tag is exact `origin/main`.
- Verify required hosted checks on that exact `main` commit are green.
- Verify no overlapping release-surface PR or hotfix needs to land first.
- Record the exact `main` SHA you are about to build from.

```bash
gh pr list --repo affaan-m/ECC --state open --limit 20
gh run list --repo affaan-m/ECC --branch main --limit 10
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

Stop if:

- `HEAD` differs from `origin/main`;
- any required `main` run is red or still pending;
- a new release-surface merge materially changes the patch contents.

### 2. Choose The Patch Version And Confirm It Is Unused

Expected next version is `2.2.1` unless it already exists.

```bash
VERSION=2.2.1
git ls-remote --tags origin "refs/tags/v${VERSION}*"
gh release view "v${VERSION}" --repo affaan-m/ECC
npm view "ecc-universal@${VERSION}" version
```

Expected:

- no remote tag;
- no GitHub Release;
- npm returns `E404`.

### 3. Prepare The Patch-Release PR

- Branch from exact current `main`.
- Update release metadata to the new patch version.
- Add reviewed release notes under `docs/releases/<version>/release-notes.md`.
- Add a patch runbook under `docs/releases/<version>/launch-runbook.md`.
- Open and merge that prep PR.
- Wait for fresh `main` CI and CodeQL on the merged prep commit.

Important:

- Do **not** use `scripts/release.sh` as-is for `ECC-031`.
- That script still commits, tags, and pushes in one shot, which bypasses the
  required `merge -> exact main CI green -> signed tag push` boundary.
- PAT-backed GitHub access is not enough. The release operator also needs a
  locally available signing identity before creating the tag.

Minimum prep checks:

```bash
node tests/plugin-manifest.test.js
node tests/scripts/build-opencode.test.js
node tests/ci/release-packed-artifact-workflow.test.js
```

### 4. Wait For Exact Main To Turn Green Again

After the prep PR merges, the new `main` commit becomes the only commit you may
tag.

```bash
gh run list --repo affaan-m/ECC --branch main --limit 10
gh run view RUN_ID --repo affaan-m/ECC --json status,conclusion,url
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git rev-parse HEAD
git rev-parse origin/main
```

### 5. Create And Push The Signed Tag

From a clean `main` checkout on the exact green commit:

```bash
VERSION=2.2.1
git fetch origin main --tags
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
git rev-parse origin/main
git tag -s "v${VERSION}" -m "ECC ${VERSION}" HEAD
git tag -v "v${VERSION}"
git push origin "refs/tags/v${VERSION}"
```

Required proof:

- clean worktree;
- `HEAD == origin/main`;
- `git tag -v` succeeds locally before push.

### 6. Watch The Release Workflow

The tag push should trigger `.github/workflows/release.yml`, which must:

1. prove the tag commit equals `origin/main`;
2. validate version and manifests;
3. run IOC and payload checks;
4. pack one archive and record its SHA-256;
5. verify that exact archive on Linux, macOS, and Windows;
6. publish to npm under `staged` with provenance;
7. read back `dist.integrity` and compare it to the tested archive;
8. promote the verified version to `latest`;
9. create the GitHub Release from reviewed notes.

### 7. Perform Mandatory Public Readback And Canaries

After the workflow succeeds:

```bash
VERSION=2.2.1
npm view ecc-universal dist-tags --json
npm view "ecc-universal@${VERSION}" name version dist.integrity --json
gh release view "v${VERSION}" --repo affaan-m/ECC \
  --json tagName,name,isDraft,isPrerelease,publishedAt,url
gh api repos/affaan-m/ECC/releases/latest --jq .tag_name
npx --yes "ecc-universal@${VERSION}" setup --help
npx --yes ecc-universal@latest setup --help
```

Also run the clean install, doctor, repair, uninstall, and rollback canaries
required by the checked-in runbook, and verify the native Claude marketplace
path remains installable:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

### 8. Verify Announcement Delivery

- One `Announcements` Discussion exists for the new tag.
- It uses the GitHub Release body and URL.
- Discord delivery is evidenced by the workflow receipt.
- No duplicate Discussion or Discord message was created.

### 9. Record Evidence And Close Out ECC-031

- Complete the release evidence record with actual SHAs, workflow URLs, release
  URLs, npm integrity, and announcement state.
- Update the dashboard ticket and release docs with the final patch tag and
  proof URLs.
- Keep `v2.2.0` documented as the historical unsigned exception.
- Mark `ECC-031` resolved only after the signed patch release is public and
  every required gate above is backed by evidence.
