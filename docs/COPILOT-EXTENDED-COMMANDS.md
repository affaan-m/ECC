# Copilot implementations for the remaining 37 commands

All 37 former compatibility notices now point to concrete managed workflows.
This is implementation coverage, not native host certification. External
accounts, reviewer models, project toolchains and the reviewed ECC checkout
described below remain prerequisites. Missing prerequisites return errors.

## Install

From the destination project root, with this ECC checkout:

```bash
node /path/to/ECC/scripts/install-apply.js --target copilot --modules commands-core,hooks-runtime --enable-hooks
```

Use `--no-hooks` for manual commands without automatic Hookify enforcement.
All managed executable files live below `.github/ecc/`. Installation, repair
and uninstall preserve user-owned files and private Copilot stores. The npm
package includes the complete declared helper closure; no runtime dependency
download is performed by these helpers.

| Group | Commands | Implementation |
| --- | --- | --- |
| Instinct management | `evolve`, `instinct-import`, `instinct-export`, `instinct-status`, `projects`, `promote`, `prune` | Canonical ECC Python algorithms with a Copilot-scoped launcher; reviewed candidates remain separate from activation |
| GitHub coordination | `epic-claim`, `epic-decompose`, `epic-publish`, `epic-review`, `epic-sync`, `epic-unblock`, `epic-validate` | Canonical ECC coordination policy through a pinned-checkout bridge and private workspace SQLite cache |
| Local runtime | `astra-review`, `auto-update`, `harness-audit`, `quality-gate`, `project-init`, `skill-health`, `pm2` | Bundled Astra reviewer; project formatter/audit/PM2 generator; pinned-checkout install and health bridge |
| Orchestration | `gan-build`, `gan-design`, `multi-backend`, `multi-frontend`, `multi-plan`, `multi-execute`, `multi-workflow`, `orch-review`, `santa-loop`, `loop-start`, `loop-status` | Explicitly configured model backends, independent reviews, bounded iterations and private run records |
| Dynamic policy and usage | `hookify`, `hookify-configure`, `hookify-list`, `hookify-help`, `cost-report` | Canonical safe rule parser/evaluator with native event outputs; verified native accounting records |

## Reviewed external runtime

The epic commands, auto-update, project-init and skill-health reuse the full ECC
backend. Keep a reviewed ECC Git checkout with dependencies installed. Set the
operator environment to its absolute root and exact full commit SHA:

```text
ECC_COPILOT_CHECKOUT_ROOT=/absolute/path/to/reviewed/ECC
ECC_COPILOT_CHECKOUT_COMMIT=<full-40-character-commit-sha>
```

Use the equivalent shell-specific environment assignment on Windows. The
helper verifies the package identity, Git top-level root, exact HEAD and clean
tracked working tree. It never obtains executable roots from project install
state, issue text, memories or agent output. The operator is responsible for
reviewing this revision and installing its declared dependencies. After a
version change, review and repin the checkout before executing its backend.

Epic previews use `--dry-run` and an in-memory database. Every mutation needs
both `--apply` and the exact `--approve action:owner/repository#issue` token;
collection operations use `#all`. The current request must authorize the exact
operation/scope. Claim identity must match authenticated `gh api user` identity.
All actions can change GitHub state when applied, including sync/validate.
The backend retains its independent review and dependency gates. Local locking
does not provide a distributed atomic claim across machines.

Auto-update fetches only with `--fetch-only`; it does not pull and execute a
new revision automatically. Review and repin the full checkout first, then
apply its managed reinstall request. Project-init previews a Copilot install
and applies only with `--apply`. Automatic hook activation must use the
installer's explicit consent path. Skill-health reads the canonical health
backend; an empty instrumented health store is not proof of healthy skill use.

## Instincts and local tools

The instinct launcher requires Python 3.9+. On Windows use the installed Python
3 executable rather than assuming a `python3` alias. It binds canonical ECC
algorithms to `$COPILOT_HOME/ecc/homunculus` and the current repository;
legacy Claude migration stores are not consulted. Imports, promotion, pruning,
project-registry mutations and evolved generation preview by default. Explicit
`--apply` is required for the selected operation. Transfers use bounded stdin
or reviewed workspace-relative files, and exports are create-only. URL imports
are not fetched implicitly. Evolution creates review-only artifacts; no skill,
agent, hook or policy is silently activated. Automatic background observation
is not installed by these management commands.

Quality-gate checks one file with the project's local Prettier/Biome or the
installed `gofmt`/`ruff` executable. Missing formatters and failed checks are
errors; `--fix` is an explicit edit request. The harness audit reports 12
configuration evidence categories, with unavailable vendor integrations marked
not applicable. It is not a security certification or a live integration test.

PM2 previews services/config/native skills. A reviewed JSON services spec and
`--apply` create new files only. It never installs PM2, starts processes or
overwrites existing files. Astra retains the bundled canonical reviewer
implementation and needs an authenticated Codex CLI for live review;
`--dry-run` inspects the prepared request without making a model call.

## Independent model workflows

