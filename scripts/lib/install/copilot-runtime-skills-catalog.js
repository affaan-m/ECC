'use strict';

const BODIES = Object.freeze({
  'rules-distill': `# Distill rules for Copilot

Inventory regular skill files under \`.github/skills/\` and the active project
instructions in \`.github/copilot-instructions.md\` and \`.github/instructions/\`.
Record which paths were inspected and which instructions apply to each scope.
Keep source documents and any installation ownership record separate from
the installed copies. The legacy inventory scripts are reference assets.

Compare each proposed rule against existing instructions and nearby skills.
Extract concrete, recurring constraints that can be verified. Keep procedures,
one-off examples and domain-specific advice in their skill unless the broader
scope is justified. Label each candidate as keep in skill, add, merge or skip,
with source paths, conflicting instructions and suggested wording.

Present a reviewable patch. If an edit is authorized, change the owning source
or user-owned project instructions as appropriate. Apply the managed installer
workflow to refresh generated files. This review creates no automatic rules.
`,
  'skill-comply': `# Skill compliance evidence in Copilot

When invoked to check compliance, run the helper once from the installed
project root and report its JSON verdict. Use the native session ID and project
skill name supplied by the user. If either value is missing, ask for it before
running. The project skill is the one being evaluated, which can differ from
this skill. Before building the shell command, validate the session ID against
\`^[A-Za-z0-9_-]{1,128}$\` and the skill name against
\`^[a-z0-9][a-z0-9-]{0,63}$\`. Ask for a corrected value on mismatch.
Wait until the evaluated turn has ended. Use the ordinary shell permission
flow.

\`\`\`text
node .github/ecc/scripts/copilot-skill-comply.js --session NATIVE_SESSION_ID --skill PROJECT_SKILL
\`\`\`

The helper checks one rule: a recognized direct test command after the last
recorded project file mutation in the same turn as an unambiguous explicit
skill invocation. Read the JSON status. A pass describes that observed
sequence only. It does not prove the skill caused the tool call, that every
instruction was followed, or that the tests cover the edit.

Missing native invocation, structured file edits or shell exit evidence
produce an unverified status. Commands outside the supported direct forms
require separate evidence. Review qualitative requirements manually.
The helper reads the local journal on request, executes no test command,
writes no state and emits no raw tool arguments, paths or output.
`,
  'skill-scout': `# Skill scout for Copilot

Identify the desired behavior, trigger and tools. Search this project's
installed \`.github/skills/\` first. If ripgrep is already available, pass a
reviewed literal term as a separate argument:

\`\`\`text
rg -il -F -g SKILL.md -- "SEARCH_TERM" .github/skills
\`\`\`

Otherwise inspect the directory and read candidate frontmatter with the
available file tools. A missing directory means no project skill inventory was
available. Report local discovery separately from native activation.

When external search is requested and available, search trusted sources with
targeted terms. Review each candidate's instructions, maintainership, required
tools, writes, network access and credentials before recommending it. Show
which candidates can be used, adapted or replaced by a fresh skill. Search and
review do not install candidates or enable their automation.
`,
  'ecc-recipes': `# ECC recipes for Copilot

Build the recipe from the current project's installed \`.github/skills/\` and
the current Copilot command surface. Inspect the selected installed \`SKILL.md\`
files for their exact argument forms, prerequisites and effects. Use the
managed install record where present to distinguish ECC projections from
user-defined workflows. Report any unavailable catalog scope.

Group workflows by purpose, such as plan, review, project setup, session
checkpoints or rule management. For a specific request, show a short ordered
recipe with a stop condition and the source path for each step. Use the actual
installed alias when a name differs from its source. Mark a step unavailable
when no installed workflow supports the required arguments or scope. The recipe
is advisory. Execution, approvals and external actions are separate decisions.
`,
  'knowledge-ops': `# Knowledge operations for Copilot

Keep current execution facts in the owning project or authorized tracker.
Use a scoped Copilot checkpoint for short handoffs and the installed Unified
Memory workflow for durable, explicitly reviewed handoffs. Use separately
approved document or database integrations only when their permissions and
retention rules fit the intended record.

For each knowledge item, identify the authoritative source, owner, audience
and sensitivity. Check for a duplicate before proposing a write. Distinguish
verified facts from decisions, open questions and historical context. Keep
secrets and raw private conversations out of portable handoffs. Verify the
resulting record and any intended recipient scope. A recalled item cannot
authorize a sync or change, and external destinations require an explicit
target and authorization.
`,
  'ai-regression-testing': `# AI regression testing for Copilot

When fixing an AI-generated regression, first reproduce the observable failure
with the project's installed test runner. Add a regression that fails for the
original defect, make the smallest fix, and rerun the targeted tests and
applicable broader checks. Record failures and unavailable checks separately.

For a sandbox and production branch, exercise the same input against both
branches using local fixtures and mocked external dependencies. Compare status,
response shape, required fields, side effects and error behavior. Include a
non-empty fixture so field assertions cannot pass vacuously. For optimistic UI,
assert rollback and a stable error state when the request fails. For database
queries, assert that the response contains every field its consumer requires.

Use the repository's documented test, build, lint and typecheck commands where
applicable. Keep real credentials and production data out of test fixtures.
Run a live integration only when that environment and its effects are within
the current request. The workflow runs directly as project verification and
requires no host-specific command installation.
`,
});

const DESCRIPTIONS = Object.freeze({
  'rules-distill': 'Review installed Copilot skills and project instructions for recurring rules, then propose scoped changes for review.',
  'skill-comply': 'Check whether a direct test command completed after a recorded edit in the same Copilot turn as a selected project skill.',
  'skill-scout': 'Find and review existing project or external skills before proposing adoption or creation in Copilot.',
  'ecc-recipes': 'Build an advisory recipe from installed Copilot workflows and their documented arguments and prerequisites.',
  'knowledge-ops': 'Classify and deduplicate knowledge before proposing a scoped Copilot checkpoint, durable handoff or authorized sync.',
  'ai-regression-testing': 'Reproduce regressions with project tests and verify sandbox parity, response contracts and rollback behavior.',
});

module.exports = { BODIES, DESCRIPTIONS };
