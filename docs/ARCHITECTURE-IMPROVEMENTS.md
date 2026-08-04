# Architecture Improvement Recommendations

This document captures architect-level improvements for the Everything Claude Code (ECC) project. It is written from the perspective of a Claude Code coding architect aiming to improve maintainability, consistency, and long-term quality.

---

## 1. Documentation and Single Source of Truth

### 1.1 Agent / Command / Skill Count Sync

**Issue:** AGENTS.md states "13 specialized agents, 50+ skills, 33 commands" while the repo has **16 agents**, **65+ skills**, and **40 commands**. README and other docs also vary. This causes confusion for contributors and users.

**Recommendation:**

- **Single source of truth:** Derive counts (and optionally tables) from the filesystem or a small manifest. Options:
  - **Option A:** Add a script (e.g. `scripts/ci/catalog.js`) that scans `agents/*.md`, `commands/*.md`, and `skills/*/SKILL.md` and outputs JSON/Markdown. CI and docs can consume this.
  - **Option B:** Maintain one `docs/catalog.json` (or YAML) that lists agents, commands, and skills with metadata; scripts and docs read from it. Requires discipline to update on add/remove.
- **Short-term:** Manually sync AGENTS.md, README.md, and CLAUDE.md with actual counts and list any new agents (e.g. chief-of-staff, loop-operator, harness-optimizer) in the agent table.

**Impact:** High — affects first impression and contributor trust.

---

### 1.2 Command → Agent / Skill Map

**Issue:** There is no single machine- or human-readable map of "which command uses which agent(s) or skill(s)." This lives in README tables and individual command `.md` files, which can drift.

**Recommendation:**

- Add a **command registry** (e.g. in `docs/` or as frontmatter in command files) that lists for each command: name, description, primary agent(s), skills referenced. Can be generated from command file content or maintained by hand.
- Expose a "map" in docs (e.g. `docs/COMMAND-AGENT-MAP.md`) or in the generated catalog for discoverability and for tooling (e.g. "which commands use tdd-guide?").

**Impact:** Medium — improves discoverability and refactoring safety.

---

## 2. Testing and Quality

### 2.1 Test Discovery vs Hardcoded List

**Issue:** `tests/run-all.js` uses a **hardcoded list** of test files. New test files are not run unless someone updates `run-all.js`, so coverage can be incomplete by omission.

**Recommendation:**

- **Glob-based discovery:** Discover test files by pattern (e.g. `**/*.test.js` under `tests/`) and run them, with an optional allowlist/denylist for special cases. This makes new tests automatically part of the suite.
- Keep a single entry point (`tests/run-all.js`) that runs discovered tests and aggregates results.

**Impact:** High — prevents regression where new tests exist but are never executed.

---

### 2.2 Test Coverage Metrics

**Issue:** There is no coverage tool (e.g. nyc/c8/istanbul). The project cannot assert "80%+ coverage" for its own scripts; coverage is implicit.

**Recommendation:**

- Introduce a coverage tool for Node scripts (e.g. `c8` or `nyc`) and run it in CI. Start with a baseline (e.g. 60%) and raise over time; or at least report coverage in CI without failing so the team can see trends.
- Focus on `scripts/` (lib + hooks + ci) as the primary target; exclude one-off scripts if needed.

**Impact:** Medium — aligns the project with its own AGENTS.md guidance (80%+ coverage) and surfaces untested paths.

---

## 3. Schema and Validation

### 3.1 Use Hooks JSON Schema in CI

**Issue:** `schemas/hooks.schema.json` exists and defines the hook configuration shape, but `scripts/ci/validate-hooks.js` does **not** use it. Validation is duplicated (VALID_EVENTS, structure) and can drift from the schema.

**Recommendation:**

- Use a JSON Schema validator (e.g. `ajv`) in `validate-hooks.js` to validate `hooks/hooks.json` against `schemas/hooks.schema.json`. Keep the validator as the single source of truth for structure; retain only hook-specific checks (e.g. inline JS syntax) in the script.
- Ensures schema and validator stay in sync and allows IDE/editor validation via `$schema` in hooks.json.

**Impact:** Medium — reduces drift and improves contributor experience when editing hooks.

---

## 4. Cross-Harness and i18n

### 4.1 Skill/Agent Subset Sync (.agents/skills, .cursor/skills)

**Issue:** `.agents/skills/` (Codex) and `.cursor/skills/` are subsets of `skills/`. Adding or removing a skill in the main repo requires manually updating these subsets, which can be forgotten.

**Recommendation:**

- Document in CONTRIBUTING.md that adding a skill may require updating `.agents/skills` and `.cursor/skills` (and how to do it).
- Optionally: a CI check or script that compares `skills/` to the subsets and fails or warns if a skill is in one set but not the other when it should be (e.g. by convention or by a small manifest).

**Impact:** Low–Medium — reduces cross-harness drift.

---

### 4.2 Translation Drift (docs/ zh-CN, zh-TW, ja-JP)

**Issue:** Translations in `docs/` duplicate agents, commands, skills. As the English source evolves, translations can become outdated without clear process or tooling.

**Recommendation:**

- Document a **translation process:** when to update (e.g. on release), who owns each locale, and how to detect stale content (e.g. diff file lists or key sections).
- Consider: translation status file (e.g. `docs/i18n-status.md`) or CI that checks translation file existence/timestamps and warns if English was updated more recently than a translation.
- Long-term: consider extraction/placeholder format (e.g. i18n keys) so translations reference the same structure as the English source.

**Impact:** Medium — improves experience for non-English users and reduces confusion from outdated translations.

---

## 5. Hooks and Scripts

### 5.1 Hook Runtime Consistency

**Issue:** Hooks should keep a consistent Node-mode dispatch surface. Continuous-learning observation now dispatches through `run-with-flags.js` and `observe-runner.js`, which delegates to the existing `observe.sh` implementation without exposing a shell-mode hook entry.

**Recommendation:**

- Prefer Node for new hooks when possible (cross-platform, single runtime). If shell is required, document why and keep the surface small.
- Ensure `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS` are respected in all code paths (including shell) so behavior is consistent.

**Impact:** Low — maintains current design; improves if more hooks migrate to Node.

---

## 6. Summary Table

| Area              | Improvement                          | Priority | Effort  |
|-------------------|--------------------------------------|----------|---------|
| Doc sync          | Sync AGENTS.md/README counts & table | High     | Low     |
| Single source     | Catalog script or manifest           | High     | Medium  |
| Test discovery    | Glob-based test runner               | High     | Low     |
| Coverage          | Add c8/nyc and CI coverage           | Medium   | Medium  |
| Hook schema in CI | Validate hooks.json via schema       | Medium   | Low     |
| Command map       | Command → agent/skill registry       | Medium   | Medium  |
| Subset sync       | Document/CI for .agents/.cursor       | Low–Med  | Low–Med |
| Translations      | Process + stale detection             | Medium   | Medium  |
| Hook runtime      | Prefer Node; document shell use       | Low      | Low     |

---

## 7. Quick Wins (Immediate)

1. **Update AGENTS.md:** Set agent count to 16; add chief-of-staff, loop-operator, harness-optimizer to the agent table; align skill/command counts with repo.
2. **Test discovery:** Change `run-all.js` to discover `**/*.test.js` under `tests/` (with optional allowlist) so new tests are always run.
3. **Wire hooks schema:** In `validate-hooks.js`, validate `hooks/hooks.json` against `schemas/hooks.schema.json` using ajv (or similar) and keep only hook-specific checks in the script.

These three can be done in one or two sessions and materially improve consistency and reliability.
