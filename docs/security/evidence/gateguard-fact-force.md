# GateGuard Fact-Force — Security Evidence

Evidence for the GateGuard fact-force changes, compared with `main` at
`c70874fa`. Generated on 2026-09-30 with Node.js 22 on Linux; the gate suites
also pass on Windows 11.

## Changed security-sensitive surface

- `hooks/hooks.json`: the fact-force matcher adds `NotebookEdit`
  (`Edit|Write|MultiEdit` → `Edit|Write|MultiEdit|NotebookEdit`). No hook is
  added, removed or reordered, and no other matcher changes.
- `hooks/hooks.metadata.json`: that entry's description and fingerprint.
- `scripts/hooks/gateguard-fact-force.js` and the
  `scripts/lib/gateguard-*.js` modules it now requires.

Destructive Bash/PowerShell detection is unchanged. No secret, token,
credential, billing, webhook, workflow or network code is added or modified.

## Threat model

The actor is an agent, possibly steered by prompt-injected content, that wants
to edit a file without doing the investigation the gate asks for.

| Risk | Control | Regression evidence |
| --- | --- | --- |
| A new allowance (search credit, trivial edit, same-turn sibling, read-only first command, denial cap) reaches a sensitive target | Sensitive targets never get an allowance; sensitivity is judged on the path as written and its real path, and a resolution failure counts as sensitive | `sensitive-targets`, `cap-with-sensitive`, `windows-paths` scenarios |
| A search that did not cover the target earns credit (exclusion filters, include filters for another directory, wrong scope, same batch, earlier turn, error result, `Read`) | Credit fails to deny on any doubt ([design notes](../../gateguard/design-notes.md#fail-to-deny)) | `bypass-search-filters`, `bypass-turn-and-batch` scenarios |
| Code changes disguised as comment or whitespace edits | Judged against the file's own context; directives, continuations, strings and heredocs count as code | `bypass-comment-context`, `comment-only-edits` scenarios |
| Sibling collapse used to batch files the gate never questioned | Same class, same real directory, same human turn only; never for sensitive or hard-linked files | `bypass-siblings` scenario |
| A mutating first shell command treated as read-only | Quote-aware parse; redirection, substitution, pipes into unknown commands and unknown commands are not read-only | `first-shell-commands` scenario |
| Edits that the gate never saw | MultiEdit in its real shape, NotebookEdit, subagent edits of sensitive files, hard-linked aliases of sensitive files are gated | `subagent-edits`, `notebook-edits`, `hard-linked-targets` scenarios |
| The hook skipping the host permission prompt | The hook never emits `permissionDecision: "allow"` | Checked on every scenario step |

## Scanner output

`docs/security/evidence/gateguard-fact-force.sarif` is written by the
repository's scenario gate:

```bash
node scripts/dev/gateguard-eval.js --markdown --baseline c70874fa \
  --sarif docs/security/evidence/gateguard-fact-force.sarif
```

- Exit code `0`; SARIF results: `0`.
- 20 scenarios, 184 hook calls, 87 of them must-deny.
- Reruns write a byte-identical file (no timing, paths or content).

| Gate result | this branch | `main` (`c70874fa`) |
| --- | ---: | ---: |
| Must-deny steps allowed (`error`) | 0 | 8 |
| Explicit `allow` decisions (`error`) | 0 | 0 |
| Hook errors (`error`) | 0 | 0 |
| Other expectation mismatches (`warning`) | 0 | 47 |

AgentShield's static scan of the hooks surface gives the same result on
this branch and on `main` (score 83/B, 0 critical, 0 high); see
[gateguard-fact-force-agentshield.md](gateguard-fact-force-agentshield.md)
and `gateguard-fact-force-agentshield.sarif`.

Negative control: the same gate run against `main`'s hook reports the 8
bypasses as SARIF errors. They are:

- two subagent edits of sensitive files (`src/auth/oauth.js`, a MultiEdit of
  `config/secrets.yaml`);
- three MultiEdit calls in the tool's real shape (a top-level `file_path`):
  `.env`, a code file, and a subagent's `config/.env.local`;
- two NotebookEdit calls on notebooks under `auth/` and `payments/`;
- a subagent's edit of a hard-linked file.

## Focused security regression suites

| Suite | this branch | `main` |
| --- | --- | --- |
| `tests/hooks/gateguard-fact-force.test.js` | 1019 passed, 0 failed | 704 passed, 0 failed |
| `tests/hooks/gateguard-scenarios.test.js` | 25 passed, 0 failed | — |
| `tests/lib/gateguard-target-class.test.js` | 31 passed, 0 failed | — |
| `tests/lib/gateguard-readonly-shell.test.js` | 18 passed, 0 failed | — |
| `tests/lib/gateguard-change-profile.test.js` | 47 passed, 0 failed | — |
| `tests/lib/gateguard-code-lexer.test.js` | 15 passed, 0 failed | — |
| `tests/lib/gateguard-file-context.test.js` | 7 passed, 0 failed | — |
| `tests/lib/gateguard-search-filters.test.js` | 10 passed, 0 failed | — |
| `tests/lib/gateguard-turn-scan.test.js` | 17 passed, 0 failed | — |
| `tests/scripts/gateguard-eval.test.js` | 15 passed, 0 failed | — |
| `tests/scripts/gateguard-latency.test.js` | 8 passed, 0 failed | — |

## Repository gates

Each of these gives the same result on this branch and on `main`:

| Command | Result |
| --- | --- |
| `npm run security:ioc-scan` | passed (26 files inspected) |
| `node scripts/ci/validate-hooks.js` | 24 hook matchers validated |
| `node scripts/ci/check-hooks-schema-keys.js` | all keys within the documented loader sets |
| `node scripts/ci/validate-workflow-security.js` | 12 workflow files validated |
| `node scripts/ci/validate-no-personal-paths.js` | passed |
| `node scripts/ci/check-unicode-safety.js` | passed |

## Config audit findings on `hooks/hooks.json`

The changed-config audit reports one medium finding ("No PreToolUse security
hooks") and ten low findings ("Missing deny: rm -rf / sudo / chmod 777 / ssh /
> /dev/"). The same eleven findings appear on every pull request that
touches `hooks/hooks.json` (for example #2838, #3055, #3135 and #3189), so this
change does not introduce them.

- `hooks/hooks.json` does register PreToolUse security hooks, including the
  fact-force gate, `config-protection` and `governance-capture`.
- `permissions.deny` rules belong in Claude Code `settings.json`, not in a
  plugin's hooks file. `check-hooks-schema-keys.js` rejects keys outside the
  loader sets, so adding deny lists to `hooks.json` is not an option.
- Destructive shell commands are denied at runtime by the Bash dispatcher and
  the PowerShell gate, which this change leaves unchanged.

## Known limits

The known limits are listed in
[evaluation.md](../../gateguard/evaluation.md#limits) and the
[design notes](../../gateguard/design-notes.md). The main ones:

- Credit trusts the local transcript.
- Configured exempt globs take precedence over sensitivity.
- Read-only git commands keep `main`'s exposure to git-config-driven
  execution.
