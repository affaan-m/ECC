# ECC for the Continue CLI (`cn`)

This fork can install ECC's rules, skills, slash commands, agents, MCP servers and guardrails into the [Continue CLI](https://docs.continue.dev/cli/overview). Nothing in the upstream ECC content is edited. A converter (`scripts/install-continue.js`) translates each piece into the format `cn` actually loads and writes it under `~/.continue`.

Verified against `@continuedev/cli` 1.5.47, the latest release as of October 2026.

## What you get

| ECC (Claude Code) | Continue CLI | How you use it |
|---|---|---|
| `rules/common` + language packs | `~/.continue/rules/ecc/*.md` (always applied) | Automatic in every session |
| `skills/<name>/SKILL.md` | `~/.continue/skills/<name>/` | The model loads them with the **Skills** tool; you can type `/skill-<name>` |
| `commands/*.md` (97) + `contexts/` (3) | `prompts:` in `config.yaml` | `/plan`, `/code-review`, `/build-fix`, `/ctx-dev` ... in the TUI |
| `agents/*.md` (71) | `~/.continue/ecc/agents/*.md` agent files | `ecc-agent code-reviewer "review my diff"` (= `cn --agent <file>`) |
| `agents/` (optional) | Subagent models (`roles: [subagent]`) | `cn --beta-subagent-tool`, then the model delegates |
| `mcp-configs/mcp-servers.json` | `mcpServers:` in `config.yaml` | Opt in per server with `--mcp` |
| `block-no-verify` hook | `~/.continue/permissions.yaml` exclusions | Denies `git ... --no-verify` and `core.hooksPath` overrides |
| `hooks/hooks.json` (curated 7) | `settings.json` hooks via an adapter | Opt in with `--hooks` (see [Limitations](#limitations)) |

A small always-on rule (`00-continue-compat.md`) maps Claude Code vocabulary onto `cn`. For example, `Grep` becomes `Search`, `Glob` becomes `List`, and "delegate to the planner agent" becomes "read `~/.continue/ecc/agents/planner.md` and follow it".

## Prerequisites

- Node.js 18 or newer
- The Continue CLI: `npm i -g @continuedev/cli`
- A working model. Run `cn` once and finish its first-run setup (login or API key) **before** installing ECC. If you have no `~/.continue/config.yaml`, the installer creates one for `anthropic/claude-sonnet-4-6` that reads `ANTHROPIC_API_KEY`.

## Install

```bash
git clone https://github.com/sumitbiranje/ecc.git ~/ecc
cd ~/ecc
./install-continue.sh
```

On Windows (PowerShell):

```powershell
git clone https://github.com/sumitbiranje/ecc.git $HOME\ecc
cd $HOME\ecc
.\install-continue.ps1
```

The default install is the `common` rules, the `core` skill profile (52 skills), all slash commands, all agent files and the guardrails. It goes into `~/.continue`, or `$CONTINUE_GLOBAL_DIR` if you set it. Your existing `config.yaml` is backed up to `config.yaml.ecc-backup` and ECC's lines are appended and tagged `# ecc-managed`.

Add the launchers to your `PATH`:

```bash
echo 'export PATH="$HOME/.continue/ecc/bin:$PATH"' >> ~/.bashrc   # or ~/.zshrc
```

### Common variations

```bash
# Language rules for the stacks you use (see --list for all 21)
./install-continue.sh --langs python,typescript

# A bigger skill set: core | developer | security | research | full | all | none
./install-continue.sh --skills developer --add-skills docker-patterns

# MCP servers from mcp-configs/ (secrets come from env or ~/.continue/.env)
./install-continue.sh --mcp context7,github

# Expose 8 core agents as cn subagents
./install-continue.sh --subagents core --subagent-model anthropic/claude-sonnet-4-6

# Local models (LM Studio / Ollama via an OpenAI-compatible endpoint)
./install-continue.sh --subagents core --subagent-model openai/qwen2.5-coder \
  --api-base http://localhost:1234/v1 --api-key-secret LMSTUDIO_KEY

# Per-project rules, skills and agents in <project>/.continue (languages auto-detected)
./install-continue.sh --scope project --project ~/code/my-app

# See what would change, or list languages, skill profiles and MCP servers
./install-continue.sh --dry-run
./install-continue.sh --list
```

Re-running the installer is safe. It replaces ECC's previous files and config entries instead of duplicating them, and removes skills you dropped from the selection.

## Using it

### Interactive (TUI)

```bash
cd your-project
cn
```

- Type `/` to browse ECC commands such as `/plan add OAuth login`, `/code-review`, `/build-fix`, `/test-coverage`, `/security-scan` and `/refactor-clean`. Anything after the command name is passed to the prompt as its arguments.
- `/skills` lists installed skills. `/skill-tdd-workflow` loads one explicitly. Usually the model picks skills itself from their descriptions.
- `/ctx-dev`, `/ctx-review` and `/ctx-research` switch ECC's working context.
- `/ecc-sessions` is ECC's `/sessions`, renamed so that it does not shadow `cn`'s built-in command.

### Agents

```bash
ecc-agent list
ecc-agent code-reviewer "review the staged changes"
ecc-agent security-reviewer -p "audit src/auth" > audit.md      # headless
```

`ecc-agent <name>` runs `cn --agent ~/.continue/ecc/agents/<name>.md`. The agent's tool list is mapped to `cn` tools, so a read-only reviewer stays read-only.

With `--subagents`, start `cn --beta-subagent-tool` and the main agent can hand work to `planner`, `code-reviewer`, `security-reviewer` and others in the background. Each subagent entry is only a few lines; it reads its full instructions from the agent file when it starts. That keeps the Subagent tool description small.

### Headless and CI

`cn` expands `/slash` commands only in the TUI. For scripts, use the plain prompt files:

```bash
ecc-prompt list
ecc-prompt code-review -p "focus on src/api"
# same as: cn -p --prompt ~/.continue/ecc/prompts/code-review.md "focus on src/api"
```

### Guardrails

`~/.continue/permissions.yaml` gets two exclusions: `Bash(*--no-verify*)` and `Bash(*core.hooksPath*)`. `cn` denies matching commands in the TUI and in `-p` runs. **`--auto` overrides every permission policy**, these included. Skip them with `--no-guardrails`.

## Update

```bash
cd ~/ecc
git pull
./install-continue.sh     # with the same options you used before
```

To pull in new upstream ECC releases, sync your fork with `affaan-m/ECC` on GitHub first.

## Uninstall

```bash
./install-continue.sh --uninstall
./install-continue.sh --scope project --project ~/code/my-app --uninstall
```

This removes ECC's rules, skills, agents, prompt blocks, guardrails and hooks, and strips the `# ecc-managed` lines from `config.yaml`. Your own entries are left as they were.

## Limitations

These are differences in what `cn` supports, not bugs in the conversion:

- **Hooks do not run yet.** `cn` 1.5.47 reads Claude-Code-style hooks from `settings.json`, but its tool loop never fires them. `--hooks` installs seven ECC hooks through `scripts/hooks/continue-hook-adapter.js`, which already normalises `cn` payloads (tool names, `filepath` versus `file_path`). They are inert until Continue wires hook events up. Session memory, cost tracking and the format/typecheck-on-stop hooks are therefore not available. The `--no-verify` protection is covered by the permissions file instead.
- **Rules are always on.** `cn` injects only always-apply rules, so a language pack applies to every file once you install it. Pick languages with `--langs`, or use `--scope project` per repository.
- **Skills cost context.** `cn` lists every installed skill's name and description in the Skills tool on each request. `core` costs about 4.5k tokens, `developer` about 10k and `all` about 25k.
- **Agent `model:` is ignored.** `cn` resolves agent-file models from the Continue Hub, so ECC's `sonnet`/`opus` aliases are dropped and the session model is used. MCP tools and `WebSearch` in an agent's tool list are dropped too, because agent files can only name Hub MCP servers.
- **Claude-only features** such as plugin marketplaces, the statusline and `/hookify` have no `cn` equivalent. Commands that depend on them still install but only partly work in `cn`.

## Troubleshooting

- **`cn` asks for an Anthropic API key.** First-run onboarding has not completed. Finish it, or start with `cn --config ~/.continue/config.yaml`, then rerun the installer.
- **`Failed to load config`.** Run `cn --verbose` to see which block failed. Your pre-install config is in `~/.continue/config.yaml.ecc-backup`.
- **An MCP server fails to start.** Set its secrets (the installer prints the names) in your shell or in `~/.continue/.env`. Servers with placeholders, such as `filesystem` and `supabase`, need their block in `~/.continue/ecc/blocks/mcp/` edited.
- **A skill was skipped.** A skill with the same name already existed and was not installed by ECC. Pass `--force` to replace it.

## Files written

```text
~/.continue/
├── config.yaml                 # + prompts / mcpServers / models entries (# ecc-managed)
├── permissions.yaml            # + guardrail exclusions
├── rules/ecc/                  # compat rule + common + chosen languages
├── skills/<name>/              # selected skills
├── settings.json               # only with --hooks
└── ecc/
    ├── agents/*.md             # cn agent files
    ├── prompts/*.md            # headless prompt files
    ├── blocks/{prompts,mcp,subagents}/*.yaml
    ├── bin/ecc-agent, ecc-prompt (+ .cmd)
    └── install-manifest.json
```

The converter lives in `scripts/lib/continue-cli.js`. Its tests are `tests/lib/continue-cli.test.js`, `tests/hooks/continue-hook-adapter.test.js` and `tests/scripts/install-continue.test.js`.
