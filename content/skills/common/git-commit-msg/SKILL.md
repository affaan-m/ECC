---
name: commit
description: Analyze current git changes, infer this repository's commit-title convention from recent git logs, and create a commit with a concise title/body plus required Codex co-author trailer. Use when user asks to commit, runs /commit, or requests a commit message from the current diff.
---

# Commit

## Workflow

1. Inspect repository state and choose the commit source.
```bash
git status --short
git diff --cached --name-only
```
- If staged files exist, commit staged changes only.
- If nothing is staged but working tree has changes, stage all with `git add -A` before composing the commit.
- If no changes exist, stop and report nothing to commit.

2. Read changed files and summarize intent.
```bash
git diff --cached --stat
git diff --cached
```
Use `git diff` when the commit source is the working tree.
Extract the primary change theme in one sentence.

3. Infer subject convention from recent history.
```bash
git log --no-merges --format=%s -n 40
git log --no-merges --format=%s -- <path-or-scope> -n 20
```
Apply these rules:
- Use the common parent directory of changed files, or the representative module for the change, as `<path-or-scope>`.
- Prefer `<scope>: <Subject>` when recent related commits use it.
- Use imperative, concise subject text.
- Match casing and punctuation style used in nearby commits.

4. Draft commit message.
Format:
```text
<TITLE>

<BODY>

Co-authored-by: @codex <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>
```
Message rules:
- Keep title on one line and under 72 chars when possible.
- Write body as 1-3 bullet lines describing what changed and why.
- Avoid generic body text such as "update" or "fix stuff".

5. Validate before commit.
If this git repository has CI, run the appropriate local checks before committing to verify there are no problems.
- Inspect the repository's CI configuration first and follow the closest matching validation steps.
- Prefer the narrowest commands that faithfully reflect CI for the files being committed.
- If no CI is defined, skip this step and note that no CI-based validation was available.
- If checks fail, stop and report failure unless the user explicitly asks to commit anyway.

6. Create the commit.
```bash
git commit -m "<TITLE>" -m "<BODY>" -m "Co-authored-by: @codex <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>"
```

## Output Contract

When invoked, always provide:
1. Proposed title
2. Proposed body
3. Validation status (`ran`, `skipped`, or `failed`) with the command summary
4. Final commit command or resulting commit hash
