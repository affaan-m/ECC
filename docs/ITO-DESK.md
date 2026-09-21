# ECC and the Ito desk

ECC is the public agentic-engineering toolkit; the Ito desk is Affaan's
private ops system. The connection surface in this repo is the set of
public `ito-*` skills (`skills/ito-baskets`, `skills/ito-compute`,
`skills/ito-inference`, `skills/ito-training`). Each of them is a thin
pointer: it names the supported boundary and hands real work to the
separately installed canonical CLI or MCP server. ECC itself implements no
compute booking, inference serving, training stack or basket trading, and
nothing here may claim those capabilities exist inside this repo.

Desk-side work that touches ECC runs as bounded lane tasks. The lane-worker
doctrine (see `docs/LANE-RULES.md`) is: one worker, one task, one branch,
one PR or one receipt; real work only, meaning code edits, tests, commits
and a PR, with the final message as the receipt; no self-review loops, no
receipt ledgers, no merging to main, no publishing, no deployments, no
messages; blocked means naming exactly who or what unblocks. The doctrine
exists because unbounded agent loops were the dominant failure mode of the
desk's earlier automation.

The merge rule for anything desk-related in this repo: fixes and tests
merge freely. Anything that adds a third-party tool, a vendor-named skill,
or an external link waits for Affaan's explicit yes, recorded before merge.
The living desk plan is `docs/PLAN.md` in `Ito-Markets/ito-desk`; task
schemas and the spec book live under `docs/spec/` in the same repo. This
file only describes the relationship; the plan repo is the source of truth.
