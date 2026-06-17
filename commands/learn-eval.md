---
description: "Extract reusable patterns from the session, self-evaluate quality before saving, and determine the right save location (Global vs Project)."
---

# /learn-eval - Extract, Evaluate, then Save

Extends `/learn` with a quality gate, save-location decision, and knowledge-placement awareness before writing any skill file.

## What to Extract

Look for:

1. **Error Resolution Patterns** — root cause + fix + reusability
2. **Debugging Techniques** — non-obvious steps, tool combinations
3. **Workarounds** — library quirks, API limitations, version-specific fixes
4. **Project-Specific Patterns** — conventions, architecture decisions, integration patterns

## Process

1. Review the session for extractable patterns
2. Identify the most valuable/reusable insight

3. **Determine save location:**
   - Ask: "Would this pattern be useful in a different project?"
   - **Global** (`~/.claude/skills/<pattern-name>/SKILL.md`): Generic patterns usable across 2+ projects (bash compatibility, LLM API behavior, debugging techniques, etc.)
   - **Project** (`.claude/skills/<pattern-name>/SKILL.md` in current project): Project-specific knowledge (quirks of a particular config file, project-specific architecture decisions, etc.)
   - When in doubt, choose Global (moving Global → Project is easier than the reverse)
   - **Directory format is mandatory.** Claude Code only auto-discovers skills at `<name>/SKILL.md` with frontmatter — at session start it scans each skill's `name` + `description` and loads the body only on a match (progressive disclosure). A flat `<name>.md` (e.g. in a `skills/learned/` archive) is **inert**: never scanned, never matched, never loaded. Always write the directory form so the skill is actually reachable.

4. Draft the skill file using this format:

```markdown
---
name: pattern-name
description: "Use when <observable trigger condition>, or when <second trigger> — <one-line essence of the pattern>"
user-invocable: false
origin: auto-extracted
---

# [Descriptive Pattern Name]

**Extracted:** [Date]
**Context:** [Brief description of when this applies]

## Problem
[What problem this solves - be specific]

## Solution
[The pattern/technique/workaround - with code examples]

## When to Use
[Trigger conditions]
```

**Description rules (the `description` is the ONLY discovery surface):**

- Claude scans only `name` + `description` at session start and loads the body on a match — so the description must name the *when*, not just the *what*.
- Lead with "Use when ..." followed by concrete, observable triggers (file patterns, error strings, task verbs, review situations) — the same conditions as the `## When to Use` section, compressed.
- Up to 1024 chars are allowed; spend them on triggers, not philosophy. Vague descriptions ("best practices for X") never match.
- `name` must equal the skill's directory name exactly.

5. **Quality gate — Checklist + Holistic verdict**

   ### 5a. Required checklist (verify by actually reading files)

   Execute **all** of the following before evaluating the draft:

   - [ ] Grep `~/.claude/skills/` and relevant project `.claude/skills/` files by keyword to check for content overlap
   - [ ] Check MEMORY.md (both project and global) for overlap
   - [ ] Consider whether appending to an existing skill would suffice
   - [ ] Confirm this is a reusable pattern, not a one-off fix

   ### 5b. Holistic verdict

   Synthesize the checklist results and draft quality, then choose **one** of the following:

   | Verdict | Meaning | Next Action |
   |---------|---------|-------------|
   | **Save** | Unique, specific, well-scoped | Proceed to Step 6 |
   | **Improve then Save** | Valuable but needs refinement | List improvements → revise → re-evaluate (once) |
   | **Absorb into [X]** | Should be appended to an existing skill | Show target skill and additions → Step 6 |
   | **Drop** | Trivial, redundant, or too abstract | Explain reasoning and stop |

**Guideline dimensions** (informing the verdict, not scored):

- **Specificity & Actionability**: Contains code examples or commands that are immediately usable
- **Scope Fit**: Name, trigger conditions, and content are aligned and focused on a single pattern
- **Uniqueness**: Provides value not covered by existing skills (informed by checklist results)
- **Reusability**: Realistic trigger scenarios exist in future sessions

6. **Verdict-specific confirmation flow**

- **Improve then Save**: Present the required improvements + revised draft + updated checklist/verdict after one re-evaluation; if the revised verdict is **Save**, save after user confirmation, otherwise follow the new verdict
- **Save**: Present save path + checklist results + 1-line verdict rationale + full draft → save after user confirmation
- **Absorb into [X]**: Present target path + additions (diff format) + checklist results + verdict rationale → append after user confirmation
- **Drop**: Show checklist results + reasoning only (no confirmation needed)

7. Save / Absorb to the determined location — for a **Save** verdict, write `<location>/<pattern-name>/SKILL.md` (directory form, never a flat file); for **Absorb**, append to the existing skill's `SKILL.md`.

8. **Verify discoverability after writing** (Save verdict only):
   - `ls <location>/<pattern-name>/SKILL.md` — confirm the path is `<name>/SKILL.md`, not a flat file
   - confirm the frontmatter parses: starts with `---`, has `name:` matching the directory and a non-empty `description:`

## Output Format for Step 5

```
### Checklist
- [x] skills/ grep: no overlap (or: overlap found → details)
- [x] MEMORY.md: no overlap (or: overlap found → details)
- [x] Existing skill append: new file appropriate (or: should append to [X])
- [x] Reusability: confirmed (or: one-off → Drop)

### Verdict: Save / Improve then Save / Absorb into [X] / Drop

**Rationale:** (1-2 sentences explaining the verdict)
```

## Design Rationale

This version replaces the previous 5-dimension numeric scoring rubric (Specificity, Actionability, Scope Fit, Non-redundancy, Coverage scored 1-5) with a checklist-based holistic verdict system. Modern frontier models (Opus 4.6+) have strong contextual judgment — forcing rich qualitative signals into numeric scores loses nuance and can produce misleading totals. The holistic approach lets the model weigh all factors naturally, producing more accurate save/drop decisions while the explicit checklist ensures no critical check is skipped.

## Notes

- Don't extract trivial fixes (typos, simple syntax errors)
- Don't extract one-time issues (specific API outages, etc.)
- Focus on patterns that will save time in future sessions
- Keep skills focused — one pattern per skill
- When the verdict is Absorb, append to the existing skill rather than creating a new file
