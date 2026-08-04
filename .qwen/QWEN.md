# Qwen CLI Configuration

This directory contains ECC's Qwen CLI install template.

## Runtime Location

The source `.qwen/` directory in this repository is copied into a user's home-level `~/.qwen/` install root when running:

```bash
./install.sh --target qwen --profile minimal
```

The managed install also writes `~/.qwen/ecc-install-state.json` so future ECC updates and uninstalls can distinguish ECC-owned files from user-owned Qwen configuration.

## Installed Surface

The Qwen target installs the same managed manifest modules used by other harness adapters:

- `rules/`
- `agents/`
- `commands/`
- `skills/`
- `mcp-configs/`

Hook runtime files are intentionally not selected for Qwen until the Qwen hook/event contract is verified.
