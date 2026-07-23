# Manual Orchestration Guide

ECC can run several coding agents in isolated git worktrees and tmux panes while keeping their tasks, status, and handoffs in one coordination directory. Use this for work that is genuinely parallel: separate modules, independent test suites, or changes that should not share a working tree while they are in progress.

For planning, research, or review that does not need separate filesystem state, use normal in-process subagents instead. They are simpler and cost less operational overhead.

## Before You Start

You need:

- a git repository with a clean enough base commit for new worktrees
- Node.js
- tmux
- the worker command you want each pane to launch
- tasks with non-overlapping file ownership, or an explicit integrator

Run orchestration from the repository you want the workers to modify. The ECC scripts may live in that repository or be addressed by an absolute path.

## 1. Write a Plan

Create a JSON plan such as `.claude/plan/billing-workflow.json`:

```json
{
  "sessionName": "billing-workflow",
  "baseRef": "HEAD",
  "launcherCommand": "bash {repo_root_sh}/scripts/orchestrate-codex-worker.sh {task_file_sh} {handoff_file_sh} {status_file_sh}",
  "workers": [
    {
      "name": "api",
      "task": "Implement the billing alert API. Own server/billing and its tests."
    },
    {
      "name": "ui",
      "task": "Implement the billing alert settings UI. Own web/settings and its tests."
    },
    {
      "name": "review",
      "task": "Review the API and UI handoffs. Do not implement unrelated changes."
    }
  ]
}
```

ECC creates one branch and worktree per worker. Worker names must produce unique slugs, and every worker needs a non-empty task. A worker may override the top-level `launcherCommand` when it needs a different harness.

Supported launcher placeholders include:

| Placeholder | Resolves to |
|---|---|
| `{worker_name}` | Human-readable worker name |
| `{worker_slug}` | Filesystem-safe worker identifier |
| `{session_name}` | Normalized tmux session name |
| `{repo_root}` | Main repository path |
| `{worktree_path}` | Worker's isolated worktree |
| `{branch_name}` | Worker's generated branch |
| `{task_file}` | Generated task instructions |
| `{handoff_file}` | Worker handoff destination |
| `{status_file}` | Worker status destination |

Every placeholder also has a shell-quoted form ending in `_sh`, such as `{task_file_sh}`. Prefer the quoted form inside shell commands.

## 2. Preview Before Launching

Run the plan with no execution flag:

```bash
node scripts/orchestrate-worktrees.js .claude/plan/billing-workflow.json
```

This prints the branches, worktree paths, task files, launch commands, and tmux commands without creating them. Check for overlapping ownership and confirm every generated path before continuing.

If workers need an untracked or modified local file, add a narrow `seedPaths` array to the plan or one worker. ECC overlays only those paths into the new worktree. Seed paths must stay inside the repository.

## 3. Launch the Session

```bash
node scripts/orchestrate-worktrees.js .claude/plan/billing-workflow.json --execute
tmux attach -t billing-workflow
```

ECC creates:

- one tmux orchestrator pane
- one pane, branch, and worktree per worker
- `.orchestration/<session>/<worker>/task.md`
- `.orchestration/<session>/<worker>/status.md`
- `.orchestration/<session>/<worker>/handoff.md`

Use `--write-only` instead of `--execute` when you want ECC to materialize coordination files without starting worktrees or tmux workers.

## 4. Inspect Progress

Read the live session by name or by plan file:

```bash
node scripts/orchestration-status.js billing-workflow
node scripts/orchestration-status.js .claude/plan/billing-workflow.json
```

To save a machine-readable snapshot:

```bash
node scripts/orchestration-status.js billing-workflow --write /tmp/billing-workflow.json
```

The snapshot includes worker intent, pane state, branch and worktree paths, seeded files, status, and recent handoff summaries.

## 5. Review and Integrate

Do not merge merely because every worker stopped. Use an explicit merge gate:

1. Read each handoff and changed-file list.
2. Run the worker's focused tests in its worktree.
3. Review each branch diff.
4. Run security or risk checks where the change warrants them.
5. Choose one integrator to resolve conflicts and run the combined test suite.
6. Merge only the branches that passed their gate.

The [team-agent-orchestration skill](../skills/team-agent-orchestration/SKILL.md) adds a useful work-item schema, Kanban states, ownership rules, and evidence requirements for larger teams.

## Cleanup

The launcher creates normal git worktrees and a normal tmux session. Inspect them before cleanup:

```bash
git worktree list
tmux list-sessions
```

After changes are committed, handed off, and integrated, remove each worktree with `git worktree remove <path>` and close the tmux session with `tmux kill-session -t billing-workflow`. Delete generated branches only after confirming they are merged or no longer needed.

## Failure Modes

- Too many workers: coordination costs exceed the parallel speedup.
- Overlapping ownership: agents edit the same files and create avoidable conflicts.
- Vague tasks: workers return plausible output that does not integrate.
- No handoff: useful context remains trapped in a terminal pane.
- No merge gate: branches are combined without tests or review.
- Nested orchestration: workers launch more workers and make ownership impossible to trace.

Start with two independent workers and one integrator. Add concurrency only when the work actually separates cleanly.
