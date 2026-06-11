# Kiro Adapter Guide

ECC ships first-class support for [Kiro](https://kiro.dev) as an install target,
alongside Claude Code, Cursor, Codex, Gemini, OpenCode, Zed, and the others.

The Kiro surface lives in `.kiro/` and is **generated** from canonical ECC
sources, so it stays in parity with the upstream catalog and never drifts.

## What you get

| Kiro surface | Source | Count |
| --- | --- | --- |
| Agents (`.kiro/agents/*.md` + `*.json`) | `agents/*.md` | 64 |
| Skills (`.kiro/skills/<id>/SKILL.md`) | `skills/<id>/` | 262 |
| Steering (`.kiro/steering/*.md`) | `rules/<ns>/*.md` | 103 |
| IDE hooks (`.kiro/hooks/*.kiro.hook`) | curated Kiro-native templates | 13 |
| MCP example (`.kiro/settings/mcp.json.example`) | `mcp-configs/mcp-servers.json` | 32 servers |

- **Agents** are emitted in both formats: Markdown for the Kiro IDE and JSON for
  `kiro-cli` (`/agent swap`). ECC tool hints are mapped to Kiro `allowedTools`
  (read-only tools → `fs_read`, write tools → `fs_write`, `Bash` → `execute_bash`).
- **Skills** use the identical `SKILL.md` format, so they are copied verbatim.
- **Steering** files receive injected frontmatter: `common` rules are always-on
  (`inclusion: auto`); language rules load on matching files
  (`inclusion: fileMatch` + `fileMatchPattern`).

## Install

```bash
# Project-local install into ./.kiro/
./install.sh --profile minimal --target kiro
```

```powershell
.\install.ps1 --profile minimal --target kiro
```

The installer is non-destructive and mirrors the committed `.kiro/` tree into
your project. Open the project in Kiro and:

- Steering files with `auto` inclusion load automatically.
- Skills are available via the `/` menu in chat.
- Agents are selectable in the IDE or via `/agent swap` in `kiro-cli`.
- Toggle IDE hooks in the Agent Hooks panel.
- Copy desired servers from `.kiro/settings/mcp.json.example` to
  `.kiro/settings/mcp.json`.

## Regenerating the adapter (maintainers)

After editing canonical sources (`agents/`, `skills/`, `rules/`, `mcp-configs/`),
regenerate the committed `.kiro/` tree:

```bash
node scripts/generate-kiro-adapter.js          # regenerate in place
node scripts/generate-kiro-adapter.js --check  # CI: fail if out of sync
```

## Known drift from upstream ECC

Like the Codex and Gemini adapters, the Kiro adapter documents where the host
harness differs from Claude Code:

- **No native slash-command surface.** ECC `commands/` are not installed as Kiro
  slash commands; the equivalent workflows are available as skills and steering.
- **Hooks are Kiro-native.** Kiro IDE hooks use the `askAgent` / `runCommand`
  model rather than Claude Code's plugin-bootstrap command hooks, so they are
  maintained as curated `.kiro.hook` templates rather than translated from
  `hooks/hooks.json`.

## Verification

```bash
node tests/lib/install-targets.test.js     # target registration + planning
node tests/lib/kiro-generate.test.js       # generator behavior
node scripts/generate-kiro-adapter.js --check
npm run harness:adapters -- --check        # compliance scorecard
```
