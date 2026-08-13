---
template_source: docs-governance /governance-init
template_version: 2026-07-02-v3
note: The derived file belongs to the project. Template updates do not overwrite it; synchronize fixed sections manually when needed.
---

# {Project Name} — Governance Guide

## 1. Governance Principles (Fixed)

After changing code, complete the four-step process in section 2. Skipping it violates the shared project charter. Claude Code enters through `CLAUDE.md`; Codex enters through the thin `AGENTS.md` bridge.

This document has two parts:

- Fixed sections (§1–§4 and §7–§8): derived from the template; change sparingly.
- Project sections (§5 and §6): project-owned and extended as evidence appears.

## 2. Four-Step Post-Change Process (Fixed)

### Step 1 — List Changes

- Which source files changed (`git status -s` or session review)?
- Which modules, fields, and rules are involved according to section 5?

### Step 2 — Determine Impact

- Business-rule changes trigger the business/rule audit in section 6.
- Configuration or schema changes trigger the high-risk-file rules in section 6.
- Pure refactoring, renaming, logging, or test strengthening follows the documented exemption rules.

### Step 3 — Synchronize Documentation

- Use the module mapping in section 5 to identify affected docs.
- Use the ownership boundaries in section 4 to decide where each fact belongs.

### Step 3.5 — Run the Real System (Acceptance Layer 3)

- Run the minimum relevant command defined by the project.
- Inspect the resulting artifacts defined by the project.
- Apply task-specific depth:
  - routine small change → minimum relevant command;
  - important feature → real end-to-end path;
  - artifact-producing task → inspect the artifact itself (image opens, table shape is correct, file is non-empty, output path is correct);
  - docs/comments/rename only → exemption allowed when the delivery summary states why.

### Step 4 — Produce the Summary in Section 7

## 3. Four Project Placeholders

Expand these in sections 5 and 6:

- `<PROJECT_MODULE_MAP>`: changed module → documentation that must stay synchronized.
- `<LANGUAGE_CHECKS>`: stack-specific checks, such as Python relative imports or Node `console.log` calls.
- `<BUSINESS_RULE_AUDIT>`: changes that trigger domain review.
- `<NO_DOC_SYNC_EXEMPTIONS>`: changes that do not require documentation synchronization.

Promote a placeholder pattern back into the template only after it recurs in at least two projects. This prevents one project from contaminating the shared template.

## 4. Documentation Ownership Boundaries (Fixed)

| Content | Owner |
|---|---|
| Always-on hard rules and pointers | `CLAUDE.md`, kept within one page; `AGENTS.md` remains only a Codex bridge |
| External project overview, installation, and run instructions | `README.md` |
| Module requirements and success criteria | The project's Spec/Issue artifact |
| Module technical plan and known hazards | The project's Plan artifact |
| Important architecture decisions | The repository's ADR convention |
| Completed artifact archive | The repository's existing archive convention |

`CLAUDE.md` links to detail instead of repeating it. `AGENTS.md` does not copy `CLAUDE.md`.

## 5. Module Mapping (Project-Owned)

| Change type | Documentation that must be synchronized |
|---|---|
| `{module path}` | `{corresponding artifact}` |

## 6. High-Risk Files, Business Audit, and Exemptions (Project-Owned)

| Category | Trigger | Action |
|---|---|---|
| High risk: configuration/schema/business rules | `{project-specific}` | `{project-specific}` |
| Business-rule audit | `{project-specific}` | `{project-specific}` |
| Language/framework checks | `{project-specific}` | `{project-specific}` |
| Documentation-sync exemption | `{project-specific}` | `{project-specific}` |

## 7. Minimum Delivery Summary (Fixed)

- **Change summary**: goal, scope, risks, rollback.
- **Changed files**: file, what changed, why, and behavioral effect.
- **Synchronization decision**: affected modules/rules, artifacts updated, audits triggered, and exemption reasons.
- **Verification**: normal path and failure/boundary path.
- **Remaining risk**: unresolved items and decisions requiring an owner.

## 8. Three Acceptance Layers (Fixed)

| Layer | Proves | Method |
|---|---|---|
| 1. Automated tests | Local logic is correct | `pytest`, `npm test`, `go test`, or stack equivalent |
| 2. Code review | Structure, risk, and security are acceptable | Human or review command/agent |
| 3. Real execution | Real path and artifacts work | Run the command and inspect outputs defined in section 6 |

The layers do not overlap: tests passing does not prove the real path works, and a command completing does not prove its artifact is correct. Delivery requires all applicable layers.
