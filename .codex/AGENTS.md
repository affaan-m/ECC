# ECC for Codex CLI

This supplements the root `AGENTS.md` with Codex-specific guidance.

For repo navigation, surface ownership, and PR diff packet guidance, read
`docs/CODEX-NAVIGATION-GUIDE.md` after this supplement.

## Model Recommendations

| Task Type | Recommended Model |
|-----------|------------------|
| Routine coding, tests, formatting | GPT 5.5 |
| Complex features, architecture | GPT 5.5 |
| Debugging, refactoring | GPT 5.5 |
| Security review | GPT 5.5 |

## Skills Discovery

Skills are auto-loaded from `.agents/skills/`. Each skill contains:
- `SKILL.md` — Detailed instructions and workflow
- `agents/openai.yaml` — Codex interface metadata

Available skills:
- tdd-workflow — Test-driven development with 80%+ coverage
- security-review — Comprehensive security checklist
- coding-standards — Universal coding standards
- frontend-patterns — React/Next.js patterns
- frontend-slides — Viewport-safe HTML presentations and PPTX-to-web conversion
- article-writing — Long-form writing from notes and voice references
- content-engine — Platform-native social content and repurposing
- market-research — Source-attributed market and competitor research
- investor-materials — Decks, memos, models, and one-pagers
- investor-outreach — Personalized investor outreach and follow-ups
- backend-patterns — API design, database, caching
- e2e-testing — Playwright E2E tests
- eval-harness — Eval-driven development
- strategic-compact — Context management
- api-design — REST API design patterns
- verification-loop — Build, test, lint, typecheck, security
- deep-research — Multi-source research with firecrawl and exa MCPs
- exa-search — Neural search via Exa MCP for web, code, and companies
- claude-api — Anthropic Claude API patterns and SDKs
- x-api — X/Twitter API integration for posting, threads, and analytics
- crosspost — Multi-platform content distribution
- fal-ai-media — AI image/video/audio generation via fal.ai
- dmux-workflows — Multi-agent orchestration with dmux

## MCP Servers

Treat the project-local `.codex/config.toml` as the default Codex baseline for ECC. The current ECC baseline enables GitHub, Context7, Exa, Memory, Playwright, and Sequential Thinking; add heavier extras in `~/.codex/config.toml` only when a task actually needs them.

ECC's canonical Codex section name is `[mcp_servers.context7]`. The launcher package remains `@upstash/context7-mcp`; only the TOML section name is normalized for consistency with `codex mcp list` and the reference config.

### Automatic config.toml merging

The sync script (`scripts/sync-ecc-to-codex.sh`) uses a Node-based TOML parser to safely merge ECC MCP servers into `~/.codex/config.toml`:

- **Add-only by default** — missing ECC servers are appended; existing servers are never modified or removed.
- **7 managed servers** — Supabase, Playwright, Context7, Exa, GitHub, Memory, Sequential Thinking.
- **Canonical naming** — ECC manages Context7 as `[mcp_servers.context7]`; legacy `[mcp_servers.context7-mcp]` entries are treated as aliases during updates.
- **Package-manager aware** — uses the project's configured package manager (npm/pnpm/yarn/bun) instead of hardcoding `pnpm`.
- **Drift warnings** — if an existing server's config differs from the ECC recommendation, the script logs a warning.
- **`--update-mcp`** — explicitly replaces all ECC-managed servers with the latest recommended config (safely removes subtables like `[mcp_servers.supabase.env]`).
- **User config is always preserved** — custom servers, args, env vars, and credentials outside ECC-managed sections are never touched.

## External Action Boundaries

Treat networked tools as read-only by default. Search, inspect, and draft freely within the user's requested scope, but require explicit user approval before posting, publishing, pushing, merging, opening paid jobs, dispatching remote agents, changing third-party resources, or modifying credentials.

When approval is ambiguous, produce a local plan or draft artifact instead of taking the external action. Preserve user config and private state unless the user specifically asks for a scoped change.

## Multi-Agent Support

Codex now supports multi-agent workflows behind the experimental `features.multi_agent` flag.

- Enable it in `.codex/config.toml` with `[features] multi_agent = true`
- Define project-local roles under `[agents.<name>]`
- Point each role at a TOML layer under `.codex/agents/`
- Use `/agent` inside Codex CLI to inspect and steer child agents

Sample role configs in this repo:
- `.codex/agents/explorer.toml` — read-only evidence gathering
- `.codex/agents/reviewer.toml` — correctness/security review
- `.codex/agents/docs-researcher.toml` — API and release-note verification

## Key Differences from Claude Code

| Feature | Claude Code | Codex CLI |
|---------|------------|-----------|
| Hooks | 8+ event types | Not yet supported |
| Context file | CLAUDE.md + AGENTS.md | AGENTS.md only |
| Skills | Skills loaded via plugin | `.agents/skills/` directory |
| Commands | `/slash` commands | Instruction-based |
| Agents | Subagent Task tool | Multi-agent via `/agent` and `[agents.<name>]` roles |
| Security | Hook-based enforcement | Instruction + sandbox |
| MCP | Full support | Supported via `config.toml` and `codex mcp add` |

## Security Without Hooks

Since Codex lacks hooks, security enforcement is instruction-based:
1. Always validate inputs at system boundaries
2. Never hardcode secrets — use environment variables
3. Run `npm audit` / `pip audit` before committing
4. Review `git diff` before every push
5. Use `sandbox_mode = "workspace-write"` in config
