---
name: conventional-commit-review
description: Reviews staged changes and drafts a Conventional Commits-compliant commit message with the right type, scope, and length. Use before committing, or when the user asks to write, fix, or review a commit message.
metadata:
  origin: personal
---

# Conventional Commit Review

Turns a staged diff into a commit message that follows the Conventional
Commits format (`type(scope): subject`) and matches the repository's actual
history norms instead of a generic template.

## When to Activate

- The user is about to run `git commit` and wants help with the message.
- The user asks "write a commit message for this", "is this commit message
  okay?", or "fix my commit message".
- A PR description needs a commit-style summary line.
- Any workflow step that produces a commit as part of a larger task (a
  refactor, a bugfix, a release) should route the final message through this
  skill rather than inventing a format ad hoc.

## Core Concepts

**Type first.** Every subject line starts with one of `feat`, `fix`, `docs`,
`style`, `refactor`, `perf`, `test`, `build`, `ci`, or `chore`, optionally
followed by a parenthesized scope: `feat(auth): add refresh-token rotation`.

**Match the repo's own norm, don't assume one.** Before writing the message,
check the last 20-30 subject lines with `git log --oneline -30` and measure:

- Do they use conventional prefixes at all, or a different convention?
- What's the typical subject length? (Many repos cluster around 50
  characters; some, like this repository's own history, cluster closer to
  70.) Do not hardcode a number — read it from `git log` each time.
- Is the scope used consistently, or omitted?

**Body only when it earns its place.** A one-line subject is enough for a
small, self-contained change. Add a body when the *why* isn't obvious from
the diff — a workaround, a non-obvious trade-off, a breaking change.

**Breaking changes are explicit.** Use `!` after the type/scope
(`feat(api)!: remove legacy endpoint`) and a `BREAKING CHANGE:` footer
explaining the migration, never a note buried in the body text.

## Workflow

1. Run `git diff --staged` (fall back to `git diff` if nothing is staged) and
   `git log --oneline -30` in the same pass.
2. Classify the change into one Conventional Commits type. If the diff mixes
   concerns (a fix plus an unrelated refactor), say so and suggest splitting
   into two commits rather than picking one type arbitrarily.
3. Infer the scope from the changed path (top-level directory or package
   name), only when the repo's history actually uses scopes.
4. Draft the subject line at the repo's measured length norm, imperative
   mood, no trailing period.
5. Add a body only if the diff needs explanation a reviewer wouldn't get from
   the code alone.
6. Present the message and ask for confirmation before running `git commit`
   — never commit silently on the user's behalf.

## Code Examples

```
feat(billing): add proration for mid-cycle plan changes

Previously plan changes always took effect at the next cycle. This
adds a proration calculation so an upgrade mid-cycle bills the
difference immediately.
```

```
fix(parser): handle trailing comma in JSON5 input

Fixes #482
```

## Anti-Patterns

- **Generic subjects**: "update files", "fix stuff", "wip" — say what
  changed and why it matters to a reader six months from now.
- **Guessing the length convention**: don't assume 50 characters is
  universal; read the actual `git log` history first.
- **One commit, three concerns**: a diff touching auth, a typo fix, and a
  dependency bump should become three commits, not one message that lists
  all three.
- **Silent commits**: never run `git commit` without showing the drafted
  message and getting explicit confirmation first.

## Best Practices

- Read history before drafting — the convention lives in the repo, not in a
  fixed rule.
- Keep the subject in the imperative mood ("add", not "added" or "adds").
- Reference issue/ticket numbers in the footer, not the subject line.
- When in doubt about scope naming, prefer the directory name closest to the
  change over an abstract feature name.

## Related Skills

- `git-workflow` — broader git usage patterns beyond commit messages.
- `code-review-and-quality` — reviewing the diff's content, not just its
  message.
