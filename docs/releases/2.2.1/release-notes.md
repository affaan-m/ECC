# ECC 2.2.1

ECC 2.2.1 is the signed ECC 2.2 patch release. It keeps the published `v2.2.0`
history immutable while shipping the reviewed release-surface hardening that
landed after the original 2.2.0 tag.

## Installer and release-surface hardening

- Public and packaged install docs now consistently point at the published
  `ecc-universal` commands instead of stale or unrelated package names.
- The AdaL adapter docs use the correct `npx ecc-universal doctor --target adal`
  command.
- Claude setup preflights `git` before provider-specific work starts, so missing
  prerequisites fail fast with the right action.
- Guided setup dry runs use isolated HOME, config, XDG, temp, and Windows app
  data roots to avoid ambient host state affecting review or tests.
- The exact packed artifact now has stronger lifecycle coverage for Claude and
  Kimi setup, update, doctor, repeat install, uninstall, and dry-run flows.
- Identifier regression coverage blocks stale `ecc`, `ecc-install`, and other
  mismatched release-path commands from creeping back into user-facing docs.

## Current-main documentation included in this patch

- The canonical Itô workflow now documents `ecc ito accept <ticket-id>` and the
  `ito_accept` MCP tool.
- Acceptance is explicitly bounded to buyer-authority routing. It routes the
  active desk quote to human review and does not claim to place a trade.

## Provenance boundary

- `v2.2.1` is intended to be a signed annotated tag on exact green `main`.
- `v2.2.0` remains the immutable historical unsigned exception. Do not move,
  recreate, or reuse that tag.

## Upgrade

Install or update the published package, then run the same ECC command path you
already use:

```bash
npm install -g ecc-universal@2.2.1
ecc doctor
```

For first-time or guided terminal setup:

```bash
npx ecc-universal setup
```

The native Claude marketplace path remains supported:

```text
/plugin marketplace add https://github.com/affaan-m/ECC
/plugin install ecc@ecc
```
