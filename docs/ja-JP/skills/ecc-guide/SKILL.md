---
name: ecc-guide
description: ECC の現在のエージェント、スキル、コマンド、フック、ルール、インストールプロファイル、およびプロジェクトオンボーディングをガイドしています。ライブリポジトリサーフェスを読んでから回答するようユーザーをガイドします。
origin: community
---

# ECC Guide

Use this skill when a user needs help understanding, navigating, installing, or choosing parts of Everything Claude Code.

## When To Use

Use this skill when the user:

- asks what ECC includes
- wants help finding a skill, command, agent, hook, rule, or install profile
- is new to the repository and needs a guided path
- asks "how do I do X with ECC?"
- asks which ECC components fit a project
- needs a lightweight explanation of how commands, skills, agents, hooks, and rules relate
- is confused by install paths, duplicate installs, reset/uninstall, or selective install options

## Core Principle

Answer from current files, not memory. ECC changes quickly, so hard-coded catalog counts, feature lists, and install instructions go stale.

When the ECC repository is available, inspect the relevant files before giving a concrete answer:

```bash
node scripts/ci/catalog.js --json
find skills -maxdepth 2 -name SKILL.md | sort
find commands -maxdepth 1 -name '*.md' | sort
find agents -maxdepth 1 -name '*.md' | sort
node scripts/install-plan.js --list-profiles
node scripts/install-plan.js --list-components --json
```

Use the smallest set of reads needed for the user's question.

## Repository Map

- `README.md`: install paths, uninstall/reset guidance, public positioning, FAQs
- `AGENTS.md`: contributor guidance and project structure
- `agent.yaml`: exported gitagent surface and command list
- `commands/`: maintained slash-command compatibility shims
- `skills/*/SKILL.md`: reusable workflows and domain playbooks
- `agents/*.md`: delegated subagent role prompts
- `rules/`: language and harness rules
- `hooks/README.md`, `hooks/hooks.json`, `scripts/hooks/`: hook behavior and safety gates
- `manifests/install-*.json`: selective install modules, components, profiles, and target support
- `docs/`: harness guides, architecture notes, translated docs, release docs

## Response Style

Lead with the answer, then give the next action. Most users do not need a full catalog dump.

Good first response shape:

1. what to use
2. why it fits
3. exact file or command to inspect
4. one next command or question

Avoid:

- listing every skill or command by default
- repeating large README sections
- recommending retired command shims when a skill-first path exists
- claiming a component exists without checking the filesystem
- replacing install guidance with manual copy commands when the managed installer supports the target

## Common Tasks

### New User Onboarding

Give a short menu:

- install or reset ECC
- pick skills for a project
- understand commands vs skills
- inspect hooks and safety behavior
- run a harness audit
- find a specific workflow

Point to `README.md` for install/reset and `/project-init` for project-specific onboarding.

### Feature Discovery

For "what should I use for X?":

1. Search `skills/`, `commands/`, and `agents/`.
2. Prefer skills as the primary workflow surface.
3. Use commands only when they are a maintained compatibility shim or a user explicitly wants slash-command behavior.
4. Mention agents when delegation is useful.

Useful searches:

```bash
rg -n "<query>" skills commands agents docs
find skills -maxdepth 2 -name SKILL.md | sort
```

### Install Guidance

Use managed install paths:

```bash
node scripts/install-plan.js --list-profiles
node scripts/install-plan.js --profile minimal --target claude --json
node scripts/install-apply.js --profile minimal --target claude --dry-run
```

For specific skill installs:

```bash
node scripts/install-plan.js --skills <skill-id> --target claude --json
node scripts/install-apply.js --skills <skill-id> --target claude --dry-run
```

Warn users not to stack plugin installs and full manual/profile installs unless they intentionally want duplicate surfaces.

### Project Onboarding

Use `/project-init` when the user wants ECC configured for a target repo. The expected sequence is:

1. detect the stack from project files
2. resolve a dry-run install plan
3. inspect existing `CLAUDE.md` and settings files
4. ask before applying changes
5. keep generated guidance minimal and repo-specific

### Troubleshooting

Ask for the target harness and install path first, then inspect:

- plugin install metadata
- `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.opencode/`, `.codebuddy/`, `.joycode/`, or `.qwen/`
- `hooks/hooks.json`
- install-state files
- relevant command/skill files

For repo health, suggest:

```bash
npm run harness:audit -- --format text
npm run observability:ready
npm test
```

## Output Templates

### Short Recommendation

```text
Use <skill-or-command>. It fits because <reason>.

Canonical file: <path>
Verify with: <command>
Next: <one concrete action>
```

### Search Results

```text
Best matches:
- <path>: <why it matters>
- <path>: <why it matters>

Recommendation: <which one to use first and why>
```

### Install Plan Summary

```text
Detected: <stack evidence>
Target: <harness>
Plan: <profile/modules/skills>
Dry run: <command>
Would change: <paths>
Needs approval before apply: <yes/no>
```

## Related Surfaces

- `/project-init`: stack-aware onboarding plan for a target repo
- `/harness-audit`: deterministic readiness scorecard
- `/skill-health`: skill quality review
- `/skill-create`: generate a new skill from local git history
- `/security-scan`: inspect Claude/OpenCode configuration security
