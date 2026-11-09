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

Current inventory: 12 canonical, 43 portable, 43 copilot-native, 0 blocked.

The 37 previously blocked commands now have managed implementations. External
authentication, Python, compilers, independently configured models, and a reviewed
full ECC checkout remain explicit prerequisites where used. See
[extended commands](COPILOT-EXTENDED-COMMANDS.md) for setup and behavioral limits.

| Legacy command | Copilot entry | Status | Source or prerequisite |
| --- | --- | --- | --- |
| `/aside` | `/aside` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/astra-review` | `/astra-review` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/auto-update` | `/auto-update` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/build-fix` | `/build-fix` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/checkpoint` | `/checkpoint` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/code-review` | `/code-review` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/cost-report` | `/cost-report` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/cpp-build` | `/cpp-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/cpp-review` | `/cpp-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/cpp-test` | `/cpp-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/ecc-guide` | `/ecc-guide` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/epic-claim` | `/epic-claim` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/epic-decompose` | `/epic-decompose` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/epic-publish` | `/epic-publish` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/epic-review` | `/epic-review` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/epic-sync` | `/epic-sync` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/epic-unblock` | `/epic-unblock` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/epic-validate` | `/epic-validate` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/evolve` | `/evolve` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/fastapi-review` | `/fastapi-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/feature-dev` | `/feature-dev` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/flutter-build` | `/flutter-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/flutter-review` | `/flutter-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/flutter-test` | `/flutter-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/gan-build` | `/gan-build` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/gan-design` | `/gan-design` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/go-build` | `/go-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/go-review` | `/go-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/go-test` | `/go-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/gradle-build` | `/gradle-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/harness-audit` | `/harness-audit` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/hookify-configure` | `/hookify-configure` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/hookify-help` | `/hookify-help` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/hookify-list` | `/hookify-list` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/hookify` | `/hookify` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/instinct-export` | `/instinct-export` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/instinct-import` | `/instinct-import` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/instinct-status` | `/instinct-status` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/issue-review` | `/issue-review` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/jira` | `/jira` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/kotlin-build` | `/kotlin-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/kotlin-review` | `/kotlin-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/kotlin-test` | `/kotlin-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/learn-eval` | `/learn-eval` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/learn` | `/learn` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/loop-start` | `/loop-start` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/loop-status` | `/loop-status` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/marketing-campaign` | `/marketing-campaign` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/model-route` | `/model-route` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/multi-backend` | `/multi-backend` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/multi-execute` | `/multi-execute` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/multi-frontend` | `/multi-frontend` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/multi-plan` | `/multi-plan` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/multi-workflow` | `/multi-workflow` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/orch-add-feature` | `/orch-add-feature` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/orch-build-mvp` | `/orch-build-mvp` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/orch-change-feature` | `/orch-change-feature` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/orch-fix-defect` | `/orch-fix-defect` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/orch-refine-code` | `/orch-refine-code` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/orch-review` | `/orch-review` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/plan-canvas` | `/plan-canvas` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/plan-prd` | `/plan-prd` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/plan` | `/ecc-plan` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/pm2` | `/pm2` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/pr` | `/ecc-pr` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/project-init` | `/project-init` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/projects` | `/projects` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/promote` | `/promote` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/prp-commit` | `/prp-commit` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/prp-implement` | `/prp-implement` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prp-plan` | `/prp-plan` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prp-pr` | `/prp-pr` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prp-prd` | `/prp-prd` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/prune` | `/prune` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/python-review` | `/python-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/quality-gate` | `/quality-gate` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/react-build` | `/react-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/react-review` | `/react-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/react-test` | `/react-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/refactor-clean` | `/refactor-clean` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/resume-session` | `/resume-session` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/review-pr` | `/review-pr` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/rust-build` | `/rust-build` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/rust-review` | `/rust-review` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/rust-test` | `/rust-test` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/santa-loop` | `/santa-loop` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/save-session` | `/save-session` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/security-scan` | `/security-scan` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/sessions` | `/ecc-sessions` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/setup-pm` | `/setup-pm` | copilot-native | Adapted to the managed Copilot project runtime or native session model selection. |
| `/skill-create` | `/skill-create` | portable | Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force. |
| `/skill-health` | `/skill-health` | copilot-native | Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites. |
| `/skill-host-compat` | `/skill-host-compat` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
| `/test-coverage` | `/test-coverage` | portable | Audited instruction workflow; project tools and optional agents/integrations must be available. |
| `/token-card` | `/token-card` | canonical | Same-name canonical skill, including its explicit external prerequisites. |
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
