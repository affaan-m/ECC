---
name: team-builder
description: Interactive agent picker for composing and dispatching parallel teams
origin: community
---

# Team Builder

Interactive menu for browsing and composing agent teams on demand. Works with flat or domain-subdirectory agent collections.

## When to Use

- You have multiple agent personas (markdown files) and want to pick which ones to use for a task
- You want to compose an ad-hoc team from different domains (e.g., Security + SEO + Architecture)
- You want to browse what agents are available before deciding

## Prerequisites

Agent files must be markdown files containing a persona prompt (identity, rules, workflow, deliverables). The first `# Heading` is used as the agent name and the first paragraph as the description.

Both flat and subdirectory layouts are supported:

**Subdirectory layout** — domain is inferred from the folder name:

```
agents/
├── engineering/
│   ├── security-engineer.md
│   └── software-architect.md
├── marketing/
│   └── seo-specialist.md
└── sales/
    └── discovery-coach.md
```

**Flat layout** — domain inferred from shared filename prefixes. A prefix counts as a domain when 2+ files share it. Files with unique prefixes go to "General". Note: the algorithm splits at the first `-`, so multi-word domains (e.g., `product-management`) should use the subdirectory layout instead:

```
agents/
├── engineering-security-engineer.md
├── engineering-software-architect.md
├── marketing-seo-specialist.md
├── marketing-content-strategist.md
├── sales-discovery-coach.md
└── sales-outbound-strategist.md
```

## Configuration

Agents are discovered via two methods, merged and deduplicated by agent name:

1. **`claude agents` command** (primary) — run `claude agents` to get all agents known to the CLI, including user agents, plugin agents (e.g. `everything-claude-code:architect`), and built-in agents. This automatically covers ECC marketplace installs without any path configuration.
2. **File glob** (fallback, for reading agent content) — agent markdown files are read from:
   - `./agents/**/*.md` + `./agents/*.md` — project-local agents
   - `~/.claude/agents/**/*.md` + `~/.claude/agents/*.md` — global user agents

Earlier sources take precedence when names collide: user agents > plugin agents > built-in agents. A custom path can be used instead if the user specifies one.

## How It Works

### Step 1: Discover Available Agents

Run `claude agents` to get the full agent list. Parse each line:
- **Plugin agents** are prefixed with `plugin-name:` (e.g., `everything-claude-code:security-reviewer`). Use the part after `:` as the agent name and the plugin name as the domain.
- **User agents** have no prefix. Read the corresponding markdown file from `~/.claude/agents/` or `./agents/` to extract the name and description.
- **Built-in agents** (e.g., `Explore`, `Plan`) are skipped unless the user explicitly asks to include them.

For user agents loaded from markdown files:
- **Subdirectory layout:** extract the domain from the parent folder name
- **Flat layout:** collect all filename prefixes (text before the first `-`). A prefix qualifies as a domain only if it appears in 2 or more filenames (e.g., `engineering-security-engineer.md` and `engineering-software-architect.md` both start with `engineering` → Engineering domain). Files with unique prefixes (e.g., `code-reviewer.md`, `tdd-guide.md`) are grouped under "General"
- Extract the agent name from the first `# Heading`. If no heading is found, derive the name from the filename (strip `.md`, replace hyphens with spaces, title-case)
- Extract a one-line summary from the first paragraph after the heading

If no agents are found after running `claude agents` and probing file locations, inform the user: "No agents found. Run `claude agents` to verify your setup." Then stop.

### Step 2: Present Domain Menu

```
Available agent domains:
1. Engineering — Software Architect, Security Engineer
2. Marketing — SEO Specialist
3. Sales — Discovery Coach, Outbound Strategist

Pick domains or name specific agents (e.g., "1,3" or "security + seo"):
```

- Skip domains with zero agents (empty directories)
- Show agent count per domain

### Step 3: Handle Selection

Accept flexible input:
- Numbers: "1,3" selects all agents from Engineering and Sales
- Names: "security + seo" fuzzy-matches against discovered agents
- "all from engineering" selects every agent in that domain

If more than 5 agents are selected, list them alphabetically and ask the user to narrow down: "You selected N agents (max 5). Pick which to keep, or say 'first 5' to use the first five alphabetically."

Confirm selection:
```
Selected: Security Engineer + SEO Specialist
What should they work on? (describe the task):
```

### Step 4: Spawn Agents in Parallel

1. Read each selected agent's markdown file
2. Prompt for the task description if not already provided
3. Spawn all agents in parallel using the Agent tool:
   - `subagent_type: "general-purpose"`
   - `prompt: "{agent file content}\n\nTask: {task description}"`
   - Each agent runs independently — no inter-agent communication needed
4. If an agent fails (error, timeout, or empty output), note the failure inline (e.g., "Security Engineer: failed — [reason]") and continue with results from agents that succeeded

### Step 5: Synthesize Results

Collect all outputs and present a unified report:
- Results grouped by agent
- Synthesis section highlighting:
  - Agreements across agents
  - Conflicts or tensions between recommendations
  - Recommended next steps

If only 1 agent was selected, skip synthesis and present the output directly.

## Rules

- **Dynamic discovery only.** Never hardcode agent lists. New files in the directory auto-appear in the menu.
- **Max 5 agents per team.** More than 5 produces diminishing returns and excessive token usage. Enforce at selection time.
- **Parallel dispatch.** All agents run simultaneously — use the Agent tool's parallel invocation pattern.
- **Parallel Agent calls, not TeamCreate.** This skill uses parallel Agent tool calls for independent work. TeamCreate (a Claude Code tool for multi-agent dialogue) is only needed when agents must debate or respond to each other.

## Examples

```
User: team builder

Claude:
Available agent domains:
1. Engineering (2) — Software Architect, Security Engineer
2. Marketing (1) — SEO Specialist
3. Sales (4) — Discovery Coach, Outbound Strategist, Proposal Strategist, Sales Engineer
4. Support (1) — Executive Summary

Pick domains or name specific agents:

User: security + seo

Claude:
Selected: Security Engineer + SEO Specialist
What should they work on?

User: Review my Next.js e-commerce site before launch

[Both agents spawn in parallel, each applying their specialty to the codebase]

Claude:
## Security Engineer Findings
- [findings...]

## SEO Specialist Findings
- [findings...]

## Synthesis
Both agents agree on: [...]
Tension: Security recommends CSP that blocks inline styles, SEO needs inline schema markup. Resolution: [...]
Next steps: [...]
```
