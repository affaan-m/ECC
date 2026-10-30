# Harness Adapter Compliance Matrix

This matrix is the public onramp for teams that want to use ECC across more
than one coding harness. It turns the cross-harness architecture into a
practical scorecard: what works today, what is instruction-only, what needs an
adapter, and what evidence an operator should collect before trusting a setup.

ECC's durable units stay in shared sources:

- `skills/*/SKILL.md`
- `rules/`
- `commands/`
- `hooks/hooks.json`
- `scripts/hooks/`
- MCP reference configs
- session and observability contracts

Harness-specific files should only adapt loading, event shape, command names,
or platform limits.

## Compliance States

| State | Meaning |
| --- | --- |
| Native | ECC can install or verify the surface directly for this harness. |
| Adapter-backed | ECC has a thin adapter, plugin, or package surface, but parity differs by harness. |
| Instruction-backed | ECC can provide the guidance and files, but the harness does not expose the runtime hook/session surface ECC needs for enforcement. |
| Reference-only | The tool is useful as a design pressure or external runtime, but ECC does not yet ship a direct installer or adapter for it. |

## Matrix

The matrix below is rendered from
`scripts/lib/harness-adapter-compliance.js` and verified by
`npm run harness:adapters -- --check`.

<!-- harness-adapter-compliance:matrix-start -->
| Harness or runtime | State | Supported assets | Unsupported or different surfaces | Install or onramp | Verification command | Risk notes |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Native | Claude plugin assets; skills; commands; hooks; MCP config; local rules; statusline-oriented workflows | Claude-native hooks do not imply parity in other harnesses | `./install.sh --profile minimal --target claude`; Claude plugin install | `npm run harness:audit -- --format json`; `node scripts/session-inspect.js --list-adapters` | Avoid loading every skill by default; keep hooks opt-in and inspectable. |
| Codex | Instruction-backed | `AGENTS.md`; Codex plugin metadata; skills; MCP reference config; command patterns | Native hook enforcement and Claude slash-command semantics are not equivalent | `./install.sh --profile minimal --target codex`; repo-local `AGENTS.md` review | `npm run harness:audit -- --format json` | Treat hooks as policy text unless a native Codex hook surface exists. |
| OpenCode | Adapter-backed | OpenCode package/plugin metadata; shared skills; MCP config; event adapter patterns | Event names, plugin packaging, and command dispatch differ from Claude Code | OpenCode package or plugin surface from this repo | `node tests/scripts/build-opencode.test.js`; `npm run harness:audit -- --format json` | Keep hook logic in shared scripts and adapt only event shape at the edge. |
| Pi | Adapter-backed | Pi package manifest; canonical ECC skills (skills/); canonical ECC commands as prompt templates (commands/); canonical ECC engineering rules (rules/common/) injected into the system prompt; session lifecycle hook adapter; /ecc-doctor diagnostics command; canonical ECC agents (agents/) portable via scripts/agent-convert.js (claude -> pi) | Agent chains, approval prompts, and persistent todos require companion Pi packages and are not part of this adapter (individual agent definitions are portable via scripts/agent-convert.js); Pi core has no MCP surface, though ECC MCP configs load verbatim through the community pi-mcp-adapter package, which ECC neither installs nor depends on | `pi install git:github.com/affaan-m/ECC`; `pi install /path/to/ECC` from a local checkout | `node tests/pi/pi-package-manifest.test.js`; `node tests/pi/pi-extension-adapter.test.js`; `node tests/pi/agent-convert.test.js`; `npm run harness:adapters -- --check` | Pi extensions execute with full user permissions, and hooks run without a shell and resolve from the installed package rather than the user project; Keep canonical skills and commands as the single source of truth, and never generate copies under .pi/ |
| Cursor | Adapter-backed | Cursor rules; project-local skills; hook adapter; shared scripts | Cursor hook events and rule loading differ from Claude Code | `./install.sh --profile minimal --target cursor` | `node tests/lib/install-targets.test.js`; `npm run harness:audit -- --format json` | Cursor adapters must preserve existing project rules and avoid silent overwrite. |
| Gemini | Instruction-backed | Gemini project-local instructions; shared skills; rules; compatibility docs | No full ECC hook parity; ecosystem ports must document drift from upstream ECC | `./install.sh --profile minimal --target gemini` | `node tests/lib/install-targets.test.js` | Treat Gemini ports as ecosystem adapters until validated end to end inside Gemini CLI. |
| Zed | Adapter-backed | Zed project settings; flattened project rules; shared skills; commands; agents | Zed external agents and native Agent Panel permissions are not Claude hooks | `./install.sh --profile minimal --target zed` | `node tests/lib/install-targets.test.js`; `npm run harness:audit -- --format json` | Keep project settings conservative and do not copy BYOK/OpenRouter secrets into `.zed/`. |
| dmux | Adapter-backed | session snapshots; tmux/worktree orchestration status; handoff exports | dmux is an orchestration runtime, not an install target for skills/rules | `node scripts/session-inspect.js --list-adapters`; dmux session target inspection | `node tests/lib/session-adapters.test.js` | Treat dmux events as session/runtime signals, not as a replacement for repo validation. |
| DeepSeek Harness | Adapter-backed | canonical ECC skills (skills/) via native DSH skill roots; command hooks through the first-party @deepseek-ai/dsh-hooks-claude-code bridge (23 commands on 5 of 7 bridged events); hooks config generator (scripts/dsh/generate-hooks-config.js); profile patch mounting with compose-time validation | Claude slash commands and ECC subagent surfaces have no DSH equivalent; workflows are covered by skills; PreCompact, PostToolUseFailure, and SessionEnd hook events have no bridge counterpart; no dedicated installer target; setup is documented manual configuration | link the curated catalog: ln -s /path/to/ECC/skills/<skill> ~/.dsh/skills/<skill>; generate the hooks config: node scripts/dsh/generate-hooks-config.js --ecc-root /path/to/ECC --out ~/.dsh/ecc/hooks-dsh.json; mount a bare - insert: entry for @deepseek-ai/dsh-hooks-claude-code in ~/.dsh/profiles/<profile>/cordis.patch.yml | `node tests/scripts/dsh-generate-hooks-config.test.js`; `node scripts/ci/validate-skills.js`; `dsh --profile <profile> --dump-config` (compose-time validation) | Hook commands embed the ECC checkout path; regenerate the hooks config after moving the repo; Keep the tool-name matcher mapping (Bash to bash, Edit/MultiEdit to edit) in sync with DSH tool names; A plain top-level patch entry is silently dropped; additions require a bare insert entry |
| Antigravity | Adapter-backed | flattened workspace rules (.agents/rules/) with always_on and glob activation frontmatter; slash workflows (.agents/workflows/) projected from commands/; canonical ECC skills (.agents/skills/<name>/SKILL.md); custom agents (.agents/agents/) with adapted flash/pro models and tool allowlists | Claude runtime hooks and MCP configs are not installed by the Antigravity project target; Unsupported Claude tool names are omitted from custom agents because unmapped tool identifiers can stall execution | `./install.sh --profile minimal --target antigravity`; `npx ecc-universal install --profile minimal --target antigravity` | `node tests/lib/antigravity-install-target.test.js`; `node tests/lib/antigravity-rule.test.js`; `node scripts/doctor.js --target antigravity` | Do not copy the repository .agents/ Codex packaging tree wholesale or rename legacy .agent/ directories manually because ecc-install-state.json records absolute managed paths. |
| Qwen Code | Adapter-backed | Qwen home instructions (~/.qwen/QWEN.md); canonical ECC skills, commands, rules, and MCP configs under ~/.qwen/; managed custom agents (~/.qwen/agents/) with Qwen tool IDs, palette colors, and model: inherit | Claude hook runtime parity is not claimed or installed; Empty or null agent tools lists are rejected because Qwen Code treats an empty list in named-agent files as inheriting all parent tools rather than deny-all | `./install.sh --target qwen --profile minimal`; `qwen extensions install https://github.com/affaan-m/ECC:ecc` (extension path; conditional rules only) | `node tests/scripts/qwen-adapt-agents.test.js`; `node tests/lib/install-targets.test.js` | Do not layer a full managed ~/.qwen install over an active Qwen extension install unintentionally, and do not add artificial paths: ["**/*"] globs to common rules. |
| GitHub Copilot | Adapter-backed | project-local skills (.github/skills/) with projected helper paths; custom agents (.github/agents/) restricted to name and description frontmatter; path-scoped instructions (.github/instructions/ecc/**/*.instructions.md) with applyTo glob mapping; managed package-manager detection helpers under .github/ecc/scripts/ | Claude runtime hooks and slash commands are not installed because Copilot CLI governs tool permissions at the session level and lacks slash-command argument substitution; Agent model, tools, and color fields are omitted from Copilot custom agent frontmatter | `./install.sh --profile minimal --target copilot` | `node tests/lib/copilot-install-target.test.js`; `node tests/lib/install-targets.test.js` | Copilot CLI governs tool permissions via session --allow-tool and --deny-tool flags rather than per-agent frontmatter allowlists. |
| Hermes | Adapter-backed | managed home rules, skills, commands, and MCP configs under ~/.hermes/; opt-in self-contained Python hooks (config-protection.py and check-console-log.py) via --modules hermes-hooks --enable-hooks | Full 24-command Claude hook runtime is not installed; Hermes uses its own ~/.hermes/config.yaml event mapping and consent allowlist; Installer never mutates ~/.hermes/config.yaml automatically | `./install.sh --profile minimal --target hermes`; `./install.sh --target hermes --modules hermes-hooks --enable-hooks` | `node tests/hermes-hooks.test.js`; `node tests/lib/install-targets.test.js` | Register hooks manually in ~/.hermes/config.yaml using expanded paths because Hermes resolves hook commands verbatim without ~ expansion, and never commit raw ~/.hermes exports. |
| Orca | Reference-only | worktree lifecycle; review state; notification; provider-identity design pressure | No ECC installer or direct adapter today | Use as a comparison target for worktree/session state requirements | `npm run observability:ready` | Do not import product-specific assumptions; convert lessons into ECC event fields. |
| Superset | Reference-only | workspace presets; parallel-agent review loops; worktree isolation design pressure | No ECC installer or direct adapter today | Use as a comparison target for workspace preset taxonomy | `npm run observability:ready` | Keep ECC portable; do not require a desktop workspace to get basic value. |
| Ghast | Reference-only | terminal-native pane grouping; cwd grouping; search; notifications | No ECC installer or direct adapter today | Use as a comparison target for terminal-first session grouping | `node scripts/session-inspect.js --list-adapters` | Preserve terminal ergonomics before adding visual UI assumptions. |
| Terminal-only | Native | skills; rules; commands; scripts; harness audit; observability readiness; handoffs | No external UI, no automatic session control unless scripts are run explicitly | Clone repo; run commands directly; use minimal profile for project installs | `npm run harness:audit -- --format json`; `npm run observability:ready` | This is the fallback contract; every higher-level adapter should degrade to it. |
<!-- harness-adapter-compliance:matrix-end -->

