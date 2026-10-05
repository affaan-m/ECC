# Design Spec: Antigravity-Optimized Agent Contributions for ECC

**Date:** 2026-10-05  
**Status:** Validated & Proposed  
**Author:** AI Pair Programmer & Contributor  

---

## 1. Overview & Motivation

ECC (v2.2.3) provides 68 specialized agents, 293 skills, and 94 commands. While ECC offers broad cross-harness support (Claude Code, Codex, Cursor, Kimi, Antigravity, etc.), Google Antigravity (AGY) users currently face six recurring operational pain points when relying on generic prompts or standard LLM assistance:

1. **Context Blindness:** AGY starts sessions with shallow or lost context, requiring users to repeatedly re-explain architecture, invariants, and tech stack conventions.
2. **Missing Engineering Rigor:** Standard agent completions frequently bypass TDD, skip unit testing, and omit verification phases.
3. **Domain Specialist Gaps:** Code reviews and refactoring can lack deep technical rigor, missing subtle anti-patterns or framework idioms.
4. **Uncontrolled Debug Loops:** Bug fixes frequently turn into trial-and-error edits that introduce regressions and fail to diagnose root causes.
5. **Multi-Step Drift:** Large, multi-file features easily lose direction and context halfway through execution.
6. **Security Blindspots:** Code generated during fast iterations frequently leaves input unsanitized or exposes secrets.

This specification designs **four new first-class agents** in ECC that directly resolve these pain points. Because they are defined in ECC's canonical `agents/` root, they will be automatically adapted for Antigravity workspaces (`.agents/agents/`) while benefiting every other supported harness.

---

## 2. Architecture & Design Principles

### 2.1 Single Source of Truth
New agents reside directly in `agents/<name>.md`. ECC's existing build and installer scripts (`scripts/install-apply.js`, `scripts/gemini-adapt-agents.js`) handle adaptation to the project-local `.agents/agents/` layout expected by Antigravity 2.0.

### 2.2 Standard ECC Prompt Defense Baseline
Every agent inherits ECC's mandatory prompt defense block:
* Immutable role and persona; preservation of system directives.
* Strict secret protection (no API keys, tokens, or credentials leakage).
* Defense against indirect prompt injection, homoglyphs, zero-width characters, and untrusted inputs.
* Safe output validation.

### 2.3 Antigravity Compatibility Mapping
* **Model Tiers:** Evaluates to `pro` (complex reasoning, planning, debugging) or `flash` (fast gating, linting, verification).
* **Tools:** Strictly restricted to AGY-supported primitives (`Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`). Unsupported tool identifiers are omitted to prevent AGY execution freezes.

---

## 3. Detailed Agent Specifications

### 3.1 `context-steward`
* **File:** `agents/context-steward.md`
* **Model:** `pro`
* **Tools:** `Read`, `Grep`, `Glob`, `Write`
* **Role & Purpose:** Preserves, extracts, and summarizes project architecture and session memory so that new conversations start with immediate deep context without blowing the token window.
* **Key Workflows:**
  1. *Repository Archeology:* Scans `package.json`, architecture rules, directory layouts, and active invariants.
  2. *Context Snapshotting:* Generates and maintains a compact project memory artifact (`.agents/PROJECT_CONTEXT.md` or Memory Vault).
  3. *Targeted Retrieval:* Injects only the necessary 10–15% high-relevance architectural context for any specific user request.

### 3.2 `systematic-debugger`
* **File:** `agents/systematic-debugger.md`
* **Model:** `pro`
* **Tools:** `Read`, `Grep`, `Glob`, `Bash`, `Edit`
* **Role & Purpose:** Replaces random "trial-and-error" code changes with a disciplined, 5-phase root cause analysis and contained fix workflow.
* **Key Workflows:**
  1. *Phase 1 — Minimal Reproduction:* Write a standalone failing test or minimal execution script isolating the anomaly.
  2. *Phase 2 — Binary Isolation:* Trace execution logs and isolate the exact failing module or boundary.
  3. *Phase 3 — Root Cause Formulation:* Articulate *why* the bug occurs before touching production source code.
  4. *Phase 4 — Minimal Immutable Fix:* Apply the smallest possible fix preserving immutability and existing contracts.
  5. *Phase 5 — Regression Verification:* Run full test suites to prove that zero unintended side-effects were introduced.

