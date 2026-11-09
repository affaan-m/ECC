# Copilot runtime-bearing skill projections

P10 adapts selected learning, memory, review, setup and policy entrypoints. The
Copilot installer selects each host body by exact source path. Other targets
continue using the canonical skill files.

| Canonical family | Copilot result | Runtime dependency |
| --- | --- | --- |
| `continuous-learning-v2` | Managed scoped instinct launcher, optional metadata capture, explicit identity mapping and metadata-only analysis with review boundaries | Copilot Python launcher, canonical `instinct-cli.py`, and the explicitly started observer runtime |
| `unified-memory` | Canonical Vault doctor/recall and manual checkpoint → reviewed proposal → create-only handoff | Managed Copilot wrapper; the canonical ecc-universal Vault runtime remains external |
| `continuous-learning` | Visible legacy-v1 compatibility notice; no transcript evaluator or alternative observer | No v1 automatic-learning executable is enabled |
| `plan-canvas` | Explicit session binding and feedback retrieval for a browser review | Managed feedback CLI and a trusted canonical Plan Canvas runtime |
| `configure-ecc` | Inspect, preview, apply and verify a managed project installation or repair, with explicit hook consent | Trusted local ECC installer and its dependencies |
| `hookify-rules` | List, create and toggle local Copilot rules, with enforcement enabled separately | Managed Hookify CLI and canonical rule parser |
| `autonomous-loops` | Prepare and inspect a bounded run, then launch only with separate authorization | Managed orchestration runner. Real launch requires operator-configured backends |
| `config-gc` | Managed install audit and drift reporting. Canonical automatic cleanup remains unavailable | Trusted local installer doctor |
| `dmux-workflows` | External pane orchestration notice and a managed bounded loop alternative | Any external pane backend requires separate verification |
| `deepseek-harness-setup` | Separate host notice and explicit routing to the managed Copilot setup | No DeepSeek integration runs through the Copilot projection |
| `gateguard` | Shell and file guard guidance, with optional complete Read-before-edit evidence | Separately enabled managed guard and evidence hooks |
| `plankton-code-quality` | Advisory end-of-response checks and an on-demand formatter check | Separately enabled quality hooks or the managed `commands-core` runtime, plus the project's installed tools |
| `delivery-gate` | Manual delivery verification and a notice that the canonical automatic Stop policy is unavailable | The project's own checks |
| `strategic-compact` | Explicit checkpoint and recall before native compaction, with optional desktop suggestions | Managed session helper, with hooks and a desktop provider required for suggestions |
| `skill-host-compat` | Review the installed projection and check the canonical Copilot catalog inventory | The source inventory check needs a trusted full ECC checkout |
| `skill-stocktake` | Review installed project skills for quality and overlap, using available outcome evidence separately | Manual project inventory; optional existing managed telemetry reader |
| `plan-orchestrate` | Prepare a scoped `multi-plan` request for review and mark steps without a supported route as blocked | Managed orchestration runner. A live planning run requires reviewed backend configuration and authorization |
| `cost-tracking` | Report current-project native session usage, with absent accounting fields and USD left unavailable | Managed usage reader and workspace-bound native session records |
| `ck` | Save, list and recall current-project Copilot checkpoints | Managed session helper. The legacy registry, migration and deletion are unavailable |
| `repo-scan` | External audit compatibility notice and a manual repository inventory | No external audit installer is enabled |
| `agentic-os`, `autonomous-agent-harness` | Claude architecture notices with scoped Copilot setup, persistence and bounded workflow alternatives | Scheduling, daemon operation and remote dispatch require separate integrations |
| `rules-distill`, `skill-scout`, `ecc-recipes` | Read and review installed Copilot skills or instructions, then propose a scoped change or recipe | Project file tools; optional installed ripgrep for scouting |
| `skill-comply` | Read-only automatic check for a direct test command after the last recorded edit in the invocation turn | Bounded native journal with invocation, file-edit and shell-exit metadata |
| `knowledge-ops` | Explicit scope and source review before a checkpoint, handoff or authorized sync | Managed session or Unified Memory workflow when installed; external sync requires a verified integration |
| `ai-regression-testing` | Project-runner regression checks for sandbox parity, response contracts and rollback | Existing project test tools and controlled fixtures |

Projected frontmatter records its canonical source, partial/notice-only status
and native-unverified evidence state. Permission/model metadata still passes
through the existing skill allowlist; no tool grants are added. Generic skills,
binary assets and non-Copilot targets retain their existing transformations.

Skill Host Compatibility checks the installed skill and uses the read-only
catalog audit in a trusted source checkout. A fresh inventory cannot certify
installed execution or native discovery. Skill Stocktake reviews the current
project's installed skill files and can read existing telemetry health records
when the managed helper is already installed. Missing outcome evidence stays
unmeasured. The canonical shell scripts remain reference assets and the Copilot
workflow creates no cache, changes no telemetry settings and retires no skills.

