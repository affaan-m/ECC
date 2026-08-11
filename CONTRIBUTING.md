# Contributing to Everything Claude Code

Thanks for wanting to contribute. This repo is meant to be a community resource for Claude Code users.

## What We're Looking For

### Agents

New agents that handle specific tasks well:

- Language-specific reviewers (Python, Go, Rust)
- Framework experts (Django, Rails, Laravel, Spring)
- DevOps specialists (Kubernetes, Terraform, CI/CD)
- Domain experts (ML pipelines, data engineering, mobile)

### Skills

Workflow definitions and domain knowledge:

- Language best practices
- Framework patterns
- Testing strategies
- Architecture guides
- Domain-specific knowledge

### Commands

Slash commands that invoke useful workflows:

- Deployment commands
- Testing commands
- Documentation commands
- Code generation commands

### Hooks

Useful automations:

- Linting/formatting hooks
- Security checks
- Validation hooks
- Notification hooks

### Rules

Always-follow guidelines:

- Security rules
- Code style rules
- Testing requirements
- Naming conventions

### MCP Configurations

New or improved MCP server configs:

- Database integrations
- Cloud provider MCPs
- Monitoring tools
- Communication tools

---

## How to Contribute

### 1. Fork the repo

```bash
git clone https://github.com/YOUR_USERNAME/everything-claude-code.git
cd everything-claude-code
```

### 2. Create a branch

```bash
git checkout -b add-python-reviewer
```

### 3. Add your contribution

Place files in the appropriate directory:

- `agents/` for new agents
- `skills/` for skills (can be single .md or directory)
- `commands/` for slash commands
- `rules/` for rule files
- `hooks/` for hook configurations
- `content/mcp/` for MCP server configs

### 4. Follow the format

**Agents** should have frontmatter:

```markdown
---
name: agent-name
description: What it does
tools: Read, Grep, Glob, Bash
model: sonnet
---

Instructions here...
```

**Skills** should be clear and actionable:

```markdown
# Skill Name

## When to Use

...

## How It Works

...

## Examples

...
```

**Commands** should explain what they do:

```markdown
---
description: Brief description of command
---

# Command Name

Detailed instructions...
```

**Hooks** should include descriptions:

```json
{
  "matcher": "...",
  "hooks": [...],
  "description": "What this hook does"
}
```

### 5. Test your contribution

Make sure your config works with Claude Code before submitting.

### 6. Submit a PR

```bash
git add .
git commit -m "Add Python code reviewer agent"
git push origin add-python-reviewer
```

Then open a PR with:

- What you added
- Why it's useful
- How you tested it

---

## Guidelines

### Do

- Keep configs focused and modular
- Include clear descriptions
- Test before submitting
- Follow existing patterns
- Document any dependencies

### Don't

- Include sensitive data (API keys, tokens, paths)
- Add overly complex or niche configs
- Submit untested configs
- Create duplicate functionality
- Add configs that require specific paid services without alternatives

---

## File Naming

- Use lowercase with hyphens: `python-reviewer.md`
- Be descriptive: `tdd-workflow.md` not `workflow.md`
- Match the agent/skill name to the filename

---

## Questions?

Open an issue or reach out on X: [@affaanmustafa](https://x.com/affaanmustafa)

---

Thanks for contributing. Let's build a great resource together.
