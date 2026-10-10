# GateGuard Fact-Force — AgentShield Evidence

Generated on 2026-09-30 with `ecc-agentshield@1.6.0` (npm integrity
`sha512-lpeHG96DtEn7ofq7Iiyvq29piQOwParaiZOdDB206i4ZeCL4yjwT6xN5BSGI4yhCEAN0eO0f9F9hxHLBuRqf/g==`),
installed with `--ignore-scripts`. Only static analysis was run: no prompt
injection testing, sandbox execution, taint or LLM analysis, and no auto-fix.

## Scope

AgentShield discovers a hooks config at `hooks/hooks.json` and the hook scripts
its commands reference. The scan root is `hooks/` and `scripts/` from the tree
under review, extracted into an empty directory so that no other part of the
repository is scanned:

```bash
git archive HEAD hooks scripts | tar -x -C <scan-root>
npx --yes ecc-agentshield@1.6.0 scan --path <scan-root> \
  --format json --evidence-pack <temporary-directory>
```

The same root was built from `main` at `c70874fa`, saved with
`--save-baseline`, and compared with `--baseline <file> --gate`.

`gateguard-fact-force-agentshield.sarif` is the redacted
`agentshield-results.sarif` from the evidence pack of this branch. AgentShield
replaced the scan root with `<target-path>`; it contains no local path,
username, credential or token.

## Result

| | this branch | `main` (`c70874fa`) |
| --- | ---: | ---: |
| Exit code | 0 | 0 |
| Files scanned | 28 | 28 |
| Score / grade | 83 / B | 83 / B |
| Critical / high | 0 / 0 | 0 / 0 |
| Medium / low / info | 29 / 1 / 7 | 29 / 1 / 7 |

Baseline comparison against `main`:

- Score 83 → 83; no new critical, high, medium or low finding.
- The gate reports one new and one resolved `info` finding. It is the same
  finding, "Hook code reads Claude transcript input" in
  `scripts/hooks/gateguard-fact-force.js`, on the same unchanged source line,
  which moved from line 1356 to 1418. AgentShield puts the line number in the
  finding id and the id in its baseline fingerprint, so a moved line counts
  as new. Because the gate allows no new findings, it exits `3` on this line
  shift alone.

## Pre-existing findings

All 37 findings are present on `main` in the same number:

- 24 medium: `hooks/hooks.json` hook commands run inline bootstrap payloads
  longer than 1,000 characters. This is the plugin's existing
  `CLAUDE_PLUGIN_ROOT` resolver, which this change does not touch.
- 3 medium and 1 low on `hooks/codex-hooks.json`, which this change does not
  touch.
- 2 medium on `hooks/hooks.metadata.json` ("No permissions block", "No
  PreToolUse security hooks"). The metadata file holds ids and descriptions
  only; permissions belong in Claude Code `settings.json`. The ECC Tools
  config audit reports the same two findings on every pull request that
  touches this file.
- 7 info: hook scripts that read the transcript or add context. The
  fact-force hook reads the transcript on `main` as well.

## Coverage limits

AgentShield scans the hook entry script but not the `scripts/lib/gateguard-*.js`
modules it requires, and it does not read `skills/gateguard/SKILL.md` below
the top level of `skills/`. The scenario gate SARIF in
[gateguard-fact-force.md](gateguard-fact-force.md) and the unit suites cover
those modules.
