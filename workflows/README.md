# ECC native workflows (pilot)

Scripts in this directory are [Claude Code **Workflow** tool](https://docs.claude.com/en/docs/claude-code) scripts — deterministic, multi-agent orchestration that runs in the background and fans out to subagents.

This is a **pilot**: ECC's orchestration (`orch-*`, `multi-*`, GAN/Santa loops) is currently hand-rolled on top of the `Task`/Agent tool. These scripts port the autonomous, fan-out-heavy segments to the native engine, which gives us barrier-free pipelining, automatic concurrency capping, structured-output validation, and resumability for free.

## `orch-review.workflow.js`

A native port of **orch-pipeline Phase 5 (Review)**.

The gated outer loop (Gate 1 after Plan, Gate 2 before Commit) **stays in the main conversation** — native workflows run autonomously in the background and cannot pause for interactive approval. This script owns only the segment *between* the gates:

1. **Review** — one reviewer agent per dimension, in parallel:
   - `ecc:code-reviewer` (correctness & quality) — always
   - the matching `ecc:<language>-reviewer` — when `args.language` maps to one
   - `ecc:security-reviewer` — only when the orch-pipeline security trigger matches the diff/paths
2. **Dedup** — independent reviewers routinely flag the same line, so findings are merged across dimensions keyed on the normalized `evidence` snippet (titles and line numbers drift per reviewer; the offending code does not). Each surviving finding records which `dimensions` reported it and keeps the strictest severity.
3. **Verify** — every *unique* `CRITICAL`/`HIGH` finding is handed to an independent adversarial verifier that defaults to *refuted* on uncertainty. `MEDIUM`/`LOW` pass through as advisory.

The Review→Verify barrier is deliberate: deduping before verification is exactly the case the Workflow guidance calls a justified barrier — it stops the verifier running N times on the same bug (in local testing, 11 raw findings collapsed to 4 unique, roughly halving verifier cost).

### Invocation

The main loop computes the diff, then calls the Workflow tool:

```jsonc
Workflow({
  scriptPath: "workflows/orch-review.workflow.js",
  args: {
    diff: "<unified git diff text>",   // required
    language: "typescript",            // optional — selects a language reviewer
    changedFiles: ["src/auth.ts"]      // optional — feeds the security trigger
  }
})
```

Invalid input throws (the gate **fails closed**): a missing/empty `diff`, malformed JSON, or a non-array `changedFiles` is rejected with a clear error rather than silently approving an unreviewed payload.

### Returns

```jsonc
{
  "verdict": "APPROVE" | "CHANGES_REQUESTED", // CHANGES_REQUESTED if any blocker OR a dimension failed
  "incomplete": false,            // true when one or more review dimensions failed to run
  "failedDimensions": [ /* { dimension, error } — error is a bounded label, never raw subagent text:
                           "agent returned null (terminal failure or skip)" | "review agent failed" */ ],
  "blocking": [ /* confirmed CRITICAL/HIGH + unverifiable ones — must clear before Gate 2 */ ],
  "advisory": [ /* MEDIUM/LOW + adversarially-refuted findings */ ],
  "stats": { "dimensions": 3, "failed": 0, "raw": 11, "unique": 4, "confirmed": 4, "unverified": 0, "refuted": 0 }
}
```

The main loop presents `blocking` at Gate 2; the human still approves the commit. The gate fails closed at every stage: if a reviewer dies the dimension is recorded in `failedDimensions` (verdict never a clean `APPROVE`), and if a *verifier* dies or returns null the blocker is kept in `blocking` (tagged "could not be verified") rather than demoted to advisory — an unreviewed security dimension or an unverifiable CRITICAL must not pass as approved.

## Invoking it

`/orch-review` (`commands/orch-review.md`) is the command surface: it gathers the
diff (local uncommitted changes or a GitHub PR), calls this workflow, and reports
the blocking/advisory split at Gate 2.

## Not in this PR (follow-ups)

- i18n mirrors (`docs/<locale>/commands/orch-review.md`) for the `/orch-review` command (not CI-enforced; only a subset of commands are translated today).
- Wiring `/orch-review` into the `orch-pipeline` Review phase as the native option.
- Installer / manifest wiring so the script ships to `~/.claude/` on install.
- Porting the **Research** sweep and **Plan** judge-panel segments next.
