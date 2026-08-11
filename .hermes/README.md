# ECC for Hermes

This directory contains the ECC (Everything Claude Code) configuration for the Hermes harness.

## What is installed

- `rules/ecc/` — shared coding rules and guidelines
- `skills/ecc/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target hermes --profile minimal
```

## Notes

- Hermes config files (`config.yaml`, `.env`, etc.) are **not** touched by ECC install.
- Use `npx ecc doctor --target hermes` to check install health.
