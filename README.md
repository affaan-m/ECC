<p align="center">
  <img src="assets/hero.png" alt="ECC - the agent harness operating system" width="100%" />
</p>

<p align="center">
  <strong>Language:</strong>
  <a href="README.md">English</a> |
  <a href="docs/pt-BR/README.md">Português (Brasil)</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="docs/zh-TW/README.md">繁體中文</a> |
  <a href="docs/ja-JP/README.md">日本語</a> |
  <a href="docs/ko-KR/README.md">한국어</a> |
  <a href="docs/tr/README.md">Türkçe</a> |
  <a href="docs/ru/README.md">Русский</a> |
  <a href="docs/vi-VN/README.md">Tiếng Việt</a> |
  <a href="docs/th/README.md">ไทย</a> |
  <a href="docs/de-DE/README.md">Deutsch</a> |
  <a href="docs/es/README.md">Español</a>
</p>

<p align="center">
  <a href="https://discord.gg/36yGMHGFbR"><img src="https://img.shields.io/discord/1496644400590094540?logo=discord&logoColor=white&label=Discord&color=5865F2" alt="Discord" /></a>
  <a href="https://ecc.tools"><img src="https://img.shields.io/badge/Website-ecc.tools-E07856?logo=googlechrome&logoColor=white" alt="Website" /></a>
  <a href="https://github.com/apps/ecc-tools"><img src="https://img.shields.io/badge/GitHub%20App-ECC%20Tools-181717?logo=github&logoColor=white" alt="GitHub App" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
  <a href="https://www.npmjs.com/package/ecc-universal"><img src="https://img.shields.io/npm/dw/ecc-universal?label=ecc-universal&logo=npm" alt="ecc-universal npm downloads" /></a>
  <a href="https://www.npmjs.com/package/ecc-agentshield"><img src="https://img.shields.io/npm/dw/ecc-agentshield?label=ecc-agentshield&logo=npm" alt="ecc-agentshield npm downloads" /></a>
</p>

<div align="center">

<table aria-label="ECC primary links">
<tr>
<td width="33%" align="center">
  <a href="https://ecc.tools/pricing">
    <img src="assets/images/community/ecc-tools-mark.svg" height="42" alt="ECC Tools" /><br />
    <strong>ECC Pro + GitHub App</strong>
  </a><br />
  <sub><a href="https://github.com/apps/ecc-tools">Install free</a> · <a href="https://ecc.tools/pricing">Private repos from $19/seat/mo</a></sub>
</td>
<td width="33%" align="center">
  <a href="https://github.com/sponsors/affaan-m">
    <img src="assets/images/community/heart.svg" height="42" alt="" /><br />
    <strong>Sponsor ECC</strong>
  </a><br />
  <sub>Fund the open-source project</sub>
</td>
<td width="33%" align="center">
  <a href="https://discord.gg/36yGMHGFbR">
    <img src="assets/images/community/discord.svg" height="42" alt="Discord" /><br />
    <strong>Community</strong>
  </a><br />
  <sub>Discord · Q&amp;A · Show and Tell</sub>
</td>
</tr>
</table>

</div>

# Everything Claude Code

Your agent can write code, but ECC gives it a coordinated engineering system and toolbox: it plans before it builds, verifies changes with tests, reviews its own work from a fresh context, remembers what matters, and turns repeated wins into reusable skills and workflows.

```text
plan -> test -> implement -> review -> verify -> remember -> improve
```

Instead of rebuilding that process in every prompt, you install it once and make it part of how your agent works.

> Optimize the context window. Persist everything else.

ECC is MIT-licensed open source. It works best with Claude Code today, with first-class Codex support and adapters for Cursor, OpenCode, Gemini, Zed, GitHub Copilot, Antigravity, Qwen, and other harnesses.

Access to 67 agents, 281 skills, and 94 legacy command shims, plus hooks, rules, memory, continuous learning, and AgentShield security scanning. The agents are specialized for planning, review, build repair, security, architecture, and domain work.

