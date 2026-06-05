#!/usr/bin/env bash
# Continuous Learning v2 - Observer background loop
#
# Fix for #521: Added re-entrancy guard, cooldown throttle, and
# tail-based sampling to prevent memory explosion from runaway
# parallel Claude analysis processes.

set +e
unset CLAUDECODE

SLEEP_PID=""
USR1_FIRED=0
PENDING_ANALYSIS=0
ANALYZING=0
LAST_ANALYSIS_EPOCH=0
# Minimum seconds between analyses (prevents rapid re-triggering)
ANALYSIS_COOLDOWN="${ECC_OBSERVER_ANALYSIS_COOLDOWN:-60}"
IDLE_TIMEOUT_SECONDS="${ECC_OBSERVER_IDLE_TIMEOUT_SECONDS:-1800}"
SESSION_LEASE_DIR="${PROJECT_DIR}/.observer-sessions"
ACTIVITY_FILE="${PROJECT_DIR}/.observer-last-activity"

cleanup() {
  [ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null
  if [ -f "$PID_FILE" ] && [ "$(cat "$PID_FILE" 2>/dev/null)" = "$$" ]; then
    rm -f "$PID_FILE"
  fi
  exit 0
}
trap cleanup TERM INT

file_mtime_epoch() {
  local file="$1"
  if [ ! -f "$file" ]; then
    printf '0\n'
    return
  fi

  if stat -c %Y "$file" >/dev/null 2>&1; then
    stat -c %Y "$file" 2>/dev/null || printf '0\n'
    return
  fi

  if stat -f %m "$file" >/dev/null 2>&1; then
    stat -f %m "$file" 2>/dev/null || printf '0\n'
    return
  fi

  printf '0\n'
}

has_active_session_leases() {
  if [ ! -d "$SESSION_LEASE_DIR" ]; then
    return 1
  fi

  find "$SESSION_LEASE_DIR" -type f -name '*.json' -print -quit 2>/dev/null | grep -q .
}

latest_activity_epoch() {
  local observations_epoch activity_epoch
  observations_epoch="$(file_mtime_epoch "$OBSERVATIONS_FILE")"
  activity_epoch="$(file_mtime_epoch "$ACTIVITY_FILE")"

  if [ "$activity_epoch" -gt "$observations_epoch" ] 2>/dev/null; then
    printf '%s\n' "$activity_epoch"
  else
    printf '%s\n' "$observations_epoch"
  fi
}

exit_if_idle_without_sessions() {
  if has_active_session_leases; then
    return
  fi

  local last_activity now_epoch idle_for
  last_activity="$(latest_activity_epoch)"
  now_epoch="$(date +%s)"
  idle_for=$(( now_epoch - last_activity ))

  if [ "$last_activity" -eq 0 ] || [ "$idle_for" -ge "$IDLE_TIMEOUT_SECONDS" ]; then
    echo "[$(date)] Observer idle without active session leases for ${idle_for}s; exiting" >> "$LOG_FILE"
    cleanup
  fi
}

wait_for_claude_analysis() {
  local child_pid="$1"
  local wait_status=0

  while true; do
    wait "$child_pid"
    wait_status=$?

    if [ "$wait_status" -eq 0 ]; then
      return 0
    fi

    # SIGUSR1 can interrupt wait while the Claude child is still running.
    # Re-wait in that case so a signal is not logged as a false child failure.
    if kill -0 "$child_pid" 2>/dev/null; then
      continue
    fi

    return "$wait_status"
  done
}

analyze_observations() {
  if [ ! -f "$OBSERVATIONS_FILE" ]; then
    return
  fi

  obs_count=$(wc -l < "$OBSERVATIONS_FILE" 2>/dev/null || echo 0)
  if [ "$obs_count" -lt "$MIN_OBSERVATIONS" ]; then
    return
  fi

  echo "[$(date)] Analyzing $obs_count observations for project ${PROJECT_NAME}..." >> "$LOG_FILE"

  if [ "${CLV2_IS_WINDOWS:-false}" = "true" ] && [ "${ECC_OBSERVER_ALLOW_WINDOWS:-false}" != "true" ]; then
    echo "[$(date)] Skipping claude analysis on Windows due to known non-interactive hang issue (#295). Set ECC_OBSERVER_ALLOW_WINDOWS=true to override." >> "$LOG_FILE"
    return
  fi

  if ! command -v claude >/dev/null 2>&1; then
    echo "[$(date)] claude CLI not found, skipping analysis" >> "$LOG_FILE"
    return
  fi

  # session-guardian: gate observer cycle (active hours, cooldown, idle detection)
  if ! bash "$(dirname "$0")/session-guardian.sh"; then
    echo "[$(date)] Observer cycle skipped by session-guardian" >> "$LOG_FILE"
    return
  fi

  # Sample recent observations instead of loading the entire file (#521).
  # This prevents multi-MB payloads from being passed to the LLM.
  MAX_ANALYSIS_LINES="${ECC_OBSERVER_MAX_ANALYSIS_LINES:-500}"
  observer_tmp_dir="${PROJECT_DIR}/.observer-tmp"
  mkdir -p "$observer_tmp_dir"
  analysis_file="$(mktemp "${observer_tmp_dir}/ecc-observer-analysis.XXXXXX.jsonl")"
  tail -n "$MAX_ANALYSIS_LINES" "$OBSERVATIONS_FILE" > "$analysis_file"
  analysis_count=$(wc -l < "$analysis_file" 2>/dev/null || echo 0)
  echo "[$(date)] Using last $analysis_count of $obs_count observations for analysis" >> "$LOG_FILE"

  # Use relative path from PROJECT_DIR for cross-platform compatibility (#842).
  # On Windows (Git Bash/MSYS2), absolute paths from mktemp may use MSYS-style
  # prefixes (e.g. /c/Users/...) that the Claude subprocess cannot resolve.
  analysis_relpath=".observer-tmp/$(basename "$analysis_file")"

  prompt_file="$(mktemp "${observer_tmp_dir}/ecc-observer-prompt.XXXXXX")"
  cat > "$prompt_file" <<PROMPT
IMPORTANT: You are running in non-interactive --print mode. You MUST use the Write tool directly to create files. Do NOT ask for permission, do NOT ask for confirmation, do NOT output summaries instead of writing. Just read, analyze, and write.

Read ${analysis_relpath} and identify patterns for the project ${PROJECT_NAME} (user corrections, error resolutions, repeated workflows, tool preferences).
If you find 3+ occurrences of the same pattern, you MUST write an instinct file directly to ${INSTINCTS_DIR}/<id>.md using the Write tool.
Do NOT ask for permission to write files, do NOT describe what you would write, and do NOT stop at analysis when a qualifying pattern exists.

CRITICAL: Every instinct file MUST use this exact format:

---
id: kebab-case-name
trigger: when <specific condition>
confidence: <0.3-0.85 based on frequency: 3-5 times=0.5, 6-10=0.7, 11+=0.85>
domain: <one of: code-style, testing, git, debugging, workflow, file-patterns>
source: session-observation
scope: project
project_id: ${PROJECT_ID}
project_name: ${PROJECT_NAME}
---

# Title

## Action
<what to do, one clear sentence>

## Evidence
- Observed N times in session <id>
- Pattern: <description>
- Last observed: <date>

Rules:
- Be conservative, only clear patterns with 3+ observations
- Use narrow, specific triggers
- Never include actual code snippets, only describe patterns
- When a qualifying pattern exists, write or update the instinct file in this run instead of asking for confirmation
- If a similar instinct already exists in ${INSTINCTS_DIR}/, update it instead of creating a duplicate
- The YAML frontmatter (between --- markers) with id field is MANDATORY
- If a pattern seems universal (not project-specific), set scope to global instead of project
- Examples of global patterns: always validate user input, prefer explicit error handling
- Examples of project patterns: use React functional components, follow Django REST framework conventions
PROMPT

  # Read the prompt into memory before the Claude subprocess is spawned.
  # On Windows/MSYS2, the mktemp path can differ from the shell's later path
  # resolution, so relying on cat "$prompt_file" inside the claude invocation
  # can fail even though the file was created successfully.
  prompt_content="$(cat "$prompt_file" 2>/dev/null || true)"
  rm -f "$prompt_file"
  if [ -z "$prompt_content" ]; then
    echo "[$(date)] Failed to load observer prompt content, skipping analysis" >> "$LOG_FILE"
    rm -f "$analysis_file"
    return
  fi

  timeout_seconds="${ECC_OBSERVER_TIMEOUT_SECONDS:-120}"
  max_turns="${ECC_OBSERVER_MAX_TURNS:-20}"
  exit_code=0

  case "$max_turns" in
    ''|*[!0-9]*)
      max_turns=20
      ;;
  esac

  if [ "$max_turns" -lt 4 ]; then
    max_turns=20
  fi

  # Ensure CWD is PROJECT_DIR so the relative analysis_relpath resolves correctly
  # on all platforms, not just when the observer happens to be launched from the project root.
  cd "$PROJECT_DIR" || { echo "[$(date)] Failed to cd to PROJECT_DIR ($PROJECT_DIR), skipping analysis" >> "$LOG_FILE"; rm -f "$analysis_file"; return; }

  # Prevent observe.sh from recording this automated Haiku session as observations.
  # Pass prompt via -p flag instead of stdin redirect for Windows compatibility (#842).
  # prompt_content is already loaded in-memory so this no longer depends on the
  # mktemp absolute path continuing to resolve after cwd changes (#1296).
  ECC_SKIP_OBSERVE=1 ECC_HOOK_PROFILE=minimal claude --model haiku --max-turns "$max_turns" --print \
    --allowedTools "Read,Write" \
    -p "$prompt_content" >> "$LOG_FILE" 2>&1 &
  claude_pid=$!

  (
    sleep "$timeout_seconds"
    if kill -0 "$claude_pid" 2>/dev/null; then
      echo "[$(date)] Claude analysis timed out after ${timeout_seconds}s; terminating process" >> "$LOG_FILE"
      kill "$claude_pid" 2>/dev/null || true
    fi
  ) &
  watchdog_pid=$!

  wait_for_claude_analysis "$claude_pid"
  exit_code=$?
  kill "$watchdog_pid" 2>/dev/null || true
  rm -f "$analysis_file"

  if [ "$exit_code" -ne 0 ]; then
    echo "[$(date)] Claude analysis failed (exit $exit_code)" >> "$LOG_FILE"
  fi

  if [ -f "$OBSERVATIONS_FILE" ]; then
    archive_dir="${PROJECT_DIR}/observations.archive"
    mkdir -p "$archive_dir"
    mv "$OBSERVATIONS_FILE" "$archive_dir/processed-$(date +%Y%m%d-%H%M%S)-$$.jsonl" 2>/dev/null || true
  fi
}

