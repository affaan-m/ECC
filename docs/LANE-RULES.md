# Lane rules

These are the working rules for bounded lane workers (human or agent) that
execute tasks against this repository from the Ito workstream system. They
are copied verbatim from the lane registry
(`lanes/RULES.md` in the Ito workstream system on the ops mini,
2026-09-16) so a worker reading only this repo sees the same contract.
One task, one branch, one PR or one receipt, then stop.

---

## Lane rules (every codex exec brief starts by reading this)
You are one bounded worker. One task, one branch, one PR or one receipt, then stop.
- Real work only: edit code, run the tests, commit, push, open the PR. No receipts about receipts, no independent review of your own output, no hashing manifests, no ledgers, no acceptance JSONs, no skill self-patching. Your final message is the receipt (under 300 words: what changed, PR link, test command and result, what is blocked and on whom).
- Never merge to main, never publish to npm, never deploy, never send email or messages, never change Hermes profiles or launchd on the mini unless the brief says so explicitly.
- Commits: plain messages, no Co-Authored-By or generated-with trailers, no em dashes anywhere.
- Worktrees and caches go under ~/GitHub/ECC-worktrees or ~/GitHub on the Pro, /Volumes/Agent-Runtime/workspaces on the mini, never on the mini root disk.
- If blocked (missing credential, approval needed, conflicting work), stop and say exactly what is needed. Do not wait, poll, or sleep.
- Time box: finish in one pass. Do not spawn subagents.
