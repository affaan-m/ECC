# Public Feedback Goal Fidelity Playbook

Candidate id: `preserved-outcome-and-chain`

This is a synthetic, read-only comparison, with expected rubric decisions rather
than a historical reproduction or measured model result. It responds to
[reported feedback](https://github.com/affaan-m/ECC/issues/3695).

## Compare Meaning Before Shortening

1. Extract the user's chosen outcome and important causal steps.
2. Shorten wording while retaining `INPUTS -> PROCESS -> RESULT` and why the
   result matters. Here that purpose is sustained throughput.
3. Compare the result with the original task. A human-assisted helper can be an
   explicitly offered alternative, but must not silently replace automation.
4. Retain uncertainty: a requested capability is not an implemented architecture;
   technical limits and required verification still apply.

The accepted and rejected drafts in `scenario.json` deliberately use the same
topic. The rejected draft changes the outcome even though it sounds helpful.
Evaluate meaning and connections, not just shared keywords or brevity.

## Existing Artifact Control

For an HTML-editing variant, provide the original artifact as evaluation input
before asserting preservation. The contract can require supported technical
corrections and removal of outdated emphasis while preserving useful facts,
article purpose, substantial narrative, section structure and image references.
Return copyable HTML when that is requested; do not promote the narrow correction
to a new article theme. Supported additions and removals remain allowed.

If the original is unavailable, preservation remains unverified. A revised code
block establishes format only. Version comparison, rendering, factual checking
and user acceptance are distinct evidence states. Do not invent the missing
original or claim those checks passed.

The source reports a corrected public comment, but its earlier revision was not
independently recovered. For the HTML follow-up, original HTML and the earlier
response remain unavailable; revised output was reported provided, with quality
unverified. Exact ECC activation, version and causal contribution are unknown.

## Repository Validation

Run `node tests/docs/evaluator-rag-prototype.test.js`, Markdown lint on touched
docs, and `git diff --check`. These repository checks do not validate a missing
historical HTML artifact or establish user acceptance. No publication occurs in
this evaluator example.
