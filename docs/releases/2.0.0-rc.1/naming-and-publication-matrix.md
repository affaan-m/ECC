# ECC v2.0.0-rc.1 Naming And Publication Matrix

Snapshot date: 2026-05-19. Publication state refreshed 2026-05-26 after the
GitHub prerelease and npm `next` readbacks succeeded.

This matrix records the rc.1 identity after the public repository rename to
`affaan-m/ECC`. It is evidence for planning, not a publication action.

## Decision

For `v2.0.0-rc.1`, ship the public identity as **ECC**.

Use `affaan-m/ECC` as the canonical GitHub repo and `ECC` as the product name
in copy, plugin slugs, status surfaces, diagrams, and release collateral. Keep
the npm package and package entry points as `ecc-universal` until a separate
post-rc migration plan exists.

Reason:

- the current install surface already works as `ecc-universal` plus the `ecc`
  plugin slug;
- the exact npm package name `ecc` is already occupied by an unrelated elliptic
  curve cryptography package;
- `affaan-m/ECC` is the live public GitHub repo;
- Claude and Codex plugin surfaces are already short enough as `ecc`;
- rc.1 should prove the release, plugin, and publication pipeline before any
  npm/package rename.

## Current Values

| Surface | Current value | Evidence command | Current result | Release decision |
| --- | --- | --- | --- | --- |
| Product display name | `ECC` | `rg -n "^# ECC\|displayName.*ECC\|affaan-m/ECC" README.md .codex-plugin/plugin.json docs/releases/2.0.0-rc.1` | Present across README, plugin manifests, release copy, and URL ledger | Keep for rc.1 and GA |
| GitHub repo | `affaan-m/ECC` | `git remote get-url origin` | `https://github.com/affaan-m/ECC.git` | Keep for rc.1 and GA |
| npm package | `ecc-universal` | `node -p "require('./package.json').name"` | `ecc-universal` | Keep for rc.1 |
| npm package version | `2.0.0-rc.1` local, `1.10.0` registry latest, `2.0.0-rc.1` registry next | `node -p "require('./package.json').version"` and `npm view ecc-universal name version dist-tags --json` | Local rc.1 is ready; registry latest remains `1.10.0`; `next` points to `2.0.0-rc.1` | Keep rc on `next`, not `latest` |
| Exact npm short name | `ecc` | `npm view ecc name version description repository.url --json` | Occupied by `ecc@0.0.2`, "Elliptic curve cryptography functions." | Do not use |
| Scoped npm short name | `@affaan-m/ecc` | `npm view @affaan-m/ecc name version --json` | Registry 404 | Possible future scoped package if npm scope policy permits |
| Former package name | `everything-claude-code` | `npm view everything-claude-code name version dist-tags --json` | Registry reports unpublished on 2026-02-07 | Do not revive for rc.1 |
| Claude plugin slug | `ecc` | `node -p "require('./.claude-plugin/plugin.json').name"` | `ecc` | Keep |
| Claude plugin version | `2.0.0-rc.1` | `claude plugin validate .claude-plugin/plugin.json`; `claude plugin tag .claude-plugin --dry-run` | Validation passed on Claude Code `2.1.143`; dry run would create `ecc--v2.0.0-rc.1` | Ready for release-tag gate |
| Claude marketplace entry | `ecc` | `.claude-plugin/marketplace.json`; `claude plugin marketplace add --help`; Anthropic plugin marketplace docs | Version and repo point at current rc.1 surface; GitHub, git URL, remote marketplace JSON, and local path marketplace sources are supported | Keep |
| Codex plugin slug | `ecc` | `node -p "require('./.codex-plugin/plugin.json').name"` | `ecc` | Keep |
| Codex plugin version | `2.0.0-rc.1` | `node tests/plugin-manifest.test.js`; `node tests/docs/ecc2-release-surface.test.js` | Plugin manifest passed 54/54; release surface passed 21/21 on Codex CLI `0.131.0` | Ready for Codex marketplace/manual marketplace gate |
| Codex repo marketplace | `ecc` | `.agents/plugins/marketplace.json`; `codex plugin marketplace add --help`; OpenAI Codex plugin docs | Repo marketplace add supports GitHub shorthand, Git URLs, SSH URLs, local roots, `--ref`, and `--sparse`; local and GitHub-ref temp-home add smokes passed | Use as rc.1 Codex distribution path |
| OpenCode package | `ecc-universal` | `node -p "require('./.opencode/package.json').name"` | `ecc-universal` | Keep |
| OpenCode build | Generated package output | `npm run build:opencode` | Passed | Ready for package dry-run gate |
| npm pack surface | Reduced runtime package | `NPM_CONFIG_USERCONFIG=/dev/null npm pack --dry-run --json` | Produced `ecc-universal-2.0.0-rc.1.tgz`, 2228 entries, 4,348,504 bytes packed, 13,024,929 bytes unpacked | Needs final release-commit rerun |

