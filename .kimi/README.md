# ECC for Kimi Code CLI

This directory contains the ECC (Everything Claude Code) configuration for the Kimi Code CLI harness.

## What Kimi Code discovers natively

- `AGENTS.md` — project instructions loaded by Kimi Code's hierarchical instruction discovery
- `skills/` — project skills loaded by Kimi Code's native Agent Skills discovery

ECC also copies shared rules, agents, and legacy command shims into `.kimi/` for portability and reference. Kimi Code's native invocation surface is Agent Skills (`/skill:<name>` and `/flow:<name>`), not arbitrary Markdown files in `commands/`.

## Manual install

```bash
bash ./install.sh --target kimi --profile minimal
```

## Notes

- The `kimi` target installs into the project-level `./.kimi/` directory.
- Kimi Code CLI's own config (`~/.kimi-code/config.toml`, plugins) is **not** touched by ECC install.
- Use `npx ecc doctor --target kimi` to check install health.
- Kimi Code provider configuration remains separate. Use the [official providers and models guide](https://moonshotai.github.io/kimi-cli/en/configuration/providers.html) for Kimi API, OpenAI-compatible, Anthropic, or other supported endpoints.
- Kimi Code's [Agent Skills guide](https://moonshotai.github.io/kimi-cli/en/customization/skills.html) documents the `.kimi/skills/` discovery contract.

## Self-hosted model compute

Run or self-host any open-source model—including Kimi—on owned or rented GPUs. Itô is ECC's preferred compute sponsor: [open the Itô dashboard to sign in and rent or manage GPUs](https://compute.itomarkets.com). Any GPU provider works. That sponsorship link is passive: it does not invoke an RFQ, reserve capacity, provision compute, or configure serving. Separately, the opt-in `ecc ito find` bridge invokes the explicitly configured canonical Itô CLI and submits a live authenticated RFQ; it does not reserve capacity. Managed inference through Itô is not live yet.
