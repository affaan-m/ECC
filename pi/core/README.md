# ecc-pi-core

A curated, Pi-native profile of ECC (Everything Claude Code): 123 portable
engineering skills and 24 pure prompt-workflow commands, with no extensions,
no hooks, no runtime downloads, and no network or SaaS dependencies.

## Contents

- `skills/` - language, framework, testing/TDD, code review, security review,
  planning, refactoring, docs, and git/PR workflow skills.
- `commands/` - prompt commands that are pure prompt workflows.
- `CURATION.md` - every excluded skill and command with its reason.

## Use

Copy this directory into your project (or pin a release tarball) and load it with the
Pi coding agent:

```sh
pi --no-extensions --extension pi/core
```

From the ECC repository root, run the offline load test used in CI
(requires the Pi CLI on PATH):

```sh
node scripts/ci/pi-core-load-test.js
```

The test loads skills and prompt templates explicitly, sends the RPC
`get_commands` request, and verifies that all 24 curated commands load.

## Regenerate

`pi/core` is generated from `manifests/pi-core.json` and committed so release
tarballs contain it verbatim. After changing the manifest or any included source
content, run:

```sh
node scripts/build-pi-core.js
```

and commit the result. CI verifies the committed profile is up to date.
