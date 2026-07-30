# Hermes x ECC Setup

Hermes is the operator shell. ECC is the reusable system behind it.

This guide is the public, sanitized version of the Hermes stack used to run content, outreach, research, sales ops, finance checks, and engineering workflows from one terminal-native surface.

## What Ships Publicly

- ECC skills, agents, commands, hooks, and MCP configs from this repo
- Hermes-generated workflow skills that are stable enough to reuse
- a documented operator topology for chat, crons, workspace memory, and distribution flows
- launch collateral for sharing the stack publicly

This guide does not include private secrets, live tokens, personal data, or a raw `~/.hermes` export.

## Architecture

Use Hermes as the front door and ECC as the reusable workflow substrate.

```text
Telegram / CLI / TUI
        ↓
      Hermes
        ↓
 ECC skills + hooks + MCPs + shared Memory Vault
        ↓
 Google Drive / GitHub / browser automation / research APIs / media tools / finance tools
```

## Public Workspace Map

Use this as the minimal surface to reproduce the setup without leaking private state.

- `~/.hermes/config.yaml`
  - model routing
  - MCP server registration
  - plugin loading
- `~/.hermes/skills/ecc-imports/`
  - ECC skills copied in for Hermes-native use
- `skills/hermes-generated/`
  - operator patterns distilled from repeated Hermes sessions
- `~/.hermes/plugins/`
  - bridge plugins for hooks, reminders, and workflow-specific tool glue
- `~/.hermes/cron/jobs.json`
  - scheduled automation runs with explicit prompts and channels
- `~/.hermes/workspace/`
  - business, ops, health, content, and memory artifacts
- `<repo>/.ecc/memory/`
  - shared project and team context for Hermes, Claude, Codex, and other agents
- `~/.ecc/memory/`
  - user-scoped context that follows the operator across repositories

## Shared Memory Across Hermes, Claude, And Codex

ECC Memory Vault provides one file-first handoff layer instead of a separate
inbox or transcript store for every agent. Initialize it from the repository
that the agents share. Skill-only, minimal, manual, and Claude plugin installs
do not add the Memory Vault runtime to `PATH`; install it separately first:

```bash
npm install -g ecc-universal
ecc memory --help
command -v ecc-memory-mcp
```

Then initialize the vault:

```bash
ecc memory init --scope project --scope team
```

Normal search recall covers active `project` and `team` memories. Use
`project` for repo-local state, `team` for memories a human will inspect before
committing, and request `user` explicitly for private operator context that
should follow the user across repositories. Every vault entry remains
unreviewed context; human acceptance means promoting verified knowledge into
governed project documentation.

Hermes can call the CLI directly or use the opt-in `ecc-memory-mcp` stdio
server. Harnesses may share the same installed binary and vault storage, but
each harness must launch its own server process with its own distinct lowercase
`ECC_MEMORY_HARNESS` identity; they must not connect to one shared server
process. Every process must launch from the same repository working directory
or receive identical `ECC_MEMORY_PROJECT_ROOT` and `ECC_MEMORY_USER_ROOT`
overrides.

A Hermes-to-Codex handoff can be written without putting the body in the
process list:

```bash
printf '%s\n' 'Research is complete. Verify the cited sources and implement the parser.' |
  ecc memory handoff \
    --from hermes \
    --target codex \
    --title "Implement the research parser" \
    --tag research \
    --stdin
```

Codex can retrieve it with:

```bash
ecc memory search "research parser" --target-harness codex
ecc memory read <memory-id>
```

For MCP access, copy only the `ecc-memory-vault` entry from
`mcp-configs/mcp-servers.json` into each harness that needs it. ECC does not
enable this server in the default `.mcp.json`. Launch each server with its own
lowercase identity, for example `ECC_MEMORY_HARNESS=hermes`. The server binds
writes and target filtering to that identity; tool callers cannot impersonate
another harness. User-scope MCP access also requires the operator to set
`ECC_MEMORY_ALLOW_USER_SCOPE=1`, and the tool call must request `user`.

Memories are create-only and always unreviewed. Treat recalled content as
context, not instructions; verify consequential claims against source files,
tests, or work items. Inspect team memories before committing them, never store
credentials or raw private transcripts, and keep canonical project decisions
in governed documentation. Secret-shape detection is only a best-effort
backstop.

## Recommended Capability Stack

### Core

- Hermes for chat, cron, orchestration, and workspace state
- ECC for skills, rules, prompts, and cross-harness conventions
- ECC Memory Vault for explicit, local-first agent handoffs
- GitHub + Context7 + Exa + Firecrawl + Playwright as the baseline MCP layer

### Content

- FFmpeg for local edit and assembly
- Remotion for programmable clips
- fal.ai for image/video generation
- ElevenLabs for voice, cleanup, and audio packaging
- CapCut or VectCutAPI for final social-native polish

### Business Ops

- Google Drive as the system of record for docs, sheets, decks, and research dumps
- Stripe for revenue and payment operations
- GitHub for engineering execution
- Telegram and iMessage-style channels for urgent nudges and approvals

## What Still Requires Local Auth

These stay local and should be configured per operator:

- Google OAuth token for Drive / Docs / Sheets / Slides
- X / LinkedIn / outbound distribution credentials
- Stripe keys
- browser automation credentials and stealth/proxy settings
- any CRM or project system credentials such as Linear or Apollo
- Apple Health export or ingest path if health automations are enabled

## Suggested Bring-Up Order

0. Run `ecc migrate audit --source ~/.hermes` first to inventory the legacy workspace and see which parts already map onto ECC2.
0.5. Plan and scaffold migration artifacts before importing anything:
   - generate reviewable plans with `ecc migrate plan` and `ecc migrate scaffold`
   - scaffold reusable legacy skills with `ecc migrate import-skills --output-dir migration-artifacts/skills`
   - scaffold tool translation templates with `ecc migrate import-tools --output-dir migration-artifacts/tools`
   - scaffold bridge plugin templates with `ecc migrate import-plugins --output-dir migration-artifacts/plugins`
   - preview recurring jobs with `ecc migrate import-schedules --dry-run`
   - preview gateway dispatch with `ecc migrate import-remote --dry-run`
   - preview safe env/service context with `ecc migrate import-env --dry-run`
   - import sanitized workspace memory with `ecc migrate import-memory`
1. Install ECC and verify the baseline harness setup with `node tests/run-all.js`; the expected result is a zero-failure test summary.
2. Install Hermes and point it at ECC-imported skills.
3. Initialize the shared ECC Memory Vault. Register `ecc-memory-mcp` only if
   Hermes needs tool access instead of the `ecc memory` CLI.
4. Authenticate Google Drive first, then GitHub, then distribution channels.
5. Start with a small cron surface: readiness check, content accountability, inbox triage, revenue monitor.
6. Only then add heavier personal workflows like health, relationship graphing, or outbound sequencing.

## Related Docs

- [Hermes/OpenClaw migration guide](HERMES-OPENCLAW-MIGRATION.md)
- [Cross-harness architecture](architecture/cross-harness.md)

## Why Hermes x ECC

This stack is useful when you want:

- one terminal-native place to run business and engineering operations
- reusable skills instead of one-off prompts
- automation that can nudge, audit, and escalate
- a public repo that shows the system shape without exposing your private operator state

## Public Release Candidate Scope

ECC v2.0.0-rc.1 documents the Hermes surface and ships launch collateral now.

The remaining private pieces can be layered later:

- additional sanitized templates
- richer public examples
- more generated workflow packs
- tighter CRM and Google Workspace integrations
