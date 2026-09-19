# ECC for Hermes

This directory contains the ECC (Everything Claude Code) configuration for the Hermes operator shell.

## Overview

Hermes is the operator shell for ECC. This directory provides a complete ECC harness configuration including rules, commands, agents, and skills optimized for Hermes workflows.

## Directory Structure

```
.hermes/
├── AGENTS.md              # Agent instructions and orchestration guide
├── config.json            # Hermes harness configuration
├── README.md              # This file
├── commands/              # 94 slash commands
├── rules/                 # 122 flattened coding rules
├── skills/                # 48 curated skills
└── scripts/               # Harness audit and health scripts
```

## What's Included

### Agents (27 specialized agents)
- **planner** — Implementation planning for complex features
- **architect** — System design and scalability decisions
- **tdd-guide** — Test-driven development enforcement
- **code-reviewer** — Code quality and maintainability
- **security-reviewer** — Vulnerability detection
- **build-error-resolver** — Build/type error fixes
- **e2e-runner** — End-to-end Playwright testing
- **refactor-cleaner** — Dead code cleanup
- **doc-updater** — Documentation and codemaps
- And 18 more specialized agents...

### Commands (94 slash commands)
Core workflow commands including:
- `/plan` — Create implementation plan
- `/tdd` — TDD workflow with 80%+ coverage
- `/code-review` — Review code changes
- `/security` — Security review
- `/build-fix` — Fix build errors
- `/e2e` — E2E tests
- `/verify` — Verification loop
- `/orchestrate` — Multi-agent workflow
- And 86 more commands...

### Rules (122 flattened rules)
Language-specific and common rules for:
- Common coding style, security, testing patterns
- Angular, React, Vue, TypeScript, Python, Go, Rust, Java, Kotlin, C++, and more
- Framework-specific patterns and best practices

### Skills (48 curated skills)
Including:
- **tdd-workflow** — Test-driven development
- **security-review** — Security analysis
- **eval-harness** — Evaluation-driven development
- **verification-loop** — Build, test, lint, typecheck
- **strategic-compact** — Context management
- **e2e-testing** — Playwright E2E tests
- **continuous-learning** — Pattern extraction
- And 41 more skills...

## Installation

### Automatic Install (Recommended)

```bash
bash ./install.sh --target hermes --profile minimal
```

### Available Profiles

- **minimal** — Rules, agents, commands, platform configs (no hooks)
- **core** — Minimal + hooks runtime
- **developer** — Core + framework/language/database skills
- **security** — Core + security-focused guidance
- **research** — Core + research and content workflows
- **full** — Complete ECC install with all modules

### Manual Install

```bash
# Install specific modules
bash ./install.sh --target hermes --modules rules-core,agents-core,commands-core

# Install with skills
bash ./install.sh --target hermes --skills tdd-workflow,security-review

# Dry run to preview
bash ./install.sh --target hermes --profile developer --dry-run
```

## Health Check

```bash
npx ecc-universal doctor --target hermes
```

## Configuration

The `config.json` file defines the Hermes harness configuration:

- **version** — ECC version (2.2.1)
- **harness** — Target harness name
- **modules** — Available module definitions
- **features** — Enabled features (agents, commands, rules, skills)
- **paths** — Directory structure paths

## Usage with Hermes

After installation, Hermes will have access to:

1. **Agent Instructions** — Read `AGENTS.md` for agent orchestration guidelines
2. **Slash Commands** — Use `/command-name` syntax for workflow commands
3. **Coding Rules** — Rules are automatically applied based on file context
4. **Skills** — Load skills for specialized workflows

## Notes

- Hermes config files (`config.yaml`, `.env`, etc.) are **not** touched by ECC install
- The `.hermes/` directory is self-contained and portable
- Rules are flattened with namespace prefixes for easy discovery
- Skills include full documentation and workflow instructions

## Troubleshooting

1. **Install fails** — Check Node.js version (requires 18+)
2. **Missing skills** — Run `npx ecc-universal doctor --target hermes`
3. **Rules not applied** — Verify rules directory is in Hermes config path
4. **Commands not found** — Ensure commands directory is accessible

## Contributing

To add new rules, commands, or skills:

1. Add source files to the appropriate ECC directory
2. Update `manifests/install-modules.json` if adding new modules
3. Run `node scripts/flatten-rules-for-hermes.js` to update flattened rules
4. Run `node scripts/copy-hermes-skills.js` to update skills
5. Test with `bash ./install.sh --target hermes --dry-run`

## License

MIT
