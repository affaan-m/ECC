# Roadmap

This page exists so you can see where ECC is going without reading every
release. It is a direction, not a delivery promise. Dates move, and anything
under "Being considered" can be dropped.

**Watch the repository for Releases only** to get the shipped version of this
page in your inbox: Watch → Custom → Releases.

## How the roadmap works

1. Ideas start in [Ideas discussions](https://github.com/affaan-m/ECC/discussions/categories/ideas).
2. Accepted ideas become issues with a milestone.
3. Shipped work lands in a minor release and is written up in [CHANGELOG.md](CHANGELOG.md).

If something you need is missing, the fastest way to influence this page is a
[feature request](https://github.com/affaan-m/ECC/issues/new?template=feature-request.yml)
that says what you tried, what broke, and what you expected instead.

## Recently shipped

| Version | Released | Headline |
| ------- | -------- | -------- |
| 2.2.0 | 2026-08-28 | Guided setup, Antigravity 2.0, Nasiko CLI bridge |
| 2.1.0 | 2026-07-27 | Plan Canvas, Kimi harness, self-hosted compute |
| 2.0.0 | 2026-06-10 | The agent harness operating system |
| 1.10.0 | 2026-04-05 | Surface refresh, operator workflows |
| 1.9.0 | 2026-03-21 | Selective install, ECC Tools Pro, 12 language ecosystems |

Full history: [CHANGELOG.md](CHANGELOG.md) and
[Releases](https://github.com/affaan-m/ECC/releases).

## Standing commitments

These do not change release to release.

- The repository stays MIT-licensed. ECC Pro is a hosted layer, never a paywall
  on what is already open.
- Install stays reversible. Uninstall removes what ECC added and prints a
  feedback route.
- No automatic diagnostic upload, in any command, ever.
- Security reports are triaged before feature work.

## Being considered

Open for input rather than scheduled. Comment on the linked discussion instead
of opening a duplicate issue.

- [Ideas board](https://github.com/affaan-m/ECC/discussions/categories/ideas) — everything currently proposed.
- [Polls](https://github.com/affaan-m/ECC/discussions/categories/polls) — where prioritisation questions get asked.

> Maintainer note: replace this section with the named themes for the next two
> minor releases. Keep each item to one line and link its tracking issue, so the
> page stays a roadmap rather than a backlog dump.

## Not planned

Saying no publicly saves everyone time.

- Telemetry or usage analytics that run without an explicit opt-in.
- Vendoring harness binaries. ECC configures harnesses, it does not ship them.
- A plugin format that only works with one harness.