| Included         |       Count | What it gives you                                                                    |
| ---------------- | ----------: | ------------------------------------------------------------------------------------ |
| Agents           |   67 agents | Planning, review, build repair, security, architecture, and domain work              |
| Skills           |  281 skills | TDD, research, security, docs, frontend, data, ML, operations, and more              |
| Commands         | 94 commands | Convenient entry points while ECC moves to a skills-first surface                    |
| Hooks and memory |     Runtime | Enforcement, session summaries, continuous learning, instincts, and context controls |
| Rules            |   Selective | Always-loaded standards you choose by language or project                            |
| AgentShield      |    Included | Scanning for prompts, hooks, MCP config, permissions, secrets, and agent files       |

## Why It Feels Different

| Without a system                                        | With ECC                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| Plans disappear into chat history                       | Plans become editable artifacts before implementation starts          |
| "Please use TDD" is an instruction the model may forget | TDD becomes a gated RED -> GREEN -> REFACTOR workflow with evidence   |
| The same context writes and reviews the code            | A fresh-context reviewer looks for regressions and blind spots        |
| Memory means saving an enormous transcript              | Sessions are distilled into summaries, instincts, and reusable skills |
| Quality checks depend on reminders                      | Hooks can enforce deterministic checks outside the prompt             |
| Agent configuration is trusted by default               | AgentShield scans the harness itself as an attack surface             |

### TDD is a principle, not a suggestion

```text
/ecc:plan "Add usage-based billing alerts"
  -> confirm or edit the plan
  -> activate tdd-workflow
  -> capture RED evidence before implementation
  -> implement until GREEN
  -> review from fresh context
  -> fix findings with regression tests
  -> verify build, lint, types, and tests
```

A result is not just code. It's a trail of evidence: the plan, the failing test, the passing test, the review findings, and the final verification.

### Skills keep the context focused

Rules, skills, agents, and hooks solve different problems. Keeping those jobs separate is how ECC adds capability without dumping the entire repository into every session.

| Concept | What it does | Context behavior |
|---|---|---|
| Skills | Reusable workflows such as TDD, security review, or deep research | Loaded when the task needs them |
| Agents | Scoped workers with their own context and tool permissions | Isolate planning, implementation, and review |
| Rules | Durable project or language standards | Always loaded, so install them selectively |
| Hooks | Scripts triggered by harness events | Run outside the model context |
| Instincts | Patterns learned from real sessions with confidence scores | Recalled when relevant |

### Share context between harnesses

ECC's Memory Vault gives Claude, Codex, Hermes, OpenClaw, Kimi, and other harnesses one local, inspectable Markdown format for durable context and handoffs. Project and team memories live under `.ecc/memory/`; user memories live under `~/.ecc/memory/`.

```bash
npm install -g ecc-universal
ecc memory init --scope project
ecc memory search "authentication migration" --target-harness codex
ecc memory doctor
```

Memory is unreviewed context, not executable policy. Verify important claims against authoritative sources and promote accepted knowledge into governed project documentation. The optional `ecc-memory-mcp` server exposes the same bounded save, search, read, and doctor surface without enabling itself by default.

[Open the Unified Memory workflow →](skills/unified-memory/SKILL.md)

## What's New: ECC 2.1

