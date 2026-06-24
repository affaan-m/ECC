# ECC v2.0.0-rc.1 Quickstart

This path is for a new contributor who wants to verify the release surface before touching feature work.

## Clone

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
```

Start from a clean checkout. Do not copy private operator state, raw workspace exports, tokens, or local Hermes files into the repo.

## Install

```bash
npm ci
```

This installs the Node-based validation and packaging toolchain used by the public release surface.

To install the rc.1 package from npm instead of working from a checkout:

```bash
npm install ecc-universal@next
```

`next` currently resolves to `ecc-universal@2.0.0-rc.1`; `latest` remains on
`1.10.0` during the release-candidate window.

## Verify

```bash
node tests/run-all.js
```

Expected result: every test passes with zero failures. For release-specific drift, run the focused check:

```bash
node tests/docs/ecc2-release-surface.test.js
```

Then check the local observability surface:

```bash
npm run observability:ready
```

This runs the [observability readiness gate](../../architecture/observability-readiness.md)
for loop status, session traces, harness audit, and ECC2 tool-risk logs.

## First Skill

Read `skills/hermes-imports/SKILL.md` first.

It shows the intended ECC 2.0 pattern:

- take a repeated operator workflow
- remove credentials, private paths, raw workspace exports, and personal memory
- keep the durable workflow shape
- publish the sanitized result as a reusable `SKILL.md`

Do not start by importing a private Hermes workflow wholesale. Start by distilling one reusable skill.

## Switch Harness

Use the same skill source across harnesses:

- Claude Code consumes ECC through the Claude plugin and native hooks.
- Codex consumes ECC through `AGENTS.md`, `.codex-plugin/plugin.json`, and MCP reference config.
- OpenCode consumes ECC through the OpenCode package/plugin surface.

The portable unit is still `skills/*/SKILL.md`. Harness-specific files should load or adapt that source, not redefine the workflow.

## Next Docs

- [Hermes setup](../../HERMES-SETUP.md)
- [Cross-harness architecture](../../architecture/cross-harness.md)
- [Release notes](release-notes.md)
