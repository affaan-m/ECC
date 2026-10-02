#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: bash scripts/orchestrate-codex-worker.sh <task-file> <handoff-file> <status-file>" >&2
  exit 1
fi

task_file="$1"
handoff_file="$2"
status_file="$3"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_status() {
  local state="$1"
  local details="$2"

  cat > "$status_file" <<EOF
# Status

- State: $state
- Updated: $(timestamp)
- Branch: $(git rev-parse --abbrev-ref HEAD)
- Worktree: \`$(pwd)\`

$details
EOF
}

mkdir -p "$(dirname "$handoff_file")" "$(dirname "$status_file")"

if [[ ! -r "$task_file" ]]; then
  write_status "failed" "- Error: task file is missing or unreadable (\`$task_file\`)"
  {
    echo "# Handoff"
    echo
    echo "- Failed: $(timestamp)"
    echo "- Branch: \`$(git rev-parse --abbrev-ref HEAD)\`"
    echo "- Worktree: \`$(pwd)\`"
    echo
    echo "Task file is missing or unreadable: \`$task_file\`"
  } > "$handoff_file"
  exit 1
fi

write_status "running" "- Task file: \`$task_file\`"

# SECURITY: never auto-approve agent tool execution. The worker prompt is built
# from a task file that may contain LLM-generated or third-party content
# (indirect prompt injection). `codex exec -p yolo` would execute
# rm -rf / exfiltration commands without confirmation.
# Default to the most restrictive approval mode; allow an explicit operator
# override only via env (e.g. ECC_CODEX_APPROVAL_MODE=on-request for trusted runs).
# Codex profiles (-p) and approval policies (--ask-for-approval) are
# independent concepts. SECURITY: default to never approving untrusted
# tool execution; operators can override via env.
APPROVAL_POLICY="${ECC_CODEX_APPROVAL_POLICY:-never}"
case "$APPROVAL_POLICY" in
  never|on-request|on-failure) ;;
  *)
    echo "[ECC worker] Refusing to run: unsupported ECC_CODEX_APPROVAL_POLICY='$APPROVAL_POLICY' (expected never|on-request|on-failure)" >&2
    write_status "failed" "- Error: unsupported approval policy"
    exit 1
    ;;
esac

# Contain the task file to the current worktree so a malicious launcher cannot
# point the worker at /etc/passwd or a sibling checkout.
task_real="$(realpath -m "$task_file" 2>/dev/null || readlink -f "$task_file" 2>/dev/null || printf '%s' "$task_file")"
work_real="$(pwd -P 2>/dev/null || pwd)"
case "$task_real" in
  "$work_real"/*) ;;
  *)
    echo "[ECC worker] Refusing to run: task file outside worktree: $task_file" >&2
    write_status "failed" "- Error: task file outside worktree"
    exit 1
    ;;
esac

prompt_file="$(mktemp)"
output_file="$(mktemp)"
cleanup() {
  rm -f "$prompt_file" "$output_file"
}
trap cleanup EXIT

cat > "$prompt_file" <<EOF
You are one worker in an ECC tmux/worktree swarm.

Rules:
- Work only in the current git worktree.
- Do not touch sibling worktrees or the parent repo checkout.
- Complete the task from the task file below.
- Do not spawn subagents or external agents for this task.
- Report progress and final results in stdout only.
- Do not write handoff or status files yourself; the launcher manages those artifacts.
- If you change code or docs, keep the scope narrow and defensible.
- In your final response, include exactly these sections:
  1. Summary
  2. Files Changed
  3. Validation
  4. Remaining Risks

Task file: $task_file

$(cat "$task_file")
EOF

if codex exec --ask-for-approval "$APPROVAL_POLICY" -m gpt-5.4 --color never -C "$(pwd)" -o "$output_file" - < "$prompt_file"; then
  {
    echo "# Handoff"
    echo
    echo "- Completed: $(timestamp)"
    echo "- Branch: \`$(git rev-parse --abbrev-ref HEAD)\`"
    echo "- Worktree: \`$(pwd)\`"
    echo
    cat "$output_file"
    echo
    echo "## Git Status"
    echo
    git status --short
  } > "$handoff_file"
  write_status "completed" "- Handoff file: \`$handoff_file\`"
else
  {
    echo "# Handoff"
    echo
    echo "- Failed: $(timestamp)"
    echo "- Branch: \`$(git rev-parse --abbrev-ref HEAD)\`"
    echo "- Worktree: \`$(pwd)\`"
    echo
    echo "The Codex worker exited with a non-zero status."
  } > "$handoff_file"
  write_status "failed" "- Handoff file: \`$handoff_file\`"
  exit 1
fi