> [!IMPORTANT]
> **NEW IN ECC 2.1: Plan Canvas · Kimi harness · self-hosted compute on Itô GPUs.**
> [See the full release notes →](https://github.com/affaan-m/ECC/blob/main/docs/releases/2.1.0/release-notes.md)

### Plan Canvas: review plans by pointing, not retyping

Your agent writes a plan, then opens it in a loopback-only browser canvas. Click the part you mean, attach numbered annotations, chat from a side rail, and hit **Approve plan** or **Request changes**. The verdict maps straight onto `/plan`'s CONFIRM gate. Mermaid diagrams render live, and edits to the plan file reload the page.

![Plan Canvas demo: reviewing an ECC plan in the browser, scrolling diagrams, attaching an anchored annotation, chatting with the agent, and approving the plan](https://raw.githubusercontent.com/affaan-m/ECC/main/docs/releases/2.1.0/assets/ecc-plan-canvas-demo.gif)

It's harness- and model-agnostic: a plain CLI (`ecc-plan-canvas`) speaking JSON, so any agent can drive it. Try it: ask your agent to `/ecc:plan` anything, then review from the page instead of the terminal.

[Open the plan used in this demo →](https://github.com/affaan-m/ECC/blob/main/docs/releases/2.1.0/plan-canvas-demo.plan.md)

### Also in 2.1

- **Kimi Code install target** (`--target kimi`): ECC installs natively into [Moonshot AI](https://www.moonshot.ai)'s Kimi Code CLI
- **Self-host on GPUs**: a verified path with [Itô](https://compute.itomarkets.com), ECC's preferred compute sponsor, including the opt-in `ecc ito find` RFQ bridge (details and disclosures below)
- **Moonshot AI (Kimi), Itô, and Atlas Cloud** are now public sponsors
- **Hermes + OpenClaw install targets**, a Codex navigation guide, consolidated PostToolUse hooks, and supply-chain hardening

<details>
<summary><strong>Previous releases</strong></summary>

| Version | Highlights |
|---|---|
| [v2.0.0](https://github.com/affaan-m/ECC/releases/tag/v2.0.0) | The Agent Harness Operating System: cross-harness graduation, control-pane substrate, `orch-*` orchestrators, Discord + ECC bot, single-connector MCP policy |
| [v1.10.0](https://github.com/affaan-m/ECC/releases/tag/v1.10.0) | Surface refresh, operator workflows, ECC 2.0 alpha |
| [v1.9.0](https://github.com/affaan-m/ECC/releases/tag/v1.9.0) | Selective install, ECC Tools Pro, 12 language ecosystems |
| [v1.8.0](https://github.com/affaan-m/ECC/releases/tag/v1.8.0) | Harness performance and cross-platform reliability |
| [v1.7.0](https://github.com/affaan-m/ECC/releases/tag/v1.7.0) | Cross-platform expansion and presentation builder |
| [v1.6.0](https://github.com/affaan-m/ECC/releases/tag/v1.6.0) | Codex Edition and the ECC Tools GitHub App |
| [v1.5.0](https://github.com/affaan-m/ECC/releases/tag/v1.5.0) | Universal Edition |
| [v1.4.0](https://github.com/affaan-m/ECC/releases/tag/v1.4.0) | Multi-language rules, installation wizard, PM2 orchestration |
| [v1.3.0](https://github.com/affaan-m/ECC/releases/tag/v1.3.0) | Complete OpenCode plugin support |
| [v1.2.0](https://github.com/affaan-m/ECC/releases/tag/v1.2.0) | Unified commands and skills |
| [v1.1.0](https://github.com/affaan-m/ECC/releases/tag/v1.1.0) | Cross-platform support and community fixes |
| [v1.0.0](https://github.com/affaan-m/ECC/releases/tag/v1.0.0) | Official plugin release |

</details>

## Install ECC

### Pick one path only (per harness)

You can use ECC with Claude Code, Codex, and other harnesses at the same time. Choose one install method for each harness:

- **Works:** Claude Code plugin + Codex sync
- **Avoid:** Claude Code plugin + full Claude manual install
- **Avoid:** Codex sync + Codex marketplace plugin

**Recommended default:** install the Claude Code plugin for Claude Code and use the supported sync flow for Codex. **Do not stack install methods.** Installing ECC twice into the same harness can duplicate skills, commands, hooks, or configuration; installing it once into multiple harnesses does not.

### Claude Code

Run these commands inside Claude Code:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```

That installs ECC's skills, agents, commands, and plugin-managed hooks. Claude Code plugins cannot distribute `rules`, so add only the rule packs you actually want:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
mkdir -p ~/.claude/rules/ecc
cp -R rules/common ~/.claude/rules/ecc/
cp -R rules/typescript ~/.claude/rules/ecc/  # replace with your stack
```

Start with `rules/common` plus one language or framework pack you actually use. If you install the plugin, do not run `./install.sh --profile full` afterward.

### Codex App and CLI

The reliable ECC setup for Codex is the sync flow. Run Codex once first so `~/.codex/config.toml` exists. The sync preserves your existing Codex files, creates timestamped backups, and merges ECC's `AGENTS.md`, skills, prompts, agents, and reference config into `~/.codex`:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
npm install
bash scripts/sync-ecc-to-codex.sh
```

You can also open the ECC repository directly in Codex for a project-local setup. Codex reads the root `AGENTS.md` and the trusted project configuration in `.codex/` without a global sync.

For repo navigation, surface ownership, and PR diff packet guidance, read the [Codex ECC Navigation Map](docs/CODEX-NAVIGATION-GUIDE.md).

<details>
<summary><strong>Codex plugin marketplace (experimental for ECC)</strong></summary>

Codex officially supports plugin marketplaces, and ECC publishes a repo marketplace:

```bash
codex plugin marketplace add affaan-m/ECC
codex plugin marketplace list
```

Restart Codex, then install or enable `ecc` from the Plugins directory. Do not add the marketplace plugin on top of the Codex sync flow. Marketplace registration is stable in Codex, but ECC's current plugin package references shared repository content that may not be copied into Codex's install cache. Until that upstream cache behavior is resolved, use the sync flow above when you need all ECC skills reliably.

From an ECC checkout, verify the installed plugin cache with:

```bash
node scripts/codex/check-plugin-cache.js
```

See the [.codex plugin notes](.codex-plugin/README.md) for the current limitation and tracking issues.
</details>

<details>
<summary><strong>Other agents and editors</strong></summary>

Clone ECC once, then choose the target that matches your harness:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
```

| Harness | Install or setup | Notes |
|---|---|---|
| Cursor | `./install.sh --profile minimal --target cursor` | Project-local `.cursor/` adapter |
| OpenCode | `npm install && npm run build:opencode && ./install.sh --profile full --target opencode` | Builds the plugin payload before the full install |
| Gemini CLI | `./install.sh --profile minimal --target gemini` | Project-local `.gemini/` config |
| Zed | `./install.sh --profile minimal --target zed` | Project-local `.zed/` adapter |
| Antigravity | `./install.sh --profile minimal --target antigravity` | See the [Antigravity guide](docs/ANTIGRAVITY-GUIDE.md) |
| Qwen CLI | `./install.sh --profile minimal --target qwen` | See the [Qwen guide](docs/QWEN-GUIDE.md) |
| Hermes | `./install.sh --profile minimal --target hermes` | See the [Hermes setup guide](docs/HERMES-SETUP.md) |
| OpenClaw | `./install.sh --profile minimal --target openclaw` | Managed home-directory install |
| Kimi Code CLI | `./install.sh --profile minimal --target kimi` | Project-local `.kimi/` install |
| CodeBuddy | `./install.sh --profile minimal --target codebuddy` | Project-local `.codebuddy/` install |
| JoyCode | `./install.sh --profile minimal --target joycode` | Project-local `.joycode/` install |

GitHub Copilot support is already included in this repository. `.github/copilot-instructions.md` provides the instruction layer, `.github/prompts/` contains the reusable `/plan`, `/tdd`, `/security-review`, `/build-fix`, and `/refactor` prompts, and `.vscode/settings.json` enables `chat.promptFiles`.

For a harness without a native ECC target, use the [manual adaptation guide](docs/MANUAL-ADAPTATION-GUIDE.md). It explains how to carry a small set of ECC skills and workflow instructions into chat-style tools without pretending hooks or native skill discovery are available.

Cursor installs agent definitions under `.cursor/agents/ecc-*.md`. Cursor-native loading behavior can vary by Cursor build. ECC does not install root `AGENTS.md` into `.cursor/`. The adapter keeps Cursor's context scoped to its native rules and agent surfaces.
</details>

## Advanced Install Options

The options stay here, directly under the main install paths, so you do not have to hunt through the README when the default setup is not the right fit.

<details>
<summary><strong>Low-context install with no hook runtime</strong></summary>

### Low-context / no-hooks path

Use this when you want ECC's rules, agents, commands, platform config, and core workflows without runtime hooks:

```bash
./install.sh --profile minimal --target claude
# or, without cloning first
npx ecc-install --profile minimal --target claude
```

Windows:

```powershell
.\install.ps1 --profile minimal --target claude
```

This profile intentionally excludes `hooks-runtime`.

For the normal core profile with hooks disabled:

```bash
./install.sh --profile core --without baseline:hooks --target claude
```

Add the hook runtime later only if you want it:

```bash
./install.sh --target claude --modules hooks-runtime
```
</details>

<details>
<summary><strong>Choose only the components you need</strong></summary>

### Find the right components first

Ask the packaged advisor which components match your work:

```bash
npx ecc consult "security reviews" --target claude
```

It returns matching components, related profiles, and preview/install commands.

You can also install explicit skills or capabilities:

```bash
./install.sh --target claude --skills tdd-workflow,security-review
npx ecc install --profile minimal --target claude --with capability:machine-learning
```
</details>

<details>
<summary><strong>Project-local rules instead of global rules</strong></summary>

Use project-local rules when ECC's standards should apply to one repository rather than every Claude Code session:

```bash
cd your-project
mkdir -p .claude/rules/ecc
cp -R /path/to/ECC/rules/common .claude/rules/ecc/
cp -R /path/to/ECC/rules/typescript .claude/rules/ecc/
```

Rules are always-loaded context, so begin with `common` and one pack for the stack you actually use.
</details>

<details>
<summary><strong>Fully manual Claude install</strong></summary>

Use this only when you are intentionally skipping the plugin path:

```bash
git clone https://github.com/affaan-m/ECC.git
cd ECC
./install.sh --profile full
```

Windows:

```powershell
git clone https://github.com/affaan-m/ECC.git
cd ECC
.\install.ps1 --profile full
```

If you choose this path, stop there. Do not also run `/plugin install`.

For hand-picked manual installs, Claude discovers skills as direct children of `~/.claude/skills/`; do not nest them under `~/.claude/skills/ecc/`.

Do not copy the raw repo `hooks/hooks.json` into `~/.claude/settings.json` or `~/.claude/hooks/hooks.json`. Use the installer so hook command paths are rewritten correctly:

```bash
bash ./install.sh --target claude --modules hooks-runtime
```

On Windows, Claude's config root is `%USERPROFILE%\\.claude`; install the hook runtime with:

```powershell
pwsh -File .\install.ps1 --target claude --modules hooks-runtime
```
</details>

<details>
<summary><strong>Custom API endpoints, model gateways, and self-hosted models</strong></summary>

ECC works through each harness's normal configuration, so you can use an official provider, a compatible custom API endpoint or model gateway, or a self-hosted model without changing ECC's workflows.

Run or self-host any open-source model behind that gateway using separate compute and serving setup. If you need GPU capacity, [Itô](https://compute.itomarkets.com) is ECC's preferred compute sponsor; any GPU provider works. The sponsorship link is passive: it does not invoke an RFQ, reserve capacity, provision compute, or configure serving. Separately, `ecc ito find` invokes the explicitly configured canonical Itô CLI and submits a live authenticated RFQ; it does not reserve capacity. Managed inference through Itô is not live yet.

For Claude Code, see Anthropic's [LLM gateway documentation](https://docs.anthropic.com/en/docs/claude-code/llm-gateway) and [model configuration documentation](https://docs.anthropic.com/en/docs/claude-code/model-config).

For a local Kimi setup, keep the harness, model-serving endpoint, and GPU provider as separate choices:

<table aria-label="Local Kimi model path" width="100%">
<tr>
<td width="33%" align="center">
  <a href="https://compute.itomarkets.com">
    <picture><source media="(prefers-color-scheme: light)" srcset="assets/images/sponsors/ito-transparent-light.png" /><img src="assets/images/sponsors/ito-transparent.png" width="92" alt="Itô Markets" /></picture><br />
    <strong>1. Get GPU capacity</strong>
  </a><br />
  <sub>Use Itô or any GPU provider.</sub>
</td>
<td width="33%" align="center">
  <a href="https://www.moonshot.ai">
    <picture><source media="(prefers-color-scheme: dark)" srcset="assets/images/sponsors/moonshot-dark.png" /><img src="assets/images/sponsors/moonshot.png" width="126" alt="Moonshot AI - Kimi" /></picture><br />
    <strong>2. Serve Kimi</strong>
  </a><br />
  <sub>Expose the chosen checkpoint through a compatible endpoint.</sub>
</td>
<td width="33%" align="center">
  <a href=".kimi/README.md">
    <img src="assets/images/community/ecc-tools-mark.svg" height="52" alt="ECC Tools" /><br />
    <strong>3. Run Kimi Code with ECC</strong>
  </a><br />
  <sub>Install project instructions and skills, then start Kimi Code.</sub>
</td>
</tr>
</table>

Configure the endpoint with Kimi Code's <a href="https://moonshotai.github.io/kimi-cli/en/configuration/providers.html">official provider guide</a>, then install ECC:

```bash
bash ./install.sh --target kimi --profile minimal
npx ecc doctor --target kimi
kimi
```

Kimi Code discovers the installed `.kimi/AGENTS.md` instructions and `.kimi/skills/` workflows natively.
</details>

<details>
<summary><strong>Reset, repair, or uninstall</strong></summary>

### Reset / Uninstall ECC

If ECC feels duplicated, intrusive, or broken, inspect the managed state before reinstalling:

```bash
node scripts/ecc.js list-installed
node scripts/ecc.js doctor
node scripts/ecc.js repair
node scripts/ecc.js uninstall --dry-run
```

For direct uninstall:

```bash
node scripts/uninstall.js --dry-run
node scripts/uninstall.js
```

Plugin users should remove the plugin from Claude Code, then delete only the rule folders they manually copied and no longer want. ECC only removes files recorded in its install-state. It does not claim unrelated files in your harness directories.
</details>

## Start Using ECC

Start with the workflow you need, not the full catalog.

| What you are doing | Start here |
|---|---|
| Building a feature | `/ecc:plan "describe the feature"`, then `tdd-workflow` |
| Fixing a bug | Reproduce it with a failing test, then use `tdd-workflow` |
| Reviewing new code | `/code-review` for a fresh-context review |
| Repairing a build | `/build-fix` |
| Cleaning a codebase | `/refactor-clean` |
| Checking context pressure | `/context-budget` |
| Ending a long session | `/save-session` or `/learn-eval` |
| Resuming later | `/resume-session` |
| Auditing agent config | `/security-scan` or `npx -y ecc-agentshield scan --path .` |

<details>
<summary><strong>Plugin commands and manual commands</strong></summary>

Claude Code plugin commands use the namespaced form:

```text
/ecc:plan "Add authentication"
```

Manual installs may expose the shorter compatibility form:

```text
/plan "Add authentication"
```

Skills are the primary workflow surface. Commands remain convenient entry points and compatibility shims.
</details>

## Guides

<table aria-label="ECC guides" width="100%">
<tr>
<td width="33%" align="center">
<a href="./the-shortform-guide.md">
<img src="assets/images/guides/shorthand-guide.png" width="213" height="120" alt="The Shorthand Guide to ECC" /><br />
<strong>The Shorthand Guide</strong>
</a>
<br /><sub>Setup, foundations, and day-one use.</sub>
</td>
<td width="33%" align="center">
<a href="./the-longform-guide.md">
<img src="assets/images/guides/longform-guide.png" width="213" height="120" alt="The Longform Guide to ECC" /><br />
<strong>The Longform Guide</strong>
</a>
<br /><sub>Context economics, memory, evals, and parallel agents.</sub>
</td>
<td width="33%" align="center">
<a href="./the-security-guide.md">
<img src="assets/images/guides/security-guide.png" width="213" height="120" alt="The Security Guide to ECC" /><br />
<strong>The Security Guide</strong>
</a>
<br /><sub>Prompt injection, hooks, MCP, and AgentShield.</sub>
</td>
</tr>
</table>

[Commands Quick Reference](./COMMANDS-QUICK-REF.md) | [Manual Adaptation Guide](docs/MANUAL-ADAPTATION-GUIDE.md)

<details>
<summary><strong>What is inside the repository</strong></summary>

```text
ECC/
|-- agents/           # 67 specialized subagents for delegation
|-- skills/           # 281 reusable workflows loaded on demand
|-- commands/         # 94 maintained slash-command shims
|-- rules/            # opt-in common and language standards
|-- hooks/            # runtime automation and enforcement
|-- scripts/          # install, repair, sync, orchestration, and checks
|-- .claude-plugin/   # Claude Code marketplace manifest
|-- .codex/           # Codex reference configuration and agent roles
|-- .opencode/        # OpenCode plugin, commands, and instructions
|-- .cursor/          # Cursor rules and hook adapter
|-- docs/             # public setup, architecture, and operating guides
```

The root is the source of truth. Platform adapters package or map these same workflows instead of maintaining separate copies.
</details>

<details>
<summary><strong>Platform implementation notes</strong></summary>

| Harness | ECC distribution | Main instruction surface | Automation |
|---|---|---|---|
| Claude Code | Plugin or selective installer | `CLAUDE.md`, rules, skills, agents | Native plugin hooks |
| Codex | Sync flow, repo config, experimental ECC marketplace | `AGENTS.md`, skills, `.codex/config.toml` | Git hooks and Codex-native configuration |
| Cursor | Project adapter | `.cursor/rules/`, scoped agents | Cursor hook adapter |
| OpenCode | Built plugin plus selective installer | `opencode.json`, instructions, commands | OpenCode plugin events |
| GitHub Copilot | Checked-in instruction layer | `copilot-instructions.md`, prompt files | No ECC hook runtime |

| Feature | Claude Code | Cursor IDE | Codex CLI | OpenCode | GitHub Copilot |
| --- | --- | --- | --- | --- | --- |
| **Agents** | 67 | Shared (AGENTS.md) | Shared (AGENTS.md) | 12 | N/A |
| **Commands** | 94 | Shared | Instruction-based | 35 | 5 prompts |
| **Skills** | 281 | Shared | 10 (native format) | 37 | Via instructions |
| **Version** | Plugin | Plugin | Reference config | 2.0.0 | Instruction layer |

</details>

<details>
<summary><strong>What changed in v2.0.0</strong></summary>

ECC v2.0.0 stabilizes the 2.0 line with the public Hermes operator story, 281 skills, 67 agents, 94 command shims, session adapters, MCP inventory, worktree lifecycle services, orchestrator workflows, and the ECC Discord community.

- [v2.0.0 release notes](docs/releases/2.0.0/release-notes.md)
- [ECC 2.0 reference architecture](docs/ECC-2.0-REFERENCE-ARCHITECTURE.md)
- [Hermes setup guide](docs/HERMES-SETUP.md)
- [Migration guide from 1.x](docs/MIGRATION-1X-TO-2.0.md)
</details>

## Security

Install ECC only from official sources:

- GitHub repository: <https://github.com/affaan-m/ECC>
- Claude Code plugin: `ecc@ecc`
- npm packages: [`ecc-universal`](https://www.npmjs.com/package/ecc-universal) and [`ecc-agentshield`](https://www.npmjs.com/package/ecc-agentshield)
- GitHub App: <https://github.com/apps/ecc-tools>
- Website: <https://ecc.tools>

Scan a project with AgentShield:

```bash
npx -y ecc-agentshield scan --path .
```

<details>
<summary><strong>Hooks, MCP servers, and context controls</strong></summary>

Hooks can run shell commands, MCP servers can hold credentials, and project instructions can enter an agent's context. Treat all three as executable configuration.

Do not copy raw `hooks/hooks.json` into `~/.claude/settings.json` after a plugin install. Modern Claude Code versions load plugin hooks automatically, and a second copy can make them fire twice.

Use `/mcp` for Claude Code runtime disables; Claude Code persists those choices in `~/.claude.json`.

`ECC_DISABLED_MCPS` is an ECC install/sync filter, not a live Claude Code toggle.

If context is getting heavy, run `/context-budget`, remove rules you do not need, and disable unused MCP servers. See the [token optimization guide](docs/token-optimization.md).
</details>

Security references:

- [Security policy](SECURITY.md)
- [Security guide](./the-security-guide.md)
- [MCP connector policy](docs/MCP-CONNECTOR-POLICY.md)
- [Supply-chain incident response](docs/security/supply-chain-incident-response.md)

## Troubleshooting

<details>
<summary><strong>ECC appears twice or hooks fire twice</strong></summary>

The usual cause is installing the Claude plugin and then running `install.sh --profile full` or `npx ecc-install --profile full` on top of it.

1. Remove the Claude Code plugin install.
2. Run `node scripts/ecc.js uninstall --dry-run` from the ECC checkout.
3. Remove extra rule folders you manually copied and no longer want.
4. Reinstall once, using one path.

For hook-specific checks, see the [hooks README](hooks/README.md).
</details>

<details>
<summary><strong>Codex marketplace installs but skills do not load</strong></summary>

Run the cache check from an ECC checkout:

```bash
node scripts/codex/check-plugin-cache.js
```

If it reports unresolved parent references, use `bash scripts/sync-ecc-to-codex.sh`. Registration in `codex plugin list` confirms the marketplace entry, not that every referenced file reached the plugin cache.
</details>

<details>
<summary><strong>My platform is not listed</strong></summary>

Use the [manual adaptation guide](docs/MANUAL-ADAPTATION-GUIDE.md), or open a [GitHub discussion](https://github.com/affaan-m/ECC/discussions) with the harness name and the file, skill, command, and hook formats it supports.
</details>

## Community and Project

<details>
<summary><strong>Sponsors and ECC Pro</strong></summary>

ECC stays free because sponsors and Pro users fund the work.

ECC Pro adds private-repo analysis, PR-triggered audits, AgentShield-backed scanning, automatic push and PR checks, pooled team usage, and priority support through the hosted GitHub App.

<table>
<tr>
<td width="25%" align="center"><a href="https://ecc.tools/pricing"><strong>ECC Pro</strong><br /><sub>Hosted GitHub App for private repos</sub></a></td>
<td width="25%" align="center"><a href="https://github.com/sponsors/affaan-m"><strong>Sponsor ECC</strong><br /><sub>Fund the OSS work</sub></a></td>
<td width="25%" align="center"><a href="https://github.com/affaan-m/ECC/discussions"><strong>Community</strong><br /><sub>Q&amp;A, ideas, and Show and Tell</sub></a></td>
<td width="25%" align="center"><a href="https://github.com/apps/ecc-tools"><strong>GitHub App</strong><br /><sub>PR audits and hosted workflows</sub></a></td>
</tr>
</table>

<p align="center" aria-label="Partners and sponsors">
  <a href="https://www.coderabbit.ai" title="CodeRabbit"><img src="assets/images/sponsors/coderabbit.png" height="54" alt="CodeRabbit" /></a>&nbsp;&nbsp;&nbsp;
  <a href="https://www.greptile.com/go/ecc" title="Greptile"><img src="assets/images/sponsors/greptile.png" height="54" alt="Greptile" /></a>&nbsp;&nbsp;&nbsp;
  <a href="https://www.atlascloud.ai/?utm_source=github&amp;utm_medium=link&amp;utm_campaign=ECC" title="Atlas Cloud"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/images/sponsors/atlascloud-dark.svg" /><img src="assets/images/sponsors/atlascloud.svg" width="154" alt="Atlas Cloud" /></picture></a>&nbsp;&nbsp;&nbsp;
  <a href="https://www.moonshot.ai" title="Moonshot AI - Kimi"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/images/sponsors/moonshot-dark.png" /><img src="assets/images/sponsors/moonshot.png" width="132" alt="Moonshot AI - Kimi" /></picture></a>&nbsp;&nbsp;&nbsp;
  <a href="https://compute.itomarkets.com" title="Itô Markets"><picture><source media="(prefers-color-scheme: light)" srcset="assets/images/sponsors/ito-transparent-light.png" /><img src="assets/images/sponsors/ito-transparent.png" width="96" alt="Itô Markets" /></picture></a>
</p>

**Community sponsors:** [Mike Morgan](https://github.com/mikejmorgan-ai) | [@jasonwu513](https://github.com/jasonwu513) | [@1anter](https://github.com/1anter) | [@massimotodaro](https://github.com/massimotodaro) | [@meadmccabe](https://github.com/meadmccabe)

[Become a sponsor](https://github.com/sponsors/affaan-m) | [Sponsor tiers](SPONSORS.md) | [Sponsorship program](SPONSORING.md)
</details>

<details>
<summary><strong>Contributing</strong></summary>

Contributions are welcome across skills, agents, rules, hooks, docs, tests, adapters, and security improvements.

- [Contributing guide](CONTRIBUTING.md)
- [Skill development guide](docs/SKILL-DEVELOPMENT-GUIDE.md)
- [Skill placement policy](docs/SKILL-PLACEMENT-POLICY.md)
- [Command quick reference](COMMANDS-QUICK-REF.md)
</details>

## License

MIT. Use it freely, adapt it to your workflow, and contribute back when you can.
