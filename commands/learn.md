---
description: Extract reusable patterns from the current session and save them as candidate skills or guidance.
---

# /learn - Extract Reusable Patterns

Analyze the current session and extract any patterns worth saving as skills.

## Trigger

Run `/learn` at any point during a session when you've solved a non-trivial problem.

## What to Extract

Look for:

1. **Error Resolution Patterns**
   - What error occurred?
   - What was the root cause?
   - What fixed it?
   - Is this reusable for similar errors?

2. **Debugging Techniques**
   - Non-obvious debugging steps
   - Tool combinations that worked
   - Diagnostic patterns

3. **Workarounds**
   - Library quirks
   - API limitations
   - Version-specific fixes

4. **Project-Specific Patterns**
   - Codebase conventions discovered
   - Architecture decisions made
   - Integration patterns

## Output Format

Create a skill at `~/.claude/skills/<pattern-name>/SKILL.md` (directory format — see the Process note below):

```markdown
---
name: pattern-name
description: "Use when <observable trigger condition> — <one-line essence of the pattern>"
origin: auto-extracted
---

# [Descriptive Pattern Name]

**Extracted:** [Date]
**Context:** [Brief description of when this applies]

## Problem
[What problem this solves - be specific]

## Solution
[The pattern/technique/workaround]

## Example
[Code example if applicable]

## When to Use
[Trigger conditions - what should activate this skill]
```

## Process

1. Review the session for extractable patterns
2. Identify the most valuable/reusable insight
3. Draft the skill file
4. Ask user to confirm before saving
5. Save to `~/.claude/skills/<pattern-name>/SKILL.md` — **directory format with frontmatter**. Claude Code only auto-discovers a skill at `<name>/SKILL.md` carrying a `name` + `description`; a flat `skills/learned/<name>.md` (or any file missing frontmatter) is **inert** — never scanned, matched, or loaded. The `description` is the only discovery surface, so lead it with "Use when ..." naming the trigger.

## Notes

- Don't extract trivial fixes (typos, simple syntax errors)
- Don't extract one-time issues (specific API outages, etc.)
- Focus on patterns that will save time in future sessions
- Keep skills focused - one pattern per skill
