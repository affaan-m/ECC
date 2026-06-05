# ECC for Gemini CLI

ECC provides Gemini CLI with an instruction layer plus discoverable skills, subagents, and custom commands generated from the canonical ECC repository assets.

## Operating Rules

- Follow the repository `AGENTS.md` guidance when working inside an ECC checkout.
- Use ECC skills from `skills/` for specialized workflows instead of loading all workflow detail into context.
- Use ECC agents from `agents/` for isolated review, planning, research, and implementation support when Gemini CLI subagents are enabled.
- Use ECC commands from `commands/` as reusable slash-command prompts.
- Treat hooks from other harnesses as documented policy unless Gemini CLI native hooks are installed and trusted.

## Surfaces

- Skills: `skills/<name>/SKILL.md`
- Agents: `agents/<name>.md`
- Commands: `commands/<name>.toml`

## Shared Project Instructions

@../AGENTS.md