## Scorecard Onramp

Use this sequence before asking ECC to make a team or repo setup more
autonomous:

```bash
npm run harness:adapters -- --check
npm run harness:audit -- --format json
npm run observability:ready
node scripts/session-inspect.js --list-adapters
node scripts/loop-status.js --json --write-dir .ecc/loop-status
```

Read the result as a setup scorecard, not a product badge:

- `harness:adapters -- --check` proves this public matrix still matches the
  adapter source data and required evidence fields.
- `harness:audit` scores tool coverage, context efficiency, quality gates,
  memory persistence, eval coverage, security guardrails, and cost efficiency.
- `observability:ready` proves the repo still exposes the local status,
  session, tool-activity, risk-ledger, and release-onramp signals.
- `session-inspect --list-adapters` shows which session surfaces are actually
  inspectable in the current environment.
- `loop-status --json` creates a machine-readable handoff/status payload for
  longer autonomous runs.

## Data-Backed Scorecard Contract

Each adapter record exposes:

- `id`
- `state`
- `supported_assets`
- `unsupported_surfaces`
- `install_or_onramp`
- `verification_commands`
- `risk_notes`
- `last_verified_at`
- `owner`
- `source_docs`

The validator fails if a public adapter claim has no install path,
verification command, risk note, owner, source doc, or verification date.

## Operating Rules

- Prefer small, additive adapters over harness-specific forks of the same
  workflow.
- Do not call a harness native until the adapter has an install path and a
  verification command.
- Keep Codex, Gemini, and Zed surfaces honest when enforcement is
  instruction-backed rather than runtime-backed.
- Treat reference-only tools as design pressure until ECC has a direct adapter.
- Keep the terminal-only path healthy; it is the portability floor.
