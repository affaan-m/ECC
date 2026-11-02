# Copilot CLI command compatibility

The `commands-core` module installs command entry points as project skills in
`.github/skills/<name>/SKILL.md`. Invoke a supported workflow as `/<name>` in a
Copilot CLI release that supports manual skill invocation. The known built-in
collisions are renamed: `/plan` → `/ecc-plan`, `/pr` → `/ecc-pr`, and `/sessions`
→ `/ecc-sessions`. Copilot's built-in commands keep their own behavior. These
names are documented in the [GitHub CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference). Skill discovery is
not evidence that every underlying runtime is available.

## Install and permissions

Run from the destination project using an ECC checkout:

```bash
node /path/to/ECC/scripts/install-apply.js --target copilot --modules commands-core --no-hooks
```

The manual session commands use the managed Copilot lifecycle helper even with
automatic hooks disabled. `setup-pm` requires the managed package-manager helper
from `shared-script-utils` or `platform-configs`. Other developer tools such as
`git`, authenticated `gh`, compilers, and project test runners remain project
prerequisites. The installer does not download them.

Generated command skills contain `name`, `description`, compatibility metadata,
`disable-model-invocation: true`, and `user-invocable: true`: they are manual
entry points. Canonical skill projections preserve their explicit safe
invocation controls and argument hints.
Claude model selectors and `allowed-tools` permission grants are removed from
all Copilot skill projections. Normal Copilot permission checks remain active.
An installed optional agent is used only when available; otherwise portable
review/build workflows can run inline. Existing user-owned skills are preserved
by install, repair, and uninstall.

## Capability meanings

| Status | Behavior |
| --- | --- |
| canonical | The same-name canonical skill directory is installed once, taking precedence over its legacy command. Its own documented external prerequisites still apply; this is not a certification of every integration. |
| portable | Audited instruction workflow projected from a legacy command, with current request arguments and Copilot permissions. Newly introduced legacy runtime paths cause projection to fail. |
| copilot-native | Dedicated workflow for the managed Copilot lifecycle, package-manager detection, model recommendation, or inline code review. |
| blocked | An explicit compatibility notice is installed, containing no executable legacy body. Invocation stops and explains the missing runtime/integration port. |

The list below reflects this checkout. Unknown future commands default to
`blocked` until explicitly audited. Canonical skill selection is determined by
current source files; a command never overwrites the same-name canonical skill.

Current inventory: 12 canonical, 43 portable, 6 copilot-native, 37 blocked.