The learning projection removes executable bootstrap instructions for another
host and the old promises of complete observation or confidence-driven
auto-approval. Confidence is an uncalibrated heuristic. Missing outcomes remain
unknown. Import/evolve/promote/prune use the existing preview/apply distinction;
observation capture and active instincts remain separate. The legacy v1 notice
does not pretend that the v2 runtime reproduces its automatic transcript model.

The memory projection runs the distributed Copilot wrapper, binds canonical
operations to `ECC_MEMORY_HARNESS=copilot`, retains project/team recipient
filters and opt-in user scope, and requires a matching manual checkpoint plus
the current reviewed proposal digest. An unavailable external runtime is a
diagnostic, never a reason to install packages or read another harness's store.
The canonical Vault implementation is not bundled with a standalone skill.

The setup projection reads the current project's ownership record and previews
the effective install plan using the canonical installer. Project config may
contribute modules and exclusions. The workflow checks the destination and
consent before apply, then uses doctor to report remaining drift. Repair uses
the recorded selection and restores missing managed files without registering
hooks when the install declined them. A reinstall with `--no-hooks` previews
and removes an unchanged managed Copilot manifest. It stops if ownership or
the original content cannot be verified. For older declined records that still
own the manifest, rerun that install flow before repair.

The Hookify projection uses `.github/ecc/hookify/` and the same runtime and
guidance as the projected Hookify commands. The standalone skill installs
everything needed for rule authoring. `--enable-hooks` is a separate decision
for enforcement. The install fixture creates a local rule, enables the hooks,
checks denial for a synthetic PowerShell request, toggles the rule off and
disables the hooks. The rule stays readable through the managed CLI.
When managed JavaScript helpers would inherit ESM mode, the installer places a
CommonJS `package.json` in `.github/ecc/scripts/`. This lets them run inside a
project that uses `"type": "module"` without editing its root package. Install and repair
preserve compatible user metadata and refuse migration if it would change the
module scope of an unowned or edited script. For older installs, reinstall or
repair the selection that provides the helpers to get the boundary.

The GateGuard workflow explains which denials can be addressed with observed
read evidence and which need operator review. It links the managed guard to
the optional evidence requirement without reusing the canonical transcript
workflow. See [guard coverage](COPILOT-GUARD.md) and [read evidence](COPILOT-READ-EVIDENCE.md).
The Plankton projection gives operators the available [quality hooks](COPILOT-QUALITY.md)
and the manual formatter command. Delivery Gate is a compatibility notice and
manual checklist. The shipped canonical Python hook is a reference asset and
has no registration in the Copilot manifest.

Strategic Compact calls the existing [session checkpoint helper](COPILOT-LIFECYCLE.md)
even when automatic hooks are declined. The operator can invoke Copilot's
[native compaction](https://docs.github.com/en/copilot/concepts/prompting-and-context/context-management)
after reviewing the checkpoint. [Desktop suggestions](COPILOT-ACCESSORIES.md)
depend on both opt-ins and valid tool-completion evidence.

Standalone skill selection now plans its minimal manual helper closure. Shared
helpers get one owner: commands-core owns its existing closure first; otherwise
the first selected skill owns its required helpers and the automatic hook module
does not claim those same destinations. Declining automatic hooks therefore
preserves manual skill dependencies without activating any hooks. Existing
ownership, repair and uninstall behavior still applies to those helper files.

Tests: `node tests/lib/copilot-runtime-skills.test.js`. They cover exact-path
selection, unchanged canonical/non-Copilot content, the absence of obsolete
executable instructions, dependency closure from a source-free copy, standalone
installation with declined hooks, and unique ownership when skills, commands
and hooks coexist. The setup fixture runs the real installer and repair from a
project path with spaces. It checks that previews leave files untouched and
repair preserves a user-owned hook file. Native CLI loading, external Vault/MCP
integration, observer behavior and the rest of the catalog have separate
acceptance gates. Regenerate the catalog audit only after source edits finish;
fresh source hashes alone do not complete semantic review.

## Skill compliance

After the evaluated turn closes, invoke `skill-comply` with the native session
ID and the name of the project skill to evaluate. Its instructions direct
Copilot to run the helper and summarize the verdict. The ordinary tool
permission flow applies. The direct equivalent from the project root is:

```text
node .github/ecc/scripts/copilot-skill-comply.js --session NATIVE_SESSION_ID --skill PROJECT_SKILL
```

The check pairs main-agent tool records by call ID and uses the structured
`fileEdits`, `shellExecution.exitCode` or `shell_exit` fields. It recognizes
literal direct commands such as `npm test`, `pytest` and `dotnet test`.
Shell pipelines, wrappers, arguments and background execution are outside
the rule's scope. A pass means the observed test command exited successfully
after the last recorded project mutation in that turn. The check does not
measure test coverage, infer causal attribution or detect writes hidden from
the native file-edit metadata. Missing, ambiguous or rewound evidence is
reported as unverified. The helper writes no state, emits no raw journal
content and works without ECC hooks.
