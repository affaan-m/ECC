---
name: cleanup
description: Safely remove the current feature branch worktree, delete the local branch, and pull main. Use after a feature branch is merged or no longer needed.
---

# Cleanup

Safely tear down the current feature branch worktree and return to a clean main branch.

## Prerequisites

- You must be inside a git worktree (not the main working tree).
- The branch should already be merged or otherwise disposable.

## Workflow

1. Identify the current worktree and branch.
```bash
git rev-parse --show-toplevel
git branch --show-current
git worktree list
```
- Save the **current worktree path** and **branch name**.
- Detect the **main worktree path** from `git worktree list` (the entry without `[branch]` bracket or the one on `main`/`master`).
- If the current directory is already the main worktree (not a linked worktree), stop and report: "Not in a feature worktree. Nothing to clean up."

2. Check for uncommitted changes.
```bash
git status --short
```
- If there are uncommitted changes, stop and warn the user. Do NOT proceed unless the user explicitly confirms they want to discard the changes.

3. Change to the main worktree.
```bash
cd <main-worktree-path>
```
- This must happen BEFORE removing the worktree.

4. Remove the worktree.
```bash
git worktree remove <feature-worktree-path>
```
- If removal fails (e.g., untracked files), report the error and suggest `git worktree remove --force <path>` only with user confirmation.

5. Delete the local branch.
```bash
git branch -d <branch-name>
```
- Use `-d` (safe delete), not `-D`.
- If the branch is not fully merged, report this to the user and ask before using `-D`.

6. Pull latest main.
```bash
git pull
```

## Output Contract

When invoked, always report:
1. Worktree removed (path)
2. Branch deleted (name)
3. Main branch pull result (up-to-date or commits pulled)

## Safety Rules

- NEVER force-remove a worktree without user confirmation.
- NEVER force-delete an unmerged branch without user confirmation.
- NEVER proceed if there are uncommitted changes without user confirmation.
- Always `cd` to the main worktree BEFORE removing the feature worktree.
