# ECC Cross-Harness Compatibility Matrix (#3181)

| Harness | Skills | Agents | Lifecycle Hooks | MCP Config | Delegation |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Full | Full (72) | Full (`hooks/hooks.json`) | Full | Full (`Task`) |
| Codex CLI | Full (`./skills/`) | TOML / AGENTS | SessionStart (`codex-hooks.json`) | Full (`config.toml`) | Worker scripts |
| OpenCode 2.x | Config root | Registered JSON agents | V2 Plugin (`ecc-hooks.ts`) | Full | Subagents |
| Cursor | `.cursor/` | `.cursor/` | Cursor hook dispatchers | Merge JSON | Partial |
| Antigravity | `.agents/skills/` | `.agents/agents/` | Partial / policy | Merge JSON | Workflows |
| Gemini CLI | `.gemini/` | Adapted frontmatter | Policy-filtered | Supported | Workflows |
| Qwen Code | Extension / home | `qwen-adapt-agents` | None | Supported | Partial |

Run `node scripts/platform-audit.js --matrix` for machine-readable output.