## Publication Paths

| Path | Current evidence | Required next action | Blocker |
| --- | --- | --- | --- |
| GitHub release | `v2.0.0-rc.1` prerelease is live at <https://github.com/affaan-m/ECC/releases/tag/v2.0.0-rc.1> | Keep release notes aligned with the URL ledger; rerun evidence before any follow-up release edit | Remaining plugin, video, billing, and outbound URLs still gated |
| npm | `ecc-universal@2.0.0-rc.1` is live on `next`; registry latest remains `1.10.0` | Keep rc on `next`; do not move `latest` before GA approval | Remaining plugin, video, billing, and outbound URLs still gated |
| Claude plugin | `claude plugin validate .claude-plugin/plugin.json` passed; `claude plugin tag --help` confirms the release tag flow creates `{name}--v{version}` tags and can push them | Run `claude plugin tag .claude-plugin --dry-run` from the clean release commit, then tag/push only after release approval | No plugin release tag created in this pass |
| Claude marketplace | `.claude-plugin/marketplace.json` points at `ecc` and the public repo | Verify marketplace update/install path after tag exists | External marketplace propagation not verified |
| Codex plugin | `codex plugin marketplace` supports local and Git marketplace sources; `.codex-plugin/plugin.json` is present; `.agents/plugins/marketplace.json` exposes `ecc` from the repo root; temp-home local and GitHub-ref marketplace adds passed | Publish rc.1 docs with the repo-marketplace command, then monitor OpenAI's official Plugin Directory path | Do not claim official Plugin Directory listing before OpenAI submission evidence |
| OpenCode package | `.opencode/package.json` builds from source and ships inside npm package | Re-run `npm run build:opencode` and package dry-run from release commit | OpenCode CLI 1.2.21 does not expose a separate plugin publication command in this pass |
| ECC Tools billing claim | README and launch copy mention ECC Tools / marketplace context | ECC-Tools #89/#90/#91 add selected-target billing readback, selected-target announcement gating, and ignored `--env-file` support; #92 adds the non-breaking operator bearer path; #93 records the live selected-target gate pass | Billing evidence ready; repeat the live selected-target gate before any payment announcement |
| Social and longform copy | X thread, LinkedIn copy, article outline, GitHub release copy exist | Replace stale URLs and publish only after the remaining plugin/video/billing/outbound gates are approved | GitHub prerelease and npm URLs are live; plugin, video, billing, and outbound URLs are not final |

## ITO-46 Blocker Register

