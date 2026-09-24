# ECC 2.0.0 — The Agent Harness Operating System

ECC 2.0.0 is the stable graduation of the 2.0 line: ECC as a cross-harness operating system for agentic work. Claude Code stays first-class; Codex, OpenCode, Cursor, Gemini, Zed, and terminal-only workflows share the same skills, rules, hooks, MCP conventions, release gates, and operator workflows.

## Highlights

- 261 public skills across coding, research, security, media, enterprise ops, and agent workflows.
- ECC 2.0 control-pane substrate: harness-neutral session adapters (`ecc.session.v1`) covering Claude Code, Codex, OpenCode, and dmux.
- MCP inventory (`ecc.mcp.v1`): one normalized view of MCP server configs across harnesses, with fragmentation and drift detection and secret redaction.
- Worktree-lifecycle service: deterministic conflict prediction and safe garbage collection for parallel agent worktrees.
- `orch-*` orchestrator skill family plus dynamic workflow team orchestration.
- Rollout-derived optimization pack: `parallel-execution-optimizer`, `benchmark-optimization-loop`, `data-throughput-accelerator`, `latency-critical-systems`, `recursive-decision-ledger`.

## Hardening since rc.1

Roughly thirty PRs of fixes landed between rc.1 and stable. The ones worth knowing about:

- **Plugin hooks were silently no-ops on Node 21+** (#2184). The hook runner depended on `require.main` under `node -e`, which newer Node leaves undefined — every plugin hook exited cleanly without running. If you are on Node 21 or newer, update now.
- Windows reliability: `CLAUDE_PLUGIN_ROOT` path normalization (#2139), prompts passed via stdin so the shell does not mangle them (#2174), broken-symlink and chmod test guards (#2171, #2176).
- Security: curl credentials kept out of argv (#2175), gateguard now gates force/path checkouts as destructive (#2158) with env knobs for routine-command gating (#2161), advisory intake hardening.
- Correctness: session-end summaries no longer corrupt `$`-sequences in user messages (#2180), project detection matches package keys on boundaries so `preact` no longer reads as `react` (#2181), install manifest packaging gaps closed (#2172), corrupted legacy command shims truncated safely (#2167).
- Slimmer defaults: smaller OpenCode install surface with gated hooks-runtime (#2140), `rules/zh` out of the always-loaded default install (#2170).
- New surfaces: `kubernetes-patterns` skill (#2178), worktree-lifecycle service (#2164), MCP inventory (#2146), codex-worktree and opencode session adapters (#2145), the `orch-*` family (#2153).

## Community launch

The ECC Discord is live: <https://discord.gg/36yGMHGFbR>

- Release news lands in #announcements, auto-posted and pinned by the release workflow shipped in this very release (#2201).
- A live PR and issue feed runs in #pr-and-issues.
- The ECC bot answers `/skill`, `/docs`, and `/release` lookups in-server.
- #feedback and #feature-requests are read directly by the maintainer and shape the roadmap.

## Install or upgrade

```
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc
```

Existing installs: `/plugin update ecc`

Full changelog: <https://github.com/affaan-m/ECC/compare/v2.0.0-rc.1...v2.0.0>
