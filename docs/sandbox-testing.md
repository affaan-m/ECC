# ECC Sandbox Testing

## Purpose

ECC provides two separate local sandbox tiers:

| Tier | Runtime | Use |
| --- | --- | --- |
| Tier 0 | SRT process boundary | Fast restricted commands against the host workspace |
| Tier 1 | Rootless Podman | Disposable Linux user state for backend, installer, and clean-user testing |

Tier 1 is user-facing as well as agent-facing. It opens a terminal selected by
the user, lets the user run commands or agents inside a tailored environment,
and lets the outside agent follow the same redacted output stream.

## Headless Verification

A YAML manifest declares needs rather than selecting a backend:

```bash
ecc-sandbox run sandbox.yaml --dry-run
ecc-sandbox run sandbox.yaml
```

The dry run identifies the route without provisioning. Tier 0 remains the
lowest-cost route for host-matching restricted commands. `clean-home` and
`pkg-install` claims route to Tier 1 when a compatible rootless Podman runtime
is available.

## Tier 1 Consent Flow

An agent should offer Tier 1 when manual interaction would materially help with
isolated backend behavior, installer or installation testing, first-run
behavior, Linux dependencies, or clean-user reproduction.

The agent first requests a proposal:

```bash
ecc-sandbox launch examples/sandbox/review-tier1-podman.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app
```

This call creates no run or container. It returns:

- `result: consent-required`
- `creates_run: false`
- a manifest-bound `proposal_id`
- the exact `consent_prompt`

The agent repeats `consent_prompt` verbatim. The prompt literally asks:

> Would you like to launch a Tier 1 rootless Podman sandbox with a clean Linux
> home, a read-only source mount, and networking disabled, for testing isolated
> backend feature behavior? y/n

An answer of `n` performs no provisioning. After `y`, the agent repeats the
same request with the returned proposal:

```bash
ecc-sandbox launch examples/sandbox/review-tier1-podman.yaml \
  --purpose "isolated backend feature behavior" \
  --terminal terminal.app \
  --consent y --proposal "$proposal_id"
```

The proposal becomes invalid if the manifest, capabilities, route, purpose, or
terminal changes between calls. It is single-use and expires after ten minutes.

## User And Agent Interaction

The accepted launch opens an interactive shell in the user's selected client:

- `--terminal wezterm`
- `--terminal terminal.app`
- `--terminal terminal` and `--terminal macos-terminal` as Terminal.app aliases

Inside the shell, the user can run commands, test the feature or installer, and
launch an agent installed in the image. The source checkout is available
read-only at `/workspace/source`; container home and package state are
disposable.

The launch response includes a run ID and listener command. The outside agent
follows it without scraping the terminal screen:

```bash
ecc-sandbox listen RUN_ID --follow --format jsonl
```

The listener emits ordered JSON events including setup output, interactive PTY
output, cleanup, terminal check-in failure, and final status. The agent can use
those observations to modify the feature outside the sandbox and offer a fresh
rerun when appropriate.

Useful lifecycle commands are:

```bash
ecc-sandbox runs --active
ecc-sandbox status RUN_ID
ecc-sandbox stop RUN_ID
ecc-sandbox gc
```

## Safety Model

Tier 1 requires a running rootless Podman service. Docker is not a Tier 1 fallback.
The CLI verifies rootless mode and an immutable image ID before
creating a container.

On macOS, `podman machine list` is an inventory signal, not a health check.
Readiness requires a successful `podman info` response whose
`host.security.rootless` value is the boolean `true`. A machine that reports
running while its API is unreachable is unavailable, and the probe reports
that failure without calling it rootful.

The source mount is read-only, all Linux capabilities are dropped, process and
memory limits are applied, and networking defaults to disabled. A read-only
mount protects source integrity but does not make sensitive files
confidential. Use a sanitized staging directory before combining untrusted code
and network access.

Terminal launch uses exact argument arrays with `shell: false`. WezTerm uses its
multiplexer when available. Terminal.app uses an argv-bound AppleScript handoff
to a private, self-deleting command wrapper. Allowlisted values stay in a
separate mode-0600 file and a bounded watchdog expires launch artifacts that a
terminal never consumes. Only explicitly allowlisted environment variables
reach the launched command.

Each exploration uses an unguessable container name and ownership labels. The
guardian removes only resources whose immutable identity and labels match the
recorded receipt. The normal path removes the container when the shell exits;
`stop` and garbage collection provide bounded external cleanup.

Manual exploration is non-evidence. Its output is useful for comprehension and
debugging, but it cannot become a deterministic verification pass. Run the
headless manifest path separately for repeatable evidence.

## Installation Example

The full installer fixture is intended for a trusted ECC checkout:

```bash
ecc-sandbox launch examples/sandbox/review-tier1-claude-installer.yaml \
  --purpose "the full Claude project installer" \
  --terminal wezterm
```

The fixture installs only inside disposable container state and leaves the
host checkout read-only.

## Podman On macOS

Use a current Podman release and keep its client and helper binaries from the
same installation. A stale `helper_binaries_dir` can silently launch an older
`gvproxy`, `vfkit`, or `krunkit` even when `podman version` reports a newer
client. Verify the effective helper paths with `podman --log-level=debug
machine start`.

The local acceptance configuration is a rootless libkrun machine with 2 CPUs,
2 GiB of memory, and a 10 GiB disk. Start it from a persistent terminal or
service that owns the helper processes. Command runners that reap descendants
when their session exits cannot own a long-lived Podman machine.

AppleHV is not the fallback for this failure. Podman's open
[macOS machine issue #28439](https://github.com/podman-container-tools/podman/issues/28439)
documents the same false-success state and Ignition `ensureUsers(core)` group
lock failure. If `podman machine start` reports success but `podman info`
fails, stop the machine, inspect its boot log and effective helper paths, and
use hosted rootless Podman until a supported local provider passes the health
check. Recreating a machine deletes its container and persistent data, so do that
only for a confirmed disposable development machine.
