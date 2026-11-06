---
name: platform-factory
description: Build deterministic OCI images, SBOM/provenance evidence and hardened container or microVM runs from a compiled executable with the Platform Factory (pf) CLI, and keep its freeze lock in sync with a companion Claude Code hook. Use when a project contains .platform-factory/, when the user runs or asks about pf/platform-factory (detect, plan, freeze, build, verify, run, launch), or wants reproducible OCI builds without a Docker daemon.
metadata:
  origin: community
---

# Platform Factory

[Platform Factory](https://github.com/CYPT71/platform-factory) (`platform-factory`, alias `pf`) is a single Go binary that turns a compiled executable into a deterministic OCI image, attaches native supply-chain evidence (SBOM, provenance, signatures, policy) and runs the result as a hardened container or a KVM/HVF microVM. No Docker daemon, BuildKit, syft or cosign is needed for the core path. It plugs into an existing stack; it does not replace Kubernetes, CI orchestrators or registries.

Full reference: the project's `docs/cli-guide.md`. This skill covers the workflow an agent should follow and the guard hook that protects it.

## When to Activate

- The repository has a `.platform-factory/` directory or `freeze.lock.json`.
- The user runs, or asks about, `pf` / `platform-factory` commands.
- The task is reproducible OCI image builds, SBOM/provenance evidence, or microVM execution of a legacy or dynamically linked binary.
- You edit a dependency manifest (`package-lock.json`, `go.sum`, `requirements.txt`, `Cargo.lock`, `pom.xml`, ...) in a Platform Factory project.

## Core Workflow

```bash
pf detect ./my-app        # inspect inputs without executing them; JSON output
pf init --language node .    # create pf.yaml (language plugin must be loaded: pf plugin load node)
pf plan                   # project plan (platform-factory.dev/project-plan/v1)
pf project freeze         # pin dependencies -> .platform-factory/freeze.lock.json
pf build                  # deterministic OCI image
pf verify .platform-factory/image   # strict release gate: digests, diff_ids, platforms
pf run --runtime podman .platform-factory/image
pf diff                   # compare builds
```

`pf launch --publish --yes` freezes when required, builds, verifies, **publishes to a registry and then starts the workload** in one step, so it is an outward-facing action (see rule 6). `pf sbom PATH...` produces a reproducible SBOM natively.

### Rules that matter

1. **Freeze before build.** Any change to a dependency manifest makes `.platform-factory/freeze.lock.json` stale. Run `pf project freeze`, then `pf build`.
2. **Treat `pf verify` as the gate.** A build is not done until `verify` passes.
3. **Ambiguity is an error.** `pf detect` exits with code 2 when a directory matches several ecosystems. Pass `--accept-ambiguous` only when the user confirmed the choice.
4. **Never add secrets to build inputs.** Inputs end up in the image and its evidence.
5. **Callbacks are opt-in.** `pf` hooks (CLI/MCP callbacks) only run when `PLATFORM_FACTORY_HOOKS_CONFIG` points to an explicit absolute file, so a cloned repository cannot activate executables.
6. **Confirm before anything outward-facing.** Before `pf publish`, `pf deploy`, `pf launch --publish` or any command that pushes to a registry, applies to a cluster or starts a workload, state the target registry, the image reference and the action, and wait for the user's explicit approval. Never add `--yes` on your own; try `--dry-run` first where the command offers it. Approval for one publish does not cover the next. Keep tool permissions narrow: allow `pf detect|plan|verify|sbom|status` freely, and keep `pf publish|deploy|launch|run` behind a prompt.

## Companion Claude Code Hook: freeze guard

The project ships a Claude Code plugin, [`platform-factory-guard`](https://github.com/CYPT71/platform-factory/tree/main/integrations/claude-code), that runs next to ECC's own hooks:

| Event | Trigger | Behavior |
|-------|---------|----------|
| `PostToolUse` | `Edit`/`Write`/`MultiEdit` on a dependency manifest | Reminds you to run `pf project freeze` |
| `PreToolUse` | `Bash` running `pf build\|publish\|launch\|deploy` | Warns when a manifest is newer than the freeze lock; denies if `PF_GUARD_STRICT=1` |

It never executes `pf`, is a no-op outside a `.platform-factory/` project, and fails open. Disable with `PF_GUARD=off`.

Install it as a plugin (requires Node.js 18+):

```text
/plugin marketplace add CYPT71/platform-factory
/plugin install platform-factory-guard@platform-factory
```

## Anti-Patterns

```bash
# BAD: build right after changing dependencies
npm install left-pad && pf build

# GOOD: refresh the lock first
npm install left-pad && pf project freeze && pf build && pf verify .platform-factory/image
```

- Skipping `pf verify` and shipping the image.
- Passing `--accept-ambiguous` to silence exit code 2 without checking which ecosystem is intended.
- Editing `.platform-factory/freeze.lock.json` by hand instead of re-running `pf project freeze`.
- Running `pf` with a `PLATFORM_FACTORY_HOOKS_CONFIG` file you did not review.

## Best Practices

- Build the executable statically when possible (`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w'`) so the image is small and reproducible.
- Use microVM isolation only for legacy or dynamically linked binaries that need stronger-than-namespace isolation.
- Use `pf extensions list` / `pf extensions analyze` for offline policy checks (AI, data, gateway, Kubernetes, supply-chain analyzers).
- In CI, run `pf verify` as a required step and archive the SBOM and provenance.

## Related Skills

- `docker-patterns` - container conventions when a Dockerfile is still involved
- `deployment-patterns` - rollout and release strategies
- `kubernetes-patterns` - running the produced image on a cluster
- `security-review` - reviewing supply-chain and secret handling
