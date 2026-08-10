# ECC 2.0 Alpha

`ecc2/` is the current Rust-based ECC 2.0 control-plane scaffold.

It is usable as an alpha for local experimentation, but it is **not** the finished ECC 2.0 product yet.

## What Exists Today

- terminal UI dashboard
- session store backed by SQLite
- session start / stop / resume flows
- background daemon mode
- observability and risk-scoring primitives
- worktree-aware session scaffolding
- basic multi-session state and output tracking

## What This Is For

ECC 2.0 is the layer above individual harness installs.

The goal is:

- manage many agent sessions from one surface
- keep session state, output, and risk visible
- add orchestration, worktree management, and review controls
- support Claude Code first without blocking future harness interoperability

## Current Status

This directory should be treated as:

- real code
- alpha quality
- valid to build and test locally
- not yet a public GA release

Open issue clusters for the broader roadmap live in the main repo issue tracker under the `ecc-2.0` label.

## Run It

From the repo root:

```bash
cd ecc2
cargo run
```

Useful commands:

```bash
# Launch the dashboard
cargo run -- dashboard

# Start a new session
cargo run -- start --task "audit the repo and propose fixes" --agent claude --worktree

# List sessions
cargo run -- sessions

# Inspect a session
cargo run -- status latest

# Stop a session
cargo run -- stop <session-id>

# Resume a failed/stopped session
cargo run -- resume <session-id>

# Run the daemon loop
cargo run -- daemon
```

## Bounded Harness Evaluation

ECC2 now has an operator-driven configuration registry and promotion gate. Candidate JSON is canonicalized and addressed by its SHA-256 digest, with immutable trace/evidence references. Evaluation uses the same explicit unique seeds for candidate and active baseline through a pluggable Rust trait. The CLI exposes only a deterministic local recorded-measurements evaluator; it makes no network or process calls.

```bash
cargo run -- harness-eval record --config candidate.json --trace-ref trace://run-1 --evidence-ref evidence://review-1
cargo run -- harness-eval activate-initial <sha256> --evidence-ref evidence://baseline-approval
cargo run -- harness-eval run --candidate <sha256> --baseline <sha256> --seed 1 --seed 2 --measurements measurements.json --evidence-ref evidence://evaluation-1 --min-samples 2 --min-mean-delta 0.05 --min-win-rate 0.5
cargo run -- harness-eval audit
```

`measurements.json` contains `{"evaluator":"recorded-v1","scores":{"<candidate>":{"1":0.9},"<baseline>":{"1":0.7}},"health":{"<candidate>":true}}` (with every requested seed present). Promotion requires minimum paired samples, arithmetic-mean delta, and per-seed win rate. SQLite transactions update the active pointer and append audit evidence atomically; a failed or errored candidate-keyed recorded health assertion restores the prior pointer and records rollback evidence. Database triggers reject update/deletion of candidate, evaluation, and audit rows.

Limitations: this performs one bounded deterministic comparison. It does not autonomously rewrite prompts or `ecc2.toml`, train/fine-tune a model, implement or claim reinforcement learning, call a network service, or run shell-command evaluators. It does not alter running sessions. Evidence references and scores are operator assertions, not authenticated truth. Arithmetic gates do not establish statistical significance. The active pointer is registry state only; it is not automatic deployment into a harness runtime.

## Validate

```bash
cd ecc2
cargo test
```

## What Is Still Missing

The alpha is missing the higher-level operator surface that defines ECC 2.0:

- richer multi-agent orchestration
- explicit agent-to-agent delegation and summaries
- visual worktree / diff review surface
- stronger external harness compatibility
- deeper memory and roadmap-aware planning layers
- release packaging and installer story

## Repo Rule

Do not market `ecc2/` as done just because the scaffold builds.

The right framing is:

- ECC 2.0 alpha exists
- it is usable for internal/operator testing
- it is not the complete release yet
