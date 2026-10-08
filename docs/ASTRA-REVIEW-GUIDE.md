# Astra Review Guide

`/astra-review` sends code written in Claude Code to **GPT-6-Astra** (OpenAI) for an independent, cross-provider review. Claude stays the only writer; Astra returns a structured verdict, never a patch. This guide covers setup, day-to-day use, gating, and troubleshooting. The command reference lives in [`commands/astra-review.md`](../commands/astra-review.md).

## How it works

```text
Claude Code                       Codex CLI (read-only sandbox)          OpenAI
-----------                       -----------------------------          ------
git diff / file contents  ----->  codex exec -m gpt-6-astra  ---------> GPT-6-Astra
rubric + JSON schema              web search off, MCP off,
                                  user config skipped        <---------  JSON verdict
markdown report + exit code  <--  --output-schema enforced
Claude fixes CRITICAL/HIGH, re-runs (max 3 rounds), escalates to you
```

The reviewer sees the diff, the rubric, and the repository through Codex's read-only tools. It never sees Claude's conversation, so it does not share the author's assumptions.

## Prerequisites

| Requirement | How to check |
|-------------|--------------|
| Codex CLI installed | `codex --version` (install: `npm i -g @openai/codex`) |
| Logged in with ChatGPT | `codex login` once; `~/.codex/auth.json` shows `"auth_mode": "chatgpt"` |
| `gpt-6-astra` on the account | open `codex` and check the model picker; otherwise set `ECC_ASTRA_MODEL` |
| ECC installed with `commands-core` | `/ecc:astra-review` appears in the command list |

No OpenAI API key is needed. If one is in your environment it is **not** forwarded to the reviewer process.

### Plugin freshness

The Claude Code plugin cache is keyed by ECC's version number, so editing the ECC checkout does not refresh an installed copy. If `/ecc:astra-review` is reported as unknown after updating ECC, uninstall and reinstall the plugin (or bump the version in `.claude-plugin/plugin.json`), then restart the session:

```bash
claude plugin uninstall ecc@ecc && claude plugin install ecc@ecc
```

## Quick start

```text
/ecc:astra-review                          # uncommitted changes (staged + unstaged + untracked)
/ecc:astra-review --base main              # everything on this branch vs main
/ecc:astra-review --commit HEAD            # one commit
/ecc:astra-review Focus on the SQL layer   # free text becomes extra reviewer instructions
```

Plugin commands carry the `ecc:` prefix. With a manual (non-plugin) install the command is `/astra-review`.

Every invocation is your consent to send that diff to OpenAI. Do not run it on code you are not allowed to share. To see exactly what would leave the machine, run the script with `--dry-run` (see below).

## Day-to-day workflow in your own project

The project does not need to live inside the ECC checkout. ECC is a user-scope plugin, so `/ecc:astra-review` is available from any directory, and the script reviews whichever git repository Claude Code was started in. Keep your project outside the ECC tree so its diffs are not mixed with ECC's.

### 0. One-time preparation (in the ECC checkout)

```bash
# refresh the installed plugin whenever the ECC checkout changed
claude plugin uninstall ecc@ecc && claude plugin install ecc@ecc

# confirm Codex CLI is installed and logged in with ChatGPT (otherwise: codex login)
codex --version
grep auth_mode ~/.codex/auth.json
```

### 1. Create the project and start Claude Code there

```bash
mkdir -p ~/work/arm && cd ~/work/arm
git init          # required: the review reads git diffs
claude            # this directory becomes the project root
```

Run `/init` inside Claude Code if you want a project `CLAUDE.md`. ECC hooks and commands apply here because they are installed at user scope.

### 2. Implement as usual

Ask Claude Code for the change, or start with `/ecc:plan`. For test-first development, run `/ecc:tdd-workflow` (optionally with a `*.plan.md` from `/ecc:plan`) or simply ask Claude Code to "use TDD"; language-specific entry points such as `/ecc:go-test` and `/ecc:react-test` also exist.

### 3. Ask Astra for a review

```text
/ecc:astra-review                        # uncommitted changes
/ecc:astra-review --base main            # the whole branch, before a PR
/ecc:astra-review Focus on interrupt handling   # extra instructions
```

Claude fixes confirmed CRITICAL/HIGH findings and re-runs, up to three rounds. To inspect what would be sent without sending it:

```bash
node ~/.claude/plugins/cache/ecc/ecc/<version>/scripts/astra-review.js --dry-run | less
```

