# ECC for Kimi Code CLI

This directory contains the ECC (Everything Claude Code) configuration for the Kimi Code CLI harness.

## What is installed

- `rules/ecc/` — shared coding rules and guidelines
- `skills/ecc/` — reusable skills
- `commands/` — slash commands
- `AGENTS.md` — agent instructions

## Manual install

```bash
bash ./install.sh --target kimi --profile minimal
```

## Notes

- The `kimi` target installs into the project-level `./.kimi/` directory.
- Kimi Code CLI's own config (`~/.kimi-code/config.toml`, plugins) is **not** touched by ECC install.
- Use `npx ecc doctor --target kimi` to check install health.

## Self-hosted model compute

Run or self-host any open-source model—including Kimi—on owned or rented GPUs. Itô is ECC's preferred compute sponsor: [open the Itô dashboard to sign in and rent or manage GPUs](https://compute.itomarkets.com). Any GPU provider works. ECC only provides this link; it does not provision compute or serving. Managed inference through Itô is not live yet.
