---
name: sandbox-testing
description: Run restricted Tier 0 checks or consented Tier 1 rootless Podman sessions for isolated backend, installer, and clean-user testing.
---

# Sandbox Testing

Use `ecc-sandbox` when a test needs a restricted host process or a disposable
Linux user environment. Write a manifest that declares the required behavior,
preview the deterministic route, and keep the source checkout read-only inside
Tier 1.

```bash
ecc-sandbox run sandbox.yaml --dry-run
ecc-sandbox run sandbox.yaml
```

## Offer A Visible Tier 1 Session

Offer Tier 1 when hands-on interaction would help with backend feature testing,
installer testing, first-run behavior, Linux dependency testing, or clean-user
failure reproduction. Tier 1 uses rootless Podman only.

First request a proposal without consent:

```bash
ecc-sandbox launch sandbox.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app
```

The response must have `result: consent-required`, `creates_run: false`, an
exact `consent_prompt`, and a manifest-bound `proposal_id`. Repeat the returned prompt verbatim
to the user. It follows this literal form:

> Would you like to launch a Tier 1 rootless Podman sandbox with [specific
> environment details], for testing [specific purpose]? y/n

Do not provision a run before an explicit `y`. If the user answers `n`, proceed
without the sandbox or pass `--consent n`, which remains a no-op. If the user
answers `y`, repeat the same command with the returned proposal:

```bash
ecc-sandbox launch sandbox.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app \
  --consent y --proposal "$proposal_id"
```

Never reuse the proposal after the manifest, capability snapshot, route,
purpose, or terminal changes.

## Collaborate Through The Session

Honor the user's terminal preference. Tier 1 supports WezTerm and macOS
Terminal.app through `--terminal wezterm` and `--terminal terminal.app`. The
aliases `terminal` and `macos-terminal` also select Terminal.app.

The user may run commands, inspect the feature, exercise an installer or CLI,
and launch an available agent inside the disposable environment. The outside
agent monitors the redacted event stream returned by `launch`:

```bash
ecc-sandbox listen RUN_ID --follow --format jsonl
```

Use those observations to adjust the feature outside the sandbox, then offer a
new proposal if another fresh environment would be useful.
Manual exploration is explicitly non-evidence and cannot be relabeled as a
deterministic pass.

The source directory is mounted read-only at `/workspace/source`. This is an
integrity boundary, not a confidentiality boundary. Before combining untrusted
code and network access, invoke ECC from a sanitized staging directory without
credentials, private keys, environment files, history, or customer data.

The trusted CLI owns the exact Podman container and terminal process. It uses
argument arrays with `shell: false`, filters the terminal environment, records
ownership receipts, and removes the container when the shell exits. Use
`ecc-sandbox stop RUN_ID` if the session must be ended externally. Do not
assemble a separate `podman exec` lifecycle by hand.

## Claim Boundaries

Tier 0 is an SRT process boundary around the host workspace. It does not prove
a clean user or fresh operating system. Tier 1 is Linux container evidence and
does not prove native host behavior, GUI behavior, or a full machine. Declare
the smallest accurate capabilities and fail closed when the router cannot
satisfy them.
