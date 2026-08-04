---
description: Detect a project's stack and produce a dry-run ECC onboarding plan using the repository's install manifests and stack mappings.
---

# /project-init

Create a safe, reviewable ECC onboarding plan for the current project. This command should start in dry-run mode and only write files after explicit user approval.

## Usage

```text
/project-init
/project-init --dry-run
/project-init --target claude
/project-init --target cursor
/project-init --skills continuous-learning-v2,security-review
/project-init --config ecc-install.json
```

## Safety Rules

1. Default to dry-run. Do not modify `CLAUDE.md`, settings files, rules, skills, or install state until the user approves the concrete plan.
2. Preserve existing project guidance. If `CLAUDE.md`, `.claude/settings.local.json`, `.cursor/`, `.codex/`, `.gemini/`, `.opencode/`, `.codebuddy/`, `.joycode/`, or `.qwen/` already exists, inspect it and propose a merge/append plan instead of overwriting.
3. Use ECC's installer and manifest tooling. Do not hand-copy files or clone arbitrary remotes as an install shortcut.
4. Keep permissions narrow. Any generated settings should match detected build/test/lint tools and avoid broad shell access.
5. Report exactly what would change before applying anything.

## Detection Inputs

Read the current project root and detect stack signals from:

- package manager files: `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`
- language manifests: `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `build.gradle.kts`
- framework files: `next.config.*`, `vite.config.*`, `tailwind.config.*`, `Dockerfile`, `docker-compose.yml`
- ECC config: `ecc-install.json`
- optional stack map: `config/project-stack-mappings.json` in the ECC repo

When the ECC checkout is available, use `config/project-stack-mappings.json` as the stack-to-rules/skills reference. If the file is unavailable, fall back to the installed ECC manifests and explicit user choices.

## Planning Flow

1. Identify the target harness. Default to `claude` unless the user asks for `cursor`, `codex`, `gemini`, `opencode`, `codebuddy`, `joycode`, or `qwen`.
2. Detect stacks from project files and show the evidence for each match.
3. Resolve the smallest useful ECC plan:
   - project has an `ecc-install.json`: `node scripts/install-plan.js --config ecc-install.json --json`
   - user named a profile: `node scripts/install-plan.js --profile <profile> --target <target> --json`
   - user named skills: `node scripts/install-plan.js --skills <skill-ids> --target <target> --json`
   - only language stacks are detected: use the legacy language install dry-run with those language names
4. Run a dry-run apply command before writing:

```bash
node scripts/install-apply.js --target <target> --dry-run --json <language-or-profile-args>
```

5. Summarize detected stacks, selected modules/components/skills, target paths, skipped unsupported modules, and files that would be changed.
6. Ask for approval before applying the non-dry-run command.

## Output Contract

Return:

1. detected stack evidence
2. proposed target harness
3. exact dry-run command used
4. exact apply command to run after approval
5. files/directories that would be created or changed
6. warnings about existing files, broad permissions, missing scripts, or unsupported targets

## CLAUDE.md Guidance

If the user wants a `CLAUDE.md` starter, generate it separately from the installer plan and keep it minimal:

- build command, if detected
- test command, if detected
- lint/typecheck command, if detected
- dev server command, if detected
- repo-specific notes from existing package scripts or manifests

Never replace an existing `CLAUDE.md` without showing a diff and receiving approval.

## Related

- `config/project-stack-mappings.json` for stack-to-surface hints
- `scripts/install-plan.js` for deterministic plan resolution
- `scripts/install-apply.js` for dry-run and apply operations
- `/ecc-guide` for interactive feature discovery before installing
