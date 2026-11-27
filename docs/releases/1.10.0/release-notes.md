# ECC v1.10.0 Release Notes

## Positioning

ECC v1.10.0 is a surface-sync and operator-lane release.

The goal was to make the public repo, plugin metadata, install paths, and ecosystem story reflect the actual live state of the project again, while continuing to ship the operator workflows and media tooling that grew around the core harness layer.

## What Changed

- Synced the live OSS surface to **38 agents, 156 skills, and 72 commands**.
- Updated the Claude plugin, Codex plugin, OpenCode package metadata, and release-facing docs to **1.10.0**.
- Refreshed top-line repo metrics to match the live public repo (**140K+ stars**, **21K+ forks**, **170+ contributors**).
- Expanded the operator/workflow lane with:
  - `brand-voice`
  - `social-graph-ranker`
  - `connections-optimizer`
  - `customer-billing-ops`
  - `google-workspace-ops`
  - `project-flow-ops`
  - `workspace-surface-audit`
- Expanded the media lane with:
  - `manim-video`
  - `remotion-video-creation`
- Added and stabilized more framework/domain coverage, including `nestjs-patterns`.

## ECC 2.0 Status

ECC 2.0 is **real and usable as an alpha**, but it is **not general-availability complete**.

What exists today:

- `ecc2/` Rust control-plane codebase in the main repo
- `cargo build --manifest-path ecc2/Cargo.toml` passes
- `ecc-tui` commands currently available:
  - `dashboard`
  - `start`
  - `sessions`
  - `status`
  - `stop`
  - `resume`
  - `daemon`

What this means:

- You can experiment with the control-plane surface now.
- You should not describe the full ECC 2.0 roadmap as finished.
- The right framing today is **ECC 2.0 alpha / control-plane preview**, not GA.

## Install Guidance

Current install surfaces:

- Claude Code plugin
- `ecc-universal` on npm
- Codex plugin manifest
- OpenCode package/plugin surface
- AgentShield CLI + npm + GitHub Marketplace action

Important nuance:

- The Claude plugin remains constrained by platform-level `rules` distribution limits.
- The selective install / OSS path is still the most reliable full install for teams that want the complete ECC surface.

## Recommended Upgrade Path

1. Refresh to the latest plugin/install metadata.
2. Prefer the selective install / OSS path when you need full rules coverage.
3. Use AgentShield for guardrails and repo scanning.
4. Treat ECC 2.0 as an alpha control-plane surface until the open P0/P1 roadmap is materially burned down.
