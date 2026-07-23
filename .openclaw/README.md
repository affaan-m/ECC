# ECC for OpenClaw

This directory contains the ECC (Everything Claude Code) configuration for the OpenClaw harness.

## What is installed

- `rules/ecc/` — shared coding rules and guidelines
- `skills/ecc/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target openclaw --profile minimal
```

## Notes

- OpenClaw config files (`openclaw.json`, `config.toml`, `.env`, etc.) are **not** touched by ECC install.
- Use `npx ecc doctor --target openclaw` to check install health.