| Channel | Current status | Required metadata/evidence | Owner | Blocker or follow-up |
| --- | --- | --- | --- | --- |
| GitHub release | Live prerelease at <https://github.com/affaan-m/ECC/releases/tag/v2.0.0-rc.1> | Tag, release URL, prerelease flag, final release notes, URL ledger | Release owner | Keep release edits behind final evidence and owner approval |
| npm | `ecc-universal@2.0.0-rc.1` is published on `next`; registry latest is `1.10.0` | Pack summary, publish readback, `next` dist-tag readback, registry signature evidence | Package owner | Do not move rc.1 to `latest` before GA approval |
| Short npm name | `ecc` is occupied; `@affaan-m/ecc` returns 404 | Name availability outputs and migration plan | Release owner | Keep `ecc-universal` for rc.1; scoped rename is post-rc only |
| Claude plugin | `ecc@2.0.0-rc.1` validates; tag dry run would create `ecc--v2.0.0-rc.1` | `claude plugin validate .`, `claude plugin tag .claude-plugin --dry-run`, marketplace install/update smoke | Plugin owner | Real tag push and marketplace propagation require release approval |
| Claude marketplace | Docs and CLI support GitHub, git URL, remote marketplace JSON, and local path sources | Public repo marketplace JSON, support/contact metadata, post-tag install smoke | Plugin owner | No external official listing has been submitted in this pass |
| Codex repo marketplace | Local and GitHub-ref temp-home marketplace add smokes passed on Codex CLI `0.131.0` | `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, repo/personal marketplace evidence | Plugin owner | Official Plugin Directory listing requires OpenAI submission/listing evidence |
| Codex official Plugin Directory | OpenAI docs describe the curated official directory; ECC has not submitted or received listing evidence | Directory submission link or OpenAI approval path once available | Plugin owner | Track as an ITO-56/ITO-46 follow-up; do not claim an official listing |
| OpenCode package | `npm run build:opencode` passed | Built `.opencode` package metadata inside npm tarball | Package owner | No separate public plugin channel identified; follows npm |
| Billing/native payments | Marketplace Pro target readback, selected-target announcement preflight, env-file operator path, non-breaking operator bearer, and live selected-target gate have passed | 2026-05-20 selected-target readback, webhook provenance, selected-target announcement gate, ECC-Tools #91 `--env-file` support, ECC-Tools #92 operator bearer, ECC-Tools #93 live gate evidence | ECC Tools owner | Repeat the live gate immediately before rc.1 announcement; final copy still waits on release/plugin/live URL approvals |
| Social/longform copy | Drafts exist; GitHub and npm links are live | Final live GitHub, npm, Claude, Codex, video, and billing URLs | Release owner | Publish only after remaining plugin/video/billing/outbound approvals exist |

## Package Rename After rc.1

If the package layer moves from `ecc-universal` toward a shorter npm surface
after rc.1, do it as a staged migration:

1. Keep `ecc-universal` as the npm package until a replacement package has a
   verified owner, deprecation plan, and install migration.
2. Keep `affaan-m/ECC` as the canonical repo for public docs, release notes,
   plugin marketplace entries, npm metadata, and external links.
3. Reserve or create any new npm/package surfaces before announcing the
   package rename.
4. Ship a compatibility guide that maps old commands, package names, plugin
   slugs, and docs URLs to the new names.

## Evidence Captured In This Pass

```text
git rev-parse HEAD
67e63e63f9bfd074bd6a21bf6bac71f3dfefa58b

node -p "require('./package.json').name + '@' + require('./package.json').version"
ecc-universal@2.0.0-rc.1

node -p "require('./.claude-plugin/plugin.json').name + '@' + require('./.claude-plugin/plugin.json').version"
ecc@2.0.0-rc.1

node -p "require('./.codex-plugin/plugin.json').name + '@' + require('./.codex-plugin/plugin.json').version"
ecc@2.0.0-rc.1

node -p "require('./.opencode/package.json').name + '@' + require('./.opencode/package.json').version"
ecc-universal@2.0.0-rc.1

npm view ecc name version description repository.url --json
ecc@0.0.2 is occupied by an unrelated elliptic curve cryptography package.

npm view ecc-universal name version dist-tags --json
registry latest is 1.10.0; next is 2.0.0-rc.1.

npm view ecc-universal@2.0.0-rc.1 name version dist.tarball dist.integrity time --json
registry returned version 2.0.0-rc.1, the rc tarball URL, and published time
2026-05-26T00:36:22.940Z.

claude plugin validate .claude-plugin/plugin.json
Validation passed on Claude Code 2.1.143.

claude plugin validate .
Validation passed with one warning: root CLAUDE.md is not loaded as plugin
context; ship plugin context through skills instead.

claude plugin tag .claude-plugin --dry-run
Would create and push tag ecc--v2.0.0-rc.1.

node tests/docs/ecc2-release-surface.test.js
21 release-surface checks passed.

node tests/plugin-manifest.test.js
54 plugin-manifest checks passed.

npm run build:opencode
Passed.

npm pack --dry-run --json
Produced ecc-universal-2.0.0-rc.1.tgz, 2228 entries, 4,348,504 bytes
packed, and 13,024,929 bytes unpacked.

npm publish --tag next --dry-run
Dry run would publish ecc-universal@2.0.0-rc.1 to npm with tag next.

codex plugin marketplace add --help
Supports GitHub shorthand, HTTP(S) Git URLs, SSH URLs, local marketplace roots,
--ref, and Git-only --sparse.

HOME="$(mktemp -d)" codex plugin marketplace add <local-checkout>
Added marketplace ecc and recorded the installed marketplace root as
<local-checkout> without touching the real Codex config.

HOME="$(mktemp -d)" codex plugin marketplace add affaan-m/ECC --ref "$(git rev-parse HEAD)"
Added marketplace ecc from the GitHub repo pinned to
67e63e63f9bfd074bd6a21bf6bac71f3dfefa58b without touching the real Codex
config.
```
