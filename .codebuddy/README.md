# ECC for CodeBuddy

Bring ECC workflows to CodeBuddy IDE. This repository provides custom commands, agents, skills, and rules that can be installed into any CodeBuddy project using the unified Target Adapter architecture.

## Quick Start (Recommended)

Use the unified install system for full lifecycle management:

```bash
# Install with default profile
node scripts/install-apply.js --target codebuddy --profile developer

# Install with full profile (all modules)
node scripts/install-apply.js --target codebuddy --profile full

# Dry-run to preview changes
node scripts/install-apply.js --target codebuddy --profile full --dry-run
```

## Management Commands

```bash
# Check installation health
node scripts/doctor.js --target codebuddy

# Repair installation
node scripts/repair.js --target codebuddy

# Uninstall cleanly (tracked via install-state)
node scripts/uninstall.js --target codebuddy
```

## Shell Script (Legacy)

The legacy shell scripts are still available for quick setup:

```bash
# Install to current project
cd /path/to/your/project
.codebuddy/install.sh

# Install globally
.codebuddy/install.sh ~
```

## What's Included

### Commands

Commands are on-demand workflows invocable via the `/` menu in CodeBuddy chat. All commands are reused directly from the project root's `commands/` folder.

### Agents

Agents are specialized AI assistants with specific tool configurations. All agents are reused directly from the project root's `agents/` folder.

### Skills

Skills are on-demand workflows invocable via the `/` menu in chat. All skills are reused directly from the project's `skills/` folder.

### Rules

Rules provide always-on rules and context that shape how the agent works with your code. Rules are flattened into namespaced files (e.g., `common-coding-style.md`) for CodeBuddy compatibility.

## Project Structure

```
.codebuddy/
├── commands/           # Command files (reused from project root)
├── agents/             # Agent files (reused from project root)
├── skills/             # Skill files (reused from skills/)
├── rules/              # Rule files (flattened from rules/)
├── ecc-install-state.json  # Install state tracking
├── install.sh          # Legacy install script
├── uninstall.sh        # Legacy uninstall script
└── README.md           # This file
```

## Benefits of Target Adapter Install

- **Install-state tracking**: Safe uninstall that only removes ECC-managed files
- **Doctor checks**: Verify installation health and detect drift
- **Repair**: Auto-fix broken installations
- **Selective install**: Choose specific modules via profiles
- **Cross-platform**: Node.js-based, works on Windows/macOS/Linux

## Recommended Workflow

1. **Start with planning**: Use `/plan` command to break down complex features
2. **Write tests first**: Invoke `/tdd` command before implementing
3. **Review your code**: Use `/code-review` after writing code
4. **Check security**: Use `/code-review` again for auth, API endpoints, or sensitive data handling
5. **Fix build errors**: Use `/build-fix` if there are build errors

## Next Steps

- Open your project in CodeBuddy
- Type `/` to see available commands
- Enjoy the ECC workflows!