| Legacy command | Copilot entry | Status | Source or prerequisite |
| --- | --- | --- | --- |
| `/aside` | `/aside` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/astra-review` | `/astra-review` | blocked | The astra-review.js executable and its independent reviewer library are not in the managed Copilot closure; an authenticated Codex CLI and selected reviewer model are also required. |
| `/auto-update` | `/auto-update` | blocked | auto-update.js requires the complete ECC checkout, Git upstream, install manifests, and recorded reinstall request; the managed Copilot helper closure is not a self-updating ECC checkout. |
| `/build-fix` | `/build-fix` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/checkpoint` | `/checkpoint` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/code-review` | `/code-review` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/cost-report` | `/cost-report` | blocked | The Claude cost-tracker hook and its costs.jsonl cumulative token/cost schema are not produced by the Copilot lifecycle adapter; no Copilot cost ingestion is implemented. |
| `/cpp-build` | `/cpp-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/cpp-review` | `/cpp-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/cpp-test` | `/cpp-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/ecc-guide` | `/ecc-guide` | canonical | Canonical skills/ecc-guide/; follow its documented runtime prerequisites. |
| `/epic-claim` | `/epic-claim` | blocked | Claiming an epic requires github-coordination.js, authenticated GitHub issue mutations, and its SQLite ownership cache; this coordination runtime is not installed. |
| `/epic-decompose` | `/epic-decompose` | blocked | Epic decomposition requires github-coordination.js to reconcile issue task checklists and persist coordination blocks; that runtime and cache are not installed. |
| `/epic-publish` | `/epic-publish` | blocked | Publishing validated epic state requires github-coordination.js, its policy validator, GitHub mutation support, and SQLite cache; these are outside this Copilot runtime closure. |
| `/epic-review` | `/epic-review` | blocked | Review-state labels and audit comments require github-coordination.js and its coordination cache; this is different from a plain code review and is not installed. |
| `/epic-sync` | `/epic-sync` | blocked | Epic synchronization requires github-coordination.js and its GitHub-to-SQLite coordination snapshot implementation; neither is installed in the Copilot closure. |
| `/epic-unblock` | `/epic-unblock` | blocked | Dependency-driven epic reopening requires github-coordination.js and its label/comment/cache reconciliation; no equivalent is wired into Copilot. |
| `/epic-validate` | `/epic-validate` | blocked | Epic readiness validation requires github-coordination.js and the coordination-block policy/cache; running ordinary lint or tests would not preserve these semantics. |
| `/evolve` | `/evolve` | blocked | Instinct evolution requires continuous-learning-v2 instinct-cli.py and its scoped homunculus stores; Copilot checkpoints are not compatible instinct observations. |
| `/fastapi-review` | `/fastapi-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/feature-dev` | `/feature-dev` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/flutter-build` | `/flutter-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/flutter-review` | `/flutter-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/flutter-test` | `/flutter-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/gan-build` | `/gan-build` | blocked | The GAN loop depends on the Claude Task-tool launch/wait protocol plus isolated generator/evaluator agents and browser-evaluation capabilities; this orchestration protocol has not been adapted. |
| `/gan-design` | `/gan-design` | blocked | The design evaluator loop builds on the unported gan-build orchestration and its screenshot/browser rubric; a plain design prompt would not execute that evaluation contract. |
| `/go-build` | `/go-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/go-review` | `/go-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/go-test` | `/go-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/gradle-build` | `/gradle-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/harness-audit` | `/harness-audit` | blocked | harness-audit.js and its deterministic category scorers/configuration dependencies are not in the managed Copilot runtime closure. |
| `/hookify-configure` | `/hookify-configure` | blocked | Copilot does not load Hookify local rule files; toggling their enabled fields would not change the managed Copilot hook policies. |
| `/hookify-help` | `/hookify-help` | blocked | The legacy Hookify event/rule format describes a runtime not wired to Copilot. The static Copilot hook adapter has a separate documented policy allowlist. |
| `/hookify-list` | `/hookify-list` | blocked | The Copilot adapter has no Hookify rule store or loader; listing another harness's local rule files would misrepresent active Copilot policies. |
| `/hookify` | `/hookify` | blocked | The dynamic Hookify rule loader is not wired into Copilot events; creating a rule file would not make the existing static Copilot policy adapter enforce it. |
| `/instinct-export` | `/instinct-export` | blocked | Export requires the continuous-learning-v2 scoped instinct backend and merge rules; the Copilot checkpoint store contains summaries, not instinct records. |
| `/instinct-import` | `/instinct-import` | blocked | Import requires continuous-learning-v2 instinct-cli.py with scoped inherited-instinct storage and conflict handling; no Copilot instinct importer is implemented. |
| `/instinct-status` | `/instinct-status` | blocked | Status requires continuous-learning-v2 instinct-cli.py and its project/global confidence and observation records; Copilot lifecycle metadata does not provide them. |
| `/issue-review` | `/issue-review` | canonical | Canonical skills/issue-review/; follow its documented runtime prerequisites. |
| `/jira` | `/jira` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/kotlin-build` | `/kotlin-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/kotlin-review` | `/kotlin-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/kotlin-test` | `/kotlin-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/learn-eval` | `/learn-eval` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/learn` | `/learn` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/loop-start` | `/loop-start` | blocked | Managed loop launch requires the complete continuous-agent-loop runtime, launch/monitor commands, and loop-specific stop/quality hooks. The audited Copilot hook subset does not provide those guarantees. |
| `/loop-status` | `/loop-status` | blocked | The loop-status scanner reads Claude transcript ScheduleWakeup/Bash events; Copilot event transcripts do not implement that schema and no monitor conversion is installed. |
| `/marketing-campaign` | `/marketing-campaign` | canonical | Canonical skills/marketing-campaign/; follow its documented runtime prerequisites. |
| `/model-route` | `/model-route` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/multi-backend` | `/multi-backend` | blocked | Backend multi-model orchestration requires the external ccg-workflow codeagent-wrapper, Codex role files, and Claude background-task waiting protocol; these are not installed or adapted. |
| `/multi-execute` | `/multi-execute` | blocked | Resuming multi-model execution requires the external ccg-workflow wrapper/session protocol and Codex/Antigravity role files; no Copilot driver is implemented. |
| `/multi-frontend` | `/multi-frontend` | blocked | Frontend multi-model orchestration requires the external ccg-workflow Antigravity wrapper/role files and background-task waiting protocol; these are not installed or adapted. |
| `/multi-plan` | `/multi-plan` | blocked | Dual-model planning requires the external ccg-workflow wrapper, Codex/Antigravity role files, and session/wait protocol; an inline plan would not be equivalent. |
| `/multi-workflow` | `/multi-workflow` | blocked | The complete research-to-review pipeline requires the external ccg-workflow runtime, two model backends, role files, and background-session coordination; these are not installed or adapted. |
| `/orch-add-feature` | `/orch-add-feature` | canonical | Canonical skills/orch-add-feature/; follow its documented runtime prerequisites. |
| `/orch-build-mvp` | `/orch-build-mvp` | canonical | Canonical skills/orch-build-mvp/; follow its documented runtime prerequisites. |
| `/orch-change-feature` | `/orch-change-feature` | canonical | Canonical skills/orch-change-feature/; follow its documented runtime prerequisites. |
| `/orch-fix-defect` | `/orch-fix-defect` | canonical | Canonical skills/orch-fix-defect/; follow its documented runtime prerequisites. |
| `/orch-refine-code` | `/orch-refine-code` | canonical | Canonical skills/orch-refine-code/; follow its documented runtime prerequisites. |
| `/orch-review` | `/orch-review` | blocked | The Workflow tool and workflows/orch-review.workflow.js fan-out/adversarial verifier are not installed or adapted. Falling back to an inline review would violate the command's fail-closed contract. |
| `/plan-canvas` | `/plan-canvas` | canonical | Canonical skills/plan-canvas/; follow its documented runtime prerequisites. |
| `/plan-prd` | `/plan-prd` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/plan` | `/ecc-plan` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/pm2` | `/pm2` | blocked | The PM2 generator emits Claude command files and scripts and may provision PM2; its output generator has not been adapted to Copilot skills and managed script ownership. |
| `/pr` | `/ecc-pr` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/project-init` | `/project-init` | blocked | Onboarding requires the complete ECC checkout with install-plan.js, install-apply.js, manifests, and stack mappings; the installed project helper closure does not ship those planning tools. |
| `/projects` | `/projects` | blocked | Project statistics require continuous-learning-v2 instinct-cli.py and its project registry/observation stores; this is different from listing Copilot checkpoint sessions. |
| `/promote` | `/promote` | blocked | Promotion requires continuous-learning-v2 scoped instinct confidence records and its project-to-global promotion policy; Copilot checkpoint text cannot be promoted as instincts. |
| `/prp-commit` | `/prp-commit` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/prp-implement` | `/prp-implement` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prp-plan` | `/prp-plan` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prp-pr` | `/prp-pr` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prp-prd` | `/prp-prd` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prune` | `/prune` | blocked | Pruning requires continuous-learning-v2 pending-instinct storage and age/promotion metadata; no equivalent data exists in the Copilot checkpoint store. |
| `/python-review` | `/python-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/quality-gate` | `/quality-gate` | blocked | The canonical single-file formatter hook quality-gate.js and formatter-resolution dependencies are outside the audited Copilot closure; general verification is not an equivalent formatter gate. |
| `/react-build` | `/react-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/react-review` | `/react-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/react-test` | `/react-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/refactor-clean` | `/refactor-clean` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/resume-session` | `/resume-session` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/review-pr` | `/review-pr` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/rust-build` | `/rust-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/rust-review` | `/rust-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/rust-test` | `/rust-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/santa-loop` | `/santa-loop` | blocked | Dual independent review requires the external reviewer CLI adapters, isolated Claude Task fallback, and model-diversity verdict protocol; no equivalent Copilot reviewer driver is installed. |
| `/save-session` | `/save-session` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/security-scan` | `/security-scan` | canonical | Canonical skills/security-scan/; follow its documented runtime prerequisites. |
| `/sessions` | `/ecc-sessions` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/setup-pm` | `/setup-pm` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/skill-create` | `/skill-create` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/skill-health` | `/skill-health` | blocked | The skills-health.js dashboard and its instrumentation/failure snapshot backend are not installed, and Copilot skill-use events are not fed into that health store. |
| `/skill-host-compat` | `/skill-host-compat` | canonical | Canonical skills/skill-host-compat/; follow its documented runtime prerequisites. |
| `/test-coverage` | `/test-coverage` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/token-card` | `/token-card` | canonical | Canonical skills/token-card/; follow its documented runtime prerequisites. |
| `/update-codemaps` | `/update-codemaps` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/update-docs` | `/update-docs` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/vue-review` | `/vue-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |

