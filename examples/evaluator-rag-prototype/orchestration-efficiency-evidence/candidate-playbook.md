# Orchestration Efficiency Evidence Playbook

Candidate id: `controlled-paired-orchestration-evaluation`

Use this playbook before recommending multiple agents for a task class or
claiming an orchestrated workflow is faster, cheaper, or more reliable than one
agent.

## Accepted Path

1. Define the task, acceptance evaluator, and observable evidence requirements.
2. Draw the dependency graph and name exclusive write ownership. If workers
   need the same file or an unsettled interface, keep that work sequential.
3. Freeze the controlled fields for both variants:
   - starting revision and task text;
   - model and reasoning effort;
   - permissions and tools;
   - time limit and machine-load policy;
   - acceptance evaluator and evidence format.
4. Run one `single_agent` candidate and one `orchestrated` candidate
   sequentially. Alternate run order across later pairs.
5. Apply the same evaluator to every attempt. Keep failures in the dataset.
6. Record per candidate:
   - acceptance and evidence completeness;
   - elapsed time;
   - total tokens or cost across controller, every worker, and retries;
   - worker count and ownership;
   - conflicts, integration rework, retries, and human corrections.
7. Write `unavailable` for telemetry the harness does not expose. Never estimate
   missing totals.
8. Repeat at least three fresh pairs before recommending a task-class boundary.
   Report raw receipts before interpretation.

## Rejected Path

Do not infer efficiency because workers ran in parallel, the controller context
looked smaller, or one orchestrated candidate finished successfully.

Do not compare candidates with different prompts, revisions, models, tools,
permissions, time limits, evaluators, or machine load.

Do not report controller-only tokens, exclude failed attempts, or hide merge
conflicts and integration work outside the result.

Do not publish a general claim from one pair, overlapping variants, fixed run
order, or unavailable aggregate telemetry.

## Minimum Validation

- `node tests/lib/orchestration-session.test.js`
- Task-specific acceptance evaluator for every candidate
- Raw run receipts containing all controlled fields and coordination costs
- `git diff --check`
- At least three sequential pairs with alternated order before a general claim

Record the evidence source and attribution when an external experiment informs
the scenario. Keep publication, agent launch, candidate edits, and repository
mutation outside this read-only evaluator pass.