(`<version>` is the plugin version shown by `claude plugin list`, for example `2.2.1`. Inside a command, the same path is `${CLAUDE_PLUGIN_ROOT}/scripts/astra-review.js`.)

### 4. Commit once the verdict is PASS

Ask Claude Code to commit, or run `git commit` yourself.

### 5. Optionally gate the push

```bash
node ~/.claude/plugins/cache/ecc/ecc/<version>/scripts/astra-review.js --consent-to-openai --base main && git push
```

Reminders: the command name carries the `ecc:` prefix; every run sends the diff to OpenAI and takes a few minutes; re-do step 0 after each ECC update because the plugin cache is refreshed only on version changes.

## Scopes

| Flag | Reviews | Use it for |
|------|---------|------------|
| (none) | index vs HEAD, working tree vs index, untracked files | the default while coding |
| `--base <branch>` | merge-base of `<branch>` and HEAD → working tree, plus untracked | a whole branch before a PR |
| `--commit <rev>` | one commit against its first parent (`HEAD~1`, `abc123`, merge and root commits work) | auditing history |
| `--files <paths…>` | current contents of explicit files | targeted questions |
| `--files-from-commit <rev>` | current contents of every path `<rev>` touched; paths still deleted are shown as deletions | repair rounds after a `--commit` review |

Diffs over 200 KB are truncated. The reviewer is then given exact git commands to recover the omitted sections for that revision, so a truncated review still judges the right code.

## Running the script directly

The command is a thin workflow around `scripts/astra-review.js` (under the plugin root, or `./scripts/` in the ECC repo). Run it from the reviewed project's directory so git sees that project.

```bash
node "$ECC/scripts/astra-review.js" --dry-run                       # print the prompt, send nothing
node "$ECC/scripts/astra-review.js" --consent-to-openai --base main # review, markdown report on stdout
node "$ECC/scripts/astra-review.js" --consent-to-openai --json \
  --output "$(mktemp -d)/astra.json"                                # JSON for tooling, saved 0600
```

| Option | Meaning |
|--------|---------|
| `--consent-to-openai` | required to send anything (or `ECC_ASTRA_CONSENT=1`) |
| `--dry-run` | print the prompt and exit 0 without calling Codex |
| `--model <slug>` | reviewer model, default `gpt-6-astra` (or `ECC_ASTRA_MODEL`) |
| `--timeout-seconds <30-900>` | Codex timeout, default 300 |
| `--instructions "<text>"` | extra reviewer instructions appended to the rubric |
| `--output <file>` | also write the JSON verdict to `<file>` (atomic, owner-only) |
| `--json` | print JSON instead of the markdown report |
| `--fix-findings <file>` | fix mode: Astra edits the working tree to fix the findings in `<file>` (see below); no scope flag allowed |

Exit codes: `0` PASS or nothing to review, `1` FAIL (any CRITICAL or HIGH finding), `2` usage or runtime error.

## Reading the verdict

The markdown report has a verdict line with severity counts, a summary, the findings (severity, `file:line`, title, detail, suggestion), and the rubric table. The JSON payload has the same data:

```json
{
  "model": "gpt-6-astra",
  "scope": "uncommitted changes",
  "files": ["src/a.js"],
  "verdict": "FAIL",
  "review": {
    "verdict": "FAIL",
    "summary": "…",
    "checks": [{ "criterion": "Security", "result": "FAIL", "detail": "…" }],
    "findings": [{ "severity": "HIGH", "file": "src/a.js", "line": 12, "title": "…", "detail": "…", "suggestion": "…" }]
  }
}
```

The eight rubric criteria are Correctness, Security, Error handling, Input validation, Completeness, No regressions, Tests, and Maintainability. A response that skips a criterion or is otherwise malformed is rejected, never treated as a PASS. The gate is `FAIL` whenever a CRITICAL or HIGH finding exists, even if the reviewer wrote `PASS`.

## The fix loop

1. Claude shows every CRITICAL and HIGH finding and verifies each against the code. Astra can be wrong; false positives are skipped with a one-line reason.
2. Confirmed findings are fixed, nothing else. Tests run.
3. The review runs again with a fresh reviewer. Default and `--base` scopes already include the repairs. After a `--commit` review the repair round uses `--files-from-commit <rev>`.
4. After three rounds with CRITICAL/HIGH findings left, the loop stops and hands you the list. Nothing is pushed.

### Who writes the fixes

