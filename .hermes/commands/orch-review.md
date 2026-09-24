---
description: Run the orch-review native Workflow over a diff (local changes or a GitHub PR) and report blocking vs advisory findings. Surface for the orch-review workflow.
argument-hint: [pr-number | pr-url | blank for local uncommitted changes]
---

# /orch-review

Surface for `workflows/orch-review.workflow.js` — the native Workflow port of
orch-pipeline Phase 5 (Review). This command computes a diff, hands it to the
workflow, and presents the result. The workflow owns the fan-out (one reviewer
per dimension, dedup, adversarial verify); this command owns input and output.

**Input**: $ARGUMENTS

---

## Mode Selection

| Input | Mode |
|---|---|
| Blank | **Local Mode** — review uncommitted changes |
| Number (e.g. `42`) or PR URL | **PR Mode** — review a GitHub PR |

---

## Phase 1 — GATHER

Build the unified diff and the metadata the workflow needs.

**Local Mode:**

```bash
git diff --name-only HEAD          # changedFiles
git diff HEAD                      # diff text
```

If the diff is empty, stop: "Nothing to review."

**PR Mode:**

First derive a **safe numeric PR id** from `$ARGUMENTS` — never pass the raw
argument to the shell. Accept either a bare integer, or the trailing number of a
`https://github.com/<owner>/<repo>/pull/<N>` URL. Reject anything else (extra
text, shell metacharacters, a non-PR URL) and stop with an error. Use only the
extracted integer `<NUMBER>` below:

```bash
gh pr diff <NUMBER>                       # diff text
gh pr view <NUMBER> --json files \
  --jq '.files[].path'                    # changedFiles
```

If the PR is not found, stop with an error.

Then derive `language` from the dominant changed-file extension (for example
`.ts`/`.tsx` to `typescript`, `.py` to `python`, `.go` to `go`). Leave it unset
when the change is mixed or non-code — the workflow simply skips the
language-specific reviewer.

## Phase 2 — INVOKE

Call the Workflow tool. The workflow validates its own input and fails closed on
a missing or empty diff, so always pass a non-empty `diff`.

```jsonc
Workflow({
  scriptPath: "workflows/orch-review.workflow.js",
  args: {
    diff: "<unified diff text from Phase 1>",   // required
    language: "typescript",                      // optional
    changedFiles: ["src/auth.ts"]                // optional — feeds the security trigger
  }
})
```

The workflow fans out reviewers in parallel, dedups findings on the normalized
evidence snippet, and runs an adversarial verifier on every unique CRITICAL/HIGH
finding. It returns:

```jsonc
{
  "verdict": "APPROVE" | "CHANGES_REQUESTED",
  "incomplete": false,                 // true if a review dimension failed to run
  "failedDimensions": [ /* { dimension, error } */ ],
  "blocking": [ /* confirmed CRITICAL/HIGH + unverifiable findings */ ],
  "advisory": [ /* MEDIUM/LOW + adversarially-refuted findings */ ],
  "stats": { "dimensions": 3, "failed": 0, "raw": 11, "unique": 4, "confirmed": 3, "unverified": 0, "uncertain": 0, "refuted": 1 }
}
```

## Phase 3 — REPORT

Present the result to the user (this is the human review gate; the workflow does
not commit anything):

- Lead with `verdict` and the `stats` line (dimensions, raw to unique collapse).
- List every `blocking` finding with file, severity, and evidence — these must
  clear before a commit. Findings tagged "could not be verified" stay in
  `blocking` by design; call them out as needing manual confirmation.
- List `advisory` findings briefly (MEDIUM/LOW and verifier-refuted items).
- If `incomplete` is true, state which dimensions in `failedDimensions` did not
  run and that the verdict is therefore not a clean approval.

## Fail-Closed Contract

This command must never present a clean APPROVE when the review could not fully
run. If the Workflow tool itself errors, report the failure — do not fall back to
a hand-rolled review and do not imply the diff was approved.

---

## Edge Cases

- **No `gh` CLI (PR Mode)**: stop and tell the user PR Mode needs `gh`; suggest
  Local Mode against a checked-out branch instead.
- **Large diff**: the workflow caps reviewer concurrency automatically, so a
  large diff is slower but safe; warn the user it may take longer.
- **Binary or generated files**: drop them from `changedFiles` before invoking —
  they add noise to the security trigger without reviewable content.
