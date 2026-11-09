# Copilot catalog dependency audit

Regenerate with `node scripts/ci/copilot-catalog-audit.js --write`; enforce freshness and command registration with `--check`.

This scanner covers the declared canonical source directories. Canonical findings remain a review index. The full-profile package gate checks rendered Copilot instructions separately. Native invocation and external-provider evidence remain **native-unverified** here.

| File family | Files |
| --- | ---: |
| agent | 71 |
| asset | 361 |
| command | 98 |
| rule | 122 |
| runtime | 451 |
| skill | 314 |

| Finding family | Occurrences |
| --- | ---: |
| external-tool | 2603 |
| host-api | 4 |
| host-path | 394 |
| host-variable | 424 |
| interpreter | 2086 |
| local-reference | 1512 |
| renamed-command | 124 |

## Interpretation

Prose is labelled `documentation-reference`; fenced Markdown and code are labelled `executable-candidate`. Both labels are heuristic and require semantic review. Examples and historical references may resemble dependencies. Conversely, interpolated, constructed, relative or external paths may evade these patterns; zero findings does not establish portability. `present` identifies a checkout-root path. `skill-local-present` identifies a possible resolution under the canonical skill directory. Both are path existence checks. Actual commands still need an explicit working-directory or path convention.

Every row has a stable path ID and source hash. The JSON records each finding with line, column, type, resolution and review state. It covers canonical skill documents plus their nested assets, all agents, commands, rules, scripts, hook helpers and declared assets. Symlinks are not followed.

## Explicit skill adaptations

The installer owns this exact-path mapping. Notice-only entries describe an unsupported canonical workflow and any available alternative. Canonical findings remain visible for both groups.

Literal managed runtime references in projected instructions are checked separately. A standalone closure entry is planned by the skill itself. An additional module entry requires a separately installed helper. These are source and plan checks; test actual runtime execution in an installed project.

| Skill | Copilot projection | Managed runtime references |
| --- | --- | --- |
| `skills/agentic-os/SKILL.md` | notice-only | — |
| `skills/ai-regression-testing/SKILL.md` | projected | — |
| `skills/autonomous-agent-harness/SKILL.md` | notice-only | — |
| `skills/autonomous-loops/SKILL.md` | projected | `scripts/copilot-orchestrate.js` (standalone-closure) |
| `skills/ck/SKILL.md` | projected | `scripts/hooks/copilot-lifecycle.js` (standalone-closure) |
| `skills/config-gc/SKILL.md` | notice-only | — |
| `skills/configure-ecc/SKILL.md` | projected | — |
| `skills/continuous-learning-v2/SKILL.md` | projected | `scripts/copilot-learning.py` (standalone-closure), `scripts/copilot-observer.js` (standalone-closure) |
| `skills/continuous-learning/SKILL.md` | notice-only | — |
| `skills/cost-tracking/SKILL.md` | projected | `scripts/copilot-cost-report.js` (standalone-closure) |
| `skills/deepseek-harness-setup/SKILL.md` | notice-only | — |
| `skills/delivery-gate/SKILL.md` | notice-only | — |
| `skills/dmux-workflows/SKILL.md` | notice-only | — |
| `skills/ecc-recipes/SKILL.md` | projected | — |
| `skills/gateguard/SKILL.md` | projected | — |
| `skills/hookify-rules/SKILL.md` | projected | `scripts/copilot-hookify.js` (standalone-closure) |
| `skills/knowledge-ops/SKILL.md` | projected | — |
| `skills/plan-canvas/SKILL.md` | projected | `scripts/copilot-canvas.js` (standalone-closure) |
| `skills/plan-orchestrate/SKILL.md` | projected | `scripts/copilot-orchestrate.js` (standalone-closure) |
| `skills/plankton-code-quality/SKILL.md` | projected | `scripts/copilot-runtime.js` (additional-module) |
| `skills/repo-scan/SKILL.md` | notice-only | — |
| `skills/rules-distill/SKILL.md` | projected | — |
| `skills/skill-comply/SKILL.md` | projected | `scripts/copilot-skill-comply.js` (standalone-closure) |
| `skills/skill-host-compat/SKILL.md` | projected | — |
| `skills/skill-scout/SKILL.md` | projected | — |
| `skills/skill-stocktake/SKILL.md` | projected | `scripts/copilot-telemetry.js` (additional-module) |
| `skills/strategic-compact/SKILL.md` | projected | `scripts/hooks/copilot-lifecycle.js` (standalone-closure) |
| `skills/unified-memory/SKILL.md` | projected | `scripts/copilot-memory.js` (standalone-closure), `scripts/hooks/copilot-lifecycle.js` (standalone-closure) |

## Installed profile and native evidence

Run `npm run copilot:verify-package` to compare the installed full profile with the source plan and check rendered instructions, literal managed helper paths and bundled skill assets. The gate records reviewed project examples explicitly. Unknown command names must receive an explicit audited registry entry or a canonical skill projection; `--check` rejects them even when the generated snapshot is fresh.

Unknown command entries: 0. Missing projected managed runtime files: 0.

The installer continues using its existing explicit command capability registry. This audit is an additional CI diagnostic, not a second runtime permission registry. Use NATIVE-018 and NATIVE-019 for native invocation and external-prerequisite evidence.
