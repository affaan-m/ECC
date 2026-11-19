---
name: cost-tracking
description: Read native usage accounting for GitHub Copilot CLI sessions in this project.
---

# Usage accounting for Copilot CLI

Run the managed report from the project root using Node.js. To restrict the
report to one session, use its confirmed native session ID.

```text
node .github/ecc/scripts/usage/copilot-cost-report.cjs
node .github/ecc/scripts/usage/copilot-cost-report.cjs --session NATIVE_SESSION_ID
node .github/ecc/scripts/usage/copilot-cost-report.cjs --csv
```

The report scopes native sessions to the current workspace and reads the
latest cumulative checkpoint or shutdown for each. It reports available
nano-AI units, premium request counts, and per-model token metrics from that
same snapshot. Missing measurements stay unavailable.

Check the exit status and the JSON `complete` and `skipped` fields. An
incomplete scan can report a known subtotal with missing or invalid entries.
Sessions attested to another workspace are excluded. CSV writes its coverage
warning to stderr so stdout remains a session table. For a scan that exceeds
its limits, select one session. If native accounting is unavailable, report
the limitation without estimating values from transcript text.

The report reads existing native events and emits accounting quantities. It
does not collect prompts, responses, or reasoning in the report. Use an
authorized billing source for actual spend and budgets. The report does not
require ECC hooks or modify Copilot session data.