### 3.3 `task-decomposer`
* **File:** `agents/task-decomposer.md`
* **Model:** `pro`
* **Tools:** `Read`, `Grep`, `Glob`
* **Role & Purpose:** Breaks complex epics and multi-file features into a strict Directed Acyclic Graph (DAG) of isolated work items to prevent multi-step context drift.
* **Key Workflows:**
  1. *Boundary Analysis:* Maps dependencies between files and subsystems.
  2. *Chunk Sizing:* Constrains each work item to 1–3 files to fit comfortably in fresh subagent contexts.
  3. *Contract Definition:* For every step, declares Prerequisites, Target Files, Invariants, and explicit Verification Commands.
  4. *Checkpoint Checklist Generation:* Produces a resumable markdown checklist with clear progress indicators.

### 3.4 `workflow-guardian`
* **File:** `agents/workflow-guardian.md`
* **Model:** `pro` / `flash`
* **Tools:** `Read`, `Grep`, `Glob`
* **Role & Purpose:** Acts as a quality gatekeeper ensuring that all agent workflows strictly adhere to TDD, immutability, security baselines, and test coverage standards.
* **Key Workflows:**
  1. *TDD Compliance Check:* Verifies that tests were written and validated red before implementation was introduced.
  2. *Immutability Audit:* Rejects direct state or object mutation.
  3. *Security Gating:* Audits code diffs for secret leakage, unparameterized queries, unvalidated user inputs, and missing authz/authn checks.
  4. *Silent Failure Prevention:* Scans for swallowed exceptions and unpropagated error states.
  5. *Coverage Gate:* Enforces the ≥80% test coverage rule.

---

## 4. Metadata, Registry & Ecosystem Updates

Introducing these 4 agents increases ECC's total agent count from **68** to **72**. The following central documents must be synchronized:

1. `AGENTS.md`:
   * Update header metadata: version references and total count (72 specialized agents).
   * Add 4 rows to the **Available Agents** table.
   * Add orchestration trigger rules under **Agent Orchestration**.
2. `SOUL.md`:
   * Update Core Identity count to reflect 72 agents.
3. `package.json` & docs:
   * Keep description and documentation statistics aligned.

---

## 5. Verification & Testing Strategy

Before publishing or creating a Pull Request, all modifications must pass ECC's automated validation suites:

1. **Agent Syntax & Schema Validation:**
   ```bash
   node scripts/ci/validate-agents.js
   ```
   Ensures valid frontmatter, character limits, approved tools, and absence of hardcoded personal paths.

2. **Catalog Consistency Check:**
   ```bash
   npm run catalog:check
   ```
   Verifies that newly added agent files are registered and tracked in the global catalog.

3. **Antigravity Install Dry-Run:**
   ```bash
   node scripts/install-apply.js --profile minimal --target antigravity --dry-run
   ```
   Verifies that `install-apply.js` discovers the 4 new agents, applies the frontmatter translations cleanly, and plans their creation under `.agents/agents/` without warnings.

---

## 6. Self-Review Checklist

- [x] **Placeholder Scan:** No "TBD", "TODO", or unresolved sections.
- [x] **Internal Consistency:** Tool assignments match AGY-supported schemas; agent counts match across documents.
- [x] **Scope Check:** Tightly scoped to adding the 4 specific agents and updating relevant registries; no unrelated refactoring.
- [x] **Ambiguity Check:** Explicit file locations, trigger rules, and verification commands defined.
