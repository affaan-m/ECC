# ECC on Devin

Status: experimental native plugin.

ECC ships a Devin plugin manifest at `.devin-plugin/plugin.json`. Devin reads this manifest before `.claude-plugin/plugin.json`, so the Claude Code plugin and the other harness adapters are unaffected.

## Install

From the Devin CLI (personal scope by default; add `--local` to limit it to the current machine):

```bash
devin plugins install affaan-m/ECC
```

From the Devin web app: **Customize > Plugins > Add plugin > From repository**, then enter `affaan-m/ECC`.

To try a fork or branch, pass its `owner/repo` or git URL instead.

## What Devin loads

| Component | Source | Notes |
|---|---|---|
| Manifest | `.devin-plugin/plugin.json` | Plugin name `ecc`; version kept in sync by `scripts/release.sh` |
| Skills | `skills/<name>/SKILL.md` | The full canonical catalog |
| Subagents | `agents/<name>.md` | Exposed as `ecc:<name>`, matching the names used in skills and `AGENTS.md`. Devin loads plugin subagents only in local agents (CLI and Desktop), not cloud sessions |
| Always-on rule | Root `AGENTS.md` | Same shared guidance other harnesses read |
| MCP servers | Root `.mcp.json` | The pinned `chrome-devtools` server; requires `npx` and network access on first use |

## Not wired

- **Hooks:** ECC hooks live in `hooks/` and target Claude Code and other harness formats. Devin reads a root `hooks.json`, which ECC does not ship.
- **Legacy command shims:** `commands/` has no Devin plugin surface. The `orch-*` and other workflow skills cover the same flows.
- **Rules:** `rules/` packs use Claude-style `paths:` frontmatter. Copy the packs you want into a project's `.devin/rules/` and adapt the frontmatter if needed.

## Known limitations

- Agent frontmatter declares Claude Code tool names in `tools:` and Claude model aliases in `model:`. Devin treats `tools` as an alias of its `allowed-tools` allowlist, so these values may restrict or be ignored by Devin subagents. This is unverified; report results in an issue.
- Skills that reference Claude-only surfaces (`Agent(...)`, `~/.claude/...`, slash commands, hook profiles) still describe a usable method, but the agent has to map those steps to Devin's tools.
- The full catalog is large. If context footprint matters, prefer a fork that narrows `skills` in the manifest to the paths you need.