The command runs on Opus. Opus verifies every finding, reviews every diff, and runs the tests; the fixes themselves go to a writer:

| Situation | Writer |
|-----------|--------|
| Normal | a Fable subagent (`model: "fable"`) |
| The Fable Agent call fails with an API error of type `rate_limit` or HTTP 429 (words in a successful result never count) | Astra, via `astra-review.js --fix-findings <confirmed.json>` in a `workspace-write` sandbox |
| Fable fails for any other reason | Opus, directly |

The switch is automatic and Fable is not retried for the rest of the session. In fix mode Astra keeps the review isolation (no web search, no network, MCP disabled, user config ignored, no API keys) but may edit files inside the repository; `/tmp` and `$TMPDIR` are excluded from the writable roots. It never commits or pushes. Before the writer runs, Opus snapshots `git diff --binary HEAD` and the untracked file list, so it can tell the writer's hunks from your own uncommitted work and revert only the former. Astra's report lists fixed and skipped findings; Opus treats that as a claim and checks the diff against the snapshot before the tests and the next review round.

```bash
node "$ECC/scripts/astra-review.js" --fix-findings confirmed.json --dry-run           # show the fix prompt
node "$ECC/scripts/astra-review.js" --consent-to-openai --fix-findings confirmed.json  # let Astra fix
```

`confirmed.json` is the `--output` payload, a `{"findings": [...]}` object, or a bare array of findings.

Astra tends to keep finding real but narrower edge cases on each round. Treat the third-round list as input for your own judgement rather than a reason to loop forever.

## Gating a push

Run the review before pushing and refuse on exit code 1:

```bash
node "$ECC/scripts/astra-review.js" --consent-to-openai --base main && git push
```

Or as a `pre-push` hook (opt-in, since it sends code to OpenAI and takes a few minutes):

```bash
#!/usr/bin/env sh
ECC="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}"
exec node "$ECC/scripts/astra-review.js" --consent-to-openai --base "$(git rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')"
```

For two independent reviewers (Claude Opus plus Astra) use `/santa-loop`.

## What leaves the machine, and what does not

Sent to OpenAI: the diff or file contents in scope, the file list, the rubric, and your extra instructions. Codex may additionally read files in the repository through its read-only tools.

Kept out:

- Environment variables other than PATH/HOME-style ones (`OPENAI_API_KEY`, tokens, and similar are never passed).
- MCP servers: every server reported by `codex mcp list` is disabled by name with an inert transport, and the user-level Codex config is not loaded. An empty `mcp_servers` table would not clear inherited servers, which is why each one is named.
- Web search (disabled for the reviewer).
- Files outside the repository: symlinks are serialized as `(symlink -> target)` instead of followed, and paths whose resolved parent directory leaves the repository are refused.
- Writes: the review sandbox is read-only and approvals are never requested. Only the Fable-limit fix mode uses `workspace-write`, with `/tmp`, `$TMPDIR`, and the network excluded, so the repository is the only writable root.

Patches are collected with `--no-ext-diff --no-textconv`, so a configured external diff tool cannot blank them.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `Unknown command: /astra-review` | Plugin commands are namespaced: use `/ecc:astra-review`. If that is unknown too, the installed plugin predates the command; reinstall it (see Plugin freshness). |
| `Codex CLI is not installed` | Install `@openai/codex` and make sure `codex` is on PATH. On Windows the npm shim is resolved to its JavaScript entry point automatically. |
| `Codex review failed: … model …` | `gpt-6-astra` is not available on the account. Pick another model with `ECC_ASTRA_MODEL` or `--model`. |
| `cannot isolate MCP server name "a.b"` | Codex cannot disable a server whose name contains a dot; rename it in the Codex config or disable it there first. |
| `Codex review timed out` | Raise `--timeout-seconds` (max 900) or narrow the scope. |
| `Nothing to review` | The scope is empty. Stage or save changes, or pick another scope. |
| `MCP servers could not be listed` | `codex mcp list` failed, so isolation cannot be guaranteed and the review refuses to run. Fix the Codex config, then retry. |
| Review says the diff is complete but a file is missing | Untracked nested repositories (`dir/`) are listed but not diffed; review them from inside that repository. |

## Limits

- One reviewer model per run. Model diversity beyond Claude plus Astra is out of scope; use `/santa-loop` or `/council` for more.
- Reviews take a few minutes and consume ChatGPT usage on the Codex side.
- Windows support is implemented (npm shim, `Path`, native paths) but is verified only by tests, not on hardware.
