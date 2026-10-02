# ECC 2.2.2

ECC 2.2.2 adds `pi/core`, a curated Pi-native skills+prompts-only profile built for
downstream packagers that mirror GitHub Releases, plus a set of packaging, memory,
hooks, and Windows compatibility fixes.

## Pi core profile

`pi/core/` is a self-contained package (`ecc-pi-core`) that mirrors of the release
tarball can copy directly: no build step, no extensions, no hooks, no runtime
downloads, and no network or SaaS dependencies.

- 123 curated skills (language and framework patterns, testing/TDD, code review,
  non-offensive security review, planning, refactoring, docs, and git/PR workflows)
  and 24 prompt commands that are pure prompt workflows.
- Generated deterministically from the explicit include/exclude lists in
  `manifests/pi-core.json` by `scripts/build-pi-core.js` and committed, so the
  release tarball contains it verbatim. `pi/core/CURATION.md` lists every excluded
  skill and command with its reason; the `council` skill ships as `ecc-council`
  inside pi/core to avoid catalog name clashes.
- The build fails on safety violations: non-allowlisted URL hosts, pipe-to-shell
  or fetch-and-run download forms, secrets or tokens, absolute per-user home
  paths, symlinks, invalid SKILL.md frontmatter, and duplicate skill names.
- CI rebuilds pi/core on every PR and verifies it is up to date, then installs
  the Pi coding agent CLI and proves the profile loads fully offline
  (`PI_OFFLINE=1`), asserting that every curated command actually registers.
- The release workflow additionally verifies that `VERSION` matches the tag and
  that pi/core is current before publishing.

Downstream consumption: poll `/releases`, download
`archive/refs/tags/vX.Y.Z.tar.gz`, pin its sha256, copy `pi/core/`, and load it
offline with `pi --offline --skill pi/core/skills --prompt-template pi/core/commands`.

## Packaging

- The compiled OpenCode payload is explicitly included in the npm package, and
  packing is verified from a clean state with lifecycle scripts enabled.

## Memory and MCP

- Incomplete memory reads are distinguished from missing records, and directory
  traversal failures are classified.
- The reserved `_meta` parameter is accepted on memory MCP ping requests.

## Hooks and Windows compatibility

- `hooks.json` stays within Claude Code's schema; stable hook metadata moved into
  a validated sidecar.
- The no-verify guard handles stuck optional values and long-option prefixes.
- Windows linter paths and ESLint 9 are supported, and settings updates tolerate
  missing Windows device IDs while retaining full-precision inode checks.

## Workflow guidance, catalog, and dependency security

- Epic sync filters issues by label; dependency bumps no longer document
  auto-merge; naming and Boolean guidance is language-neutral; the `prp-pr`
  command alias is distinguished; Rails skill discovery, invoice tax calculation
  order, and framework documentation were corrected; Serply and Squish catalog
  entries were removed.
- `lru` updated to 0.18.2 (RUSTSEC-2026-0253) and `js-yaml` to 4.3.2
  (GHSA-2883-xcg3-v3hh).
