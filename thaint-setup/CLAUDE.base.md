# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Don't implement or take multi-step action until the user explicitly confirms - questions aren't authorization.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
` ` `
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
` ` `

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Environment & Tooling

**Strictly isolate dependencies. No system-level modifications.**

- Always use `uv` for package management, dependency resolution, and script execution. Do not fall back to standard `pip` unless explicitly instructed.
- NEVER install packages to the system Python environment.
- Strictly use the `~/.venv` directory as the active virtual environment for the project. Ensure all execution contexts, package installations, and tests are explicitly routed through this specific `~/.venv` environment.

## 6. Implementation Notes & Decisions Log

When implementing a `<SPEC>`, you must maintain a running log of your implementation details.
- If the user specifies an external file (e.g., `implementation-notes.md`), update that file.
- If no external file is specified, append your notes directly to a `[DRAFT_NOTES]` section or a standalone `IMPLEMENTATION_NOTES.md`.

**What to log:**
1. **Implicit Decisions:** Choices you made where the `<SPEC>` was silent or ambiguous.
2. **Tradeoffs:** Why you chose approach A over approach B (e.g., speed vs. readability).
3. **Changes/Deviations:** Any required deviations from the original spec due to technical limitations.

## 7. Delegation

**In a long session, delegate tasks to subagents rather than doing them inline.**

Two payoffs, not one: bulk tool output stays out of the main context, and writing the directive is what makes an acceptance criterion exist. Working inline gives neither. It's the wrong call when the task needs the user's judgment, a conversation, or state newer than the dispatch moment — and measurements run one at a time regardless.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, strict adherence to `uv` and `~/.venv`, clarifying questions come before implementation rather than after mistakes, and long sessions delegate work instead of accumulating it inline.