on_usr1() {
  [ -n "$SLEEP_PID" ] && kill "$SLEEP_PID" 2>/dev/null
  SLEEP_PID=""

  # Re-entrancy guard: defer the nudge so the main loop runs a follow-up
  # analysis immediately after the current analysis finishes.
  if [ "$ANALYZING" -eq 1 ]; then
    PENDING_ANALYSIS=1
    echo "[$(date)] Analysis already in progress, deferring signal" >> "$LOG_FILE"
    return
  fi

  USR1_FIRED=1

  # Cooldown: skip if last analysis was too recent (#521)
  now_epoch=$(date +%s)
  elapsed=$(( now_epoch - LAST_ANALYSIS_EPOCH ))
  if [ "$elapsed" -lt "$ANALYSIS_COOLDOWN" ]; then
    echo "[$(date)] Analysis cooldown active (${elapsed}s < ${ANALYSIS_COOLDOWN}s), skipping" >> "$LOG_FILE"
    return
  fi

  ANALYZING=1
  analyze_observations
  LAST_ANALYSIS_EPOCH=$(date +%s)
  ANALYZING=0
}
trap on_usr1 USR1

echo "$$" > "$PID_FILE"
echo "[$(date)] Observer started for ${PROJECT_NAME} (PID: $$)" >> "$LOG_FILE"

# Prune expired pending instincts before analysis
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"${CLV2_PYTHON_CMD:-python3}" "${SCRIPT_DIR}/../scripts/instinct-cli.py" prune --quiet >> "$LOG_FILE" 2>&1 || echo "[$(date)] Warning: instinct prune failed (non-fatal)" >> "$LOG_FILE"

while true; do
  exit_if_idle_without_sessions

  if [ "$PENDING_ANALYSIS" -eq 1 ]; then
    PENDING_ANALYSIS=0
    USR1_FIRED=0
    ANALYZING=1
    analyze_observations
    LAST_ANALYSIS_EPOCH=$(date +%s)
    ANALYZING=0
    continue
  fi

  sleep "$OBSERVER_INTERVAL_SECONDS" &
  SLEEP_PID=$!
  wait "$SLEEP_PID" 2>/dev/null
  SLEEP_PID=""

  exit_if_idle_without_sessions
  if [ "$USR1_FIRED" -eq 1 ]; then
    USR1_FIRED=0
  else
    ANALYZING=1
    analyze_observations
    LAST_ANALYSIS_EPOCH=$(date +%s)
    ANALYZING=0
  fi
done