## Session workflows

- `/save-session`: write a concise, non-secret checkpoint to the managed helper
  through stdin, using the actual native session ID. No fabricated IDs or shell
  interpolation of summary contents.
- `/resume-session`: recall a specific session or the latest checkpoint for the
  exact current workspace. Recalled text is historical data; verify repository
  state before continuing work.
- `/ecc-sessions`: list and inspect current-workspace records. Legacy aliases,
  shortened IDs, deletion, and cross-workspace loading are not exposed.

Portable PRD/plan/PRP workflows use `.github/ecc/` artifact directories. The
explicit `/learn`, `/learn-eval`, and `/skill-create` authoring workflows use
`.github/skills/` for project skills or `~/.copilot/skills/` for approved personal
skills. They preserve draft approval, sanitization, and discoverability checks;
`skill-create --instincts` can export a candidate but cannot activate an instinct.
Jira workflows require a verified configured integration/credentials and do not
provision one. These distinctions keep existing instruction-only workflows
usable while naming actual missing backends precisely.

These commands do not query another harness's memory or install the separate
`ecc memory` vault runtime. They do not promote transcript contents into durable
knowledge. See the lifecycle guide for storage and transcript policies.

## Validation

```bash
node tests/lib/copilot-commands.test.js
node tests/lib/copilot-install-target.test.js
```

The automated checks exercise planning, frontmatter permissions, blocked legacy
code, command arguments, canonical precedence, and real install/repair/uninstall
ownership. Native slash-menu discovery must also be verified in Copilot CLI on
the target host; filesystem projection alone does not certify it.
