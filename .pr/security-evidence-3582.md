# Security Evidence — PR #3582

Change under review: `.github/workflows/npmscan.yml` (new, warn-only dependency check).

Disclosure: the PR author maintains npmscan.com and `NPMscan/npmscan-action`.

## Changed security-sensitive surface
- One new workflow on `pull_request`. Not `pull_request_target`, no secrets referenced.
- Runs only when `package.json`, `package-lock.json` or `yarn.lock` changes.
- Permissions: `contents: read` for the workflow; the job adds `pull-requests: write` only to post
  or update one report comment. Fork PRs get a read-only token, so there the report stays in the
  job summary and annotations.
- `actions/checkout` pinned to the same v7.0.1 SHA as `ci.yml`, with `persist-credentials: false`.
- `NPMscan/npmscan-action` pinned to the v1.4.0 commit SHA. It is a composite action: one bash
  script and a jq template, no bundled JS.
- `timeout-minutes: 20`, `concurrency` of one run per PR.

## Data that leaves the runner
- The changed files among `package.json`, `package-lock.json` and `yarn.lock`, base and PR
  versions, over HTTPS to `https://npmscan.com/api/analysis/dependency-diff`. Unchanged files are
  skipped without a request.
- Only the selected dependency files are intentionally transmitted. Values embedded in them, including registry URLs and scripts, are part of that payload. Environment variables and the GitHub token are not intentionally included. The workflow rejects symlinks and other non-regular checkout inputs before the external action runs.
- npmscan then looks up the changed package names and versions on the public npm registry and
  OSV.dev.

## Threat model (bounded)
- **The scan can't run** (runner network error, rate limit, file over 8 MB, npmscan.com
  unreachable): the job reports a warning and stays green (`fail-on-error: false`). A request that
  never gets an answer gives up within about 4.5 minutes, so even three changed files finish well
  inside the 20-minute timeout (12m47s in the recorded run).
- **Noise:** runs only on dependency-file changes and comments only when something is flagged
  (`comment: on-findings`). Clean runs leave only the job summary and two "unchanged, nothing to
  scan" notices.
- **Override changes are flagged on purpose.** An `overrides` / `resolutions` change can repoint a
  dependency, so a routine fix that edits overrides (like 01b0202) gets warnings too.
- **What it does not add:** known advisories for packages a PR doesn't touch. `npm audit` in
  `supply-chain-watch.yml` and the IOC scan stay the source for that.
- **Removal:** delete this one workflow file.

## What reviewers see (recorded runs)

All runs are on a fork, against ECC's own `package.json`, `package-lock.json` and `yarn.lock` as of
`0cd5418`, with only this workflow enabled.

| Case | Change | Result | Comment | Warning annotations | Run |
|---|---|---|---|---|---|
| Typical skill PR | one new `files` entry in `package.json` | pass green | none | none | [run](https://github.com/salemalem/ECC/actions/runs/39522250264) |
| Swapped checksum | `ms@2.1.3` keeps its version, new `yarn.lock` checksum | pass green | yes | `ms 2.1.3 → 2.1.3: tarball source/integrity changed` | [run](https://github.com/salemalem/ECC/actions/runs/39522254626) |
| New root script | `"postinstall": "node scripts/setup.js"` | pass green | yes | `Root postinstall script added: node scripts/setup.js` | [run](https://github.com/salemalem/ECC/actions/runs/39522259083) |
| Scan can't run | same as the real update, API pointed at an address that never answers | pass green after 12m47s | yes: "warning: The scan could not run", one `Scan failed` block per file | per file: `npmscan scan failed`, `package.json: npmscan API returned HTTP 000: curl: (28) Connection timed out after 120002 milliseconds (not blocking: fail-on-error is false)` | [run](https://github.com/salemalem/ECC/actions/runs/39522263215) |
| Real update | `01b0202` (2026-10-10 advisory fixes) | pass green | yes | 4 override changes; `markdown-it 14.3.0 → 14.3.1: HIGH vulnerability (3 advisories)` | [run](https://github.com/salemalem/ECC/actions/runs/39522245601) |

A finding and a failed scan are both warnings, with different titles: findings name the package or
script, and a failed scan reads `npmscan scan failed`, with the reason, and is labelled not blocking.

The real update flags `markdown-it@14.3.1` because advisories GHSA-gfr2-rv44-r23c and
GHSA-r7fv-28h4-cvq7 (both HIGH) were published on 2026-10-20, after that commit. `14.3.3` fixes both.