Create an operator-owned private `$COPILOT_HOME/ecc/orchestration.json`:

```json
{
  "version": 1,
  "limits": { "timeoutMs": 120000, "budgetMs": 600000, "maxIterations": 3 },
  "backends": {
    "first": { "type": "copilot", "executable": "copilot", "model": "YOUR_AVAILABLE_MODEL_A", "identity": "copilot/model-a" },
    "second": { "type": "copilot", "executable": "copilot", "model": "YOUR_AVAILABLE_MODEL_B", "identity": "copilot/model-b" }
  },
  "roles": {
    "planner": { "backend": "first", "allowTools": ["read"] },
    "generator": { "backend": "first", "allowTools": ["read"] },
    "evaluator": { "backend": "second", "allowTools": ["read"] },
    "backend": { "backend": "first", "allowTools": ["read"] },
    "frontend": { "backend": "second", "allowTools": ["read"] },
    "reviewerA": { "backend": "first", "allowTools": ["read"] },
    "reviewerB": { "backend": "second", "allowTools": ["read"] },
    "verifier": { "backend": "second", "allowTools": ["read"] }
  }
}
```

Replace model placeholders with models verified in the account's `/model`
picker. The example is deliberately read-only; grant only the explicit
generator file/tool operations authorized for the project. Wildcard grants and
reviewer write/shell tools are rejected. Native backends use fresh Copilot
processes, piped prompts and normal permission handling; they do not use
allow-all, trust-folder, resumed sessions or another harness's settings.

An optional `json-stdio` backend runs an explicitly trusted executable outside
the project. It consumes one `ecc.copilot.agent.v1` JSON request on stdin and
must return one bounded JSON object on stdout matching the request's
`outputShape`. It is an operator-controlled code integration: the adapter must
enforce its declared tool permissions and correct model identity. Arbitrary
executables are not OS-sandboxed by this runner.

Pass JSON over stdin to `node .github/ecc/scripts/copilot-orchestrate.js`.
The request names the command, authorized task and optional diff/changed files.
GAN uses planner → generator → independent evaluator. Score 8/10 passes;
three unchanged scores produce plateau, and iteration/time limits stop work
without declaring success. Browser mode needs explicit evaluator browser tools
and evidence; `evalMode: "code-only"` is narrower and cannot certify the UI.

Multi-model planning returns a stored plan awaiting approval. `multi-execute`
requires its `planRunId` and current-request `approved: true` before generation
and independent review. The planning variants focus the task on backend,
frontend or the whole workflow; execution stays explicit. Orch-review runs
three review dimensions, deduplicates findings and adversarially verifies
blockers. Santa requires two distinct model identities and complete clear
reviews for `NICE`. These are evidence-based agent verdicts, not correctness
proofs. Errors and malformed results never become clean approval.

Loop-start prepares a private run without making model calls. Launch the
returned run ID with explicit `launch: true`. Limits are 1..15 iterations,
1..3,600,000 ms per call/run, 1 MiB input/state and 512 KiB child output.
Loop-status only reads this canonical workspace's records. There is no daemon
or scheduled unattended loop. Interruptions can leave an explicit running
record; inspect it before starting another run.

## Hookify and accounting limits

Rule files live under `.github/ecc/hookify/`. Shell/file block rules deny
`preToolUse`; stop block rules use native `agentStop` decisions and a recursion
guard. Prompt warnings use `userPromptTransformed` to append delimited untrusted
context. The host has no command-hook prompt denial, so `prompt:block` authoring
is rejected; `all:block` applies only to enforceable tool/stop phases. Post-tool
policies cannot undo actions, and stop warnings cannot inject model context.
Tracked local rules need explicit `ECC_HOOKIFY_ALLOW_TRACKED=1`. Regex evaluation
uses the canonical 25 ms VM timeout and shared bounded evaluation budget.

Cost-report reads current-workspace native events and the latest cumulative
`session.usage_checkpoint`/`session.shutdown` aggregate per session. It never
sums repeated cumulative snapshots. Nano-AI units, premium request counts and
available token metrics are reported; USD stays unavailable. Missing fields
are unavailable, not zero. Foreign/mixed-workspace, malformed, symlinked or
oversized sources are rejected; a native schema change requires revalidation.
The limits are 4 MiB per transcript, 128 KiB per event, 1,000 sessions and
64 MiB aggregate scan. Prefer `--session <id>` when the source exceeds them.

## Verification

Run `node tests/run-all.js copilot` for the managed adapters, installed
subprocess flows and boundary tests. The npm dry-run pack verifies all declared
runtime files are included. Tests use fake authenticated GitHub/model backends
where real accounts would create side effects or incur model costs. They do
not certify real model identities, billing values, browser verdicts or native
Copilot behavior on Windows/macOS/Linux. Those require explicit host checks.

Primary native contracts:

- [Programmatic CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically)
- [CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference)
- [Hooks](https://docs.github.com/en/copilot/reference/hooks-reference)
- [Generated event types](https://github.com/github/copilot-sdk/blob/main/nodejs/src/generated/session-events.ts)
