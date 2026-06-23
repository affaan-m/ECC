#!/bin/bash
# Continuous Learning v2 - Observation Hook
#
# Captures tool use events for pattern analysis.
# Claude Code passes hook data via stdin as JSON.
#
# v2.1: Project-scoped observations — detects current project context
#       and writes observations to project-specific directory.
#
# Registered via plugin hooks/hooks.json (auto-loaded when plugin is enabled).
# Can also be registered manually in ~/.claude/settings.json.

set -e

# Hook phase from CLI argument: "pre" (PreToolUse) or "post" (PostToolUse).
# Manual settings.json installs can call this script without the plugin
# wrapper's positional phase argument, but Claude Code still exposes the hook
# event name in CLAUDE_HOOK_EVENT_NAME.  Fall back to that env var before
# defaulting to post so manually registered PreToolUse hooks are recorded as
# tool_start instead of being silently misclassified as tool_complete.
HOOK_PHASE="${1:-}"
if [ -z "$HOOK_PHASE" ]; then
  case "${CLAUDE_HOOK_EVENT_NAME:-}" in
    PreToolUse|pretooluse|pre_tool_use|pre) HOOK_PHASE="pre" ;;
    PostToolUse|posttooluse|post_tool_use|post) HOOK_PHASE="post" ;;
    *) HOOK_PHASE="post" ;;
  esac
fi

# ─────────────────────────────────────────────
# Read stdin first (before project detection)
# ─────────────────────────────────────────────

# Read JSON from stdin (Claude Code hook format)
INPUT_JSON=$(cat)

# Exit if no input
if [ -z "$INPUT_JSON" ]; then
  exit 0
fi

_is_windows_app_installer_stub() {
  # Windows 10/11 ships an "App Execution Alias" stub at
  #   %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe
  #   %LOCALAPPDATA%\Microsoft\WindowsApps\python3.exe
  # Both are symlinks to AppInstallerPythonRedirector.exe which, when Python
  # is not installed from the Store, neither launches Python nor honors "-c".
  # Calls to it hang or print a bare "Python " line, silently breaking every
  # JSON-parsing step in this hook. Detect and skip such stubs here.
  local _candidate="$1"
  [ -z "$_candidate" ] && return 1
  local _resolved
  _resolved="$(command -v "$_candidate" 2>/dev/null || true)"
  [ -z "$_resolved" ] && return 1
  case "$_resolved" in
    *AppInstallerPythonRedirector.exe|*AppInstallerPythonRedirector.EXE) return 0 ;;
  esac
  # Also resolve one level of symlink on POSIX-like shells (Git Bash, WSL).
  if command -v readlink >/dev/null 2>&1; then
    local _target
    _target="$(readlink -f "$_resolved" 2>/dev/null || readlink "$_resolved" 2>/dev/null || true)"
    case "$_target" in
      *AppInstallerPythonRedirector.exe|*AppInstallerPythonRedirector.EXE) return 0 ;;
    esac
  fi
  return 1
}

resolve_python_cmd() {
  if [ -n "${CLV2_PYTHON_CMD:-}" ] && command -v "$CLV2_PYTHON_CMD" >/dev/null 2>&1; then
    printf '%s\n' "$CLV2_PYTHON_CMD"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1 && ! _is_windows_app_installer_stub python3; then
    printf '%s\n' python3
    return 0
  fi

  if command -v python >/dev/null 2>&1 && ! _is_windows_app_installer_stub python; then
    printf '%s\n' python
    return 0
  fi

  return 1
}

PYTHON_CMD="$(resolve_python_cmd 2>/dev/null || true)"
if [ -z "$PYTHON_CMD" ]; then
  echo "[observe] No python interpreter found, skipping observation" >&2
  exit 0
fi

# Propagate our stub-aware selection so detect-project.sh (which is sourced
# below) does not re-resolve and silently fall back to the App Installer stub.
# detect-project.sh honors an already-set CLV2_PYTHON_CMD.
export CLV2_PYTHON_CMD="${CLV2_PYTHON_CMD:-$PYTHON_CMD}"

# ─────────────────────────────────────────────
# Extract cwd from stdin for project detection
# ─────────────────────────────────────────────

# Extract cwd from the hook JSON to use for project detection.
# If cwd is a subdirectory inside a git repo, resolve it to the repo root so
# observations attach to the project instead of a nested path.
STDIN_CWD=$(echo "$INPUT_JSON" | "$PYTHON_CMD" -c '
import json, sys
try:
    data = json.load(sys.stdin)
    cwd = data.get("cwd", "")
    print(cwd)
except(KeyError, TypeError, ValueError):
    print("")
' 2>/dev/null || echo "")

# If cwd was provided in stdin, use it for project detection
if [ -n "$STDIN_CWD" ] && [ -d "$STDIN_CWD" ]; then
  _GIT_ROOT=$(git -C "$STDIN_CWD" rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$_GIT_ROOT" ]; then
    export CLAUDE_PROJECT_DIR="$_GIT_ROOT"
    unset CLV2_NO_PROJECT
  else
    unset CLAUDE_PROJECT_DIR
    export CLV2_NO_PROJECT=1
  fi
fi

# ─────────────────────────────────────────────
# Lightweight config and automated session guards
# ─────────────────────────────────────────────
#
# IMPORTANT: keep these guards above detect-project.sh.
# Sourcing detect-project.sh creates project-scoped directories and updates
# projects.json, so automated sessions must return before that point.

# shellcheck disable=SC1091
. "$(dirname "$0")/../scripts/lib/homunculus-dir.sh"
CONFIG_DIR="$(_ecc_resolve_homunculus_dir)"

# Skip if disabled (check both default and CLV2_CONFIG-derived locations)
if [ -f "$CONFIG_DIR/disabled" ]; then
  exit 0
fi
if [ -n "${CLV2_CONFIG:-}" ] && [ -f "$(dirname "$CLV2_CONFIG")/disabled" ]; then
  exit 0
fi

# Prevent observe.sh from firing on non-human sessions to avoid:
#   - ECC observing its own Haiku observer sessions (self-loop)
#   - ECC observing other tools' automated sessions
#   - automated sessions creating project-scoped homunculus metadata

# Layer 1: entrypoint. Only interactive terminal sessions should continue.
# sdk-ts: Agent SDK sessions can be human-interactive (e.g. via Happy).
# Non-interactive SDK automation is still filtered by Layers 2-5 below
# (ECC_HOOK_PROFILE=minimal, ECC_SKIP_OBSERVE=1, agent_id, path exclusions).
case "${CLAUDE_CODE_ENTRYPOINT:-cli}" in
  cli|sdk-ts|claude-desktop|claude-vscode) ;;
  *) exit 0 ;;
esac

# Layer 2: minimal hook profile suppresses non-essential hooks.
[ "${ECC_HOOK_PROFILE:-standard}" = "minimal" ] && exit 0

# Layer 3: cooperative skip env var for automated sessions.
[ "${ECC_SKIP_OBSERVE:-0}" = "1" ] && exit 0

# Layer 4: subagent sessions are automated by definition.
_ECC_AGENT_ID=$(echo "$INPUT_JSON" | "$PYTHON_CMD" -c "import json,sys; print(json.load(sys.stdin).get('agent_id',''))" 2>/dev/null || true)
[ -n "$_ECC_AGENT_ID" ] && exit 0

# Layer 5: known observer-session path exclusions.
_ECC_SKIP_PATHS="${ECC_OBSERVE_SKIP_PATHS:-observer-sessions,.claude-mem}"
if [ -n "$STDIN_CWD" ]; then
  IFS=',' read -ra _ECC_SKIP_ARRAY <<< "$_ECC_SKIP_PATHS"
  for _pattern in "${_ECC_SKIP_ARRAY[@]}"; do
    _pattern="${_pattern#"${_pattern%%[![:space:]]*}"}"
    _pattern="${_pattern%"${_pattern##*[![:space:]]}"}"
    [ -z "$_pattern" ] && continue
    case "$STDIN_CWD" in *"$_pattern"*) exit 0 ;; esac
  done
fi

# ─────────────────────────────────────────────
# Project detection
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source shared project detection helper
# This sets: PROJECT_ID, PROJECT_NAME, PROJECT_ROOT, PROJECT_DIR
source "${SKILL_ROOT}/scripts/detect-project.sh"
PYTHON_CMD="${CLV2_PYTHON_CMD:-$PYTHON_CMD}"

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

OBSERVATIONS_FILE="${PROJECT_DIR}/observations.jsonl"
MAX_FILE_SIZE_MB=10

# Auto-purge observation files older than 30 days (runs once per session)
PURGE_MARKER="${PROJECT_DIR}/.last-purge"
if [ ! -f "$PURGE_MARKER" ] || [ "$(find "$PURGE_MARKER" -mtime +1 2>/dev/null)" ]; then
  find "${PROJECT_DIR}" -name "observations-*.jsonl" -mtime +30 -delete 2>/dev/null || true
  touch "$PURGE_MARKER" 2>/dev/null || true
fi

# Parse using Python via stdin pipe (safe for all JSON payloads)
# Pass HOOK_PHASE via env var since Claude Code does not include hook type in stdin JSON
PARSED=$(echo "$INPUT_JSON" | HOOK_PHASE="$HOOK_PHASE" "$PYTHON_CMD" -c '
import json
import sys
import os

try:
    data = json.load(sys.stdin)

    # Determine event type from CLI argument passed via env var.
    # Claude Code does NOT include a "hook_type" field in the stdin JSON,
    # so we rely on the shell argument ("pre" or "post") instead.
    hook_phase = os.environ.get("HOOK_PHASE", "post")
    event = "tool_start" if hook_phase == "pre" else "tool_complete"

    # Extract fields - Claude Code hook format
    tool_name = data.get("tool_name", data.get("tool", "unknown"))
    tool_input = data.get("tool_input", data.get("input", {}))
    tool_output = data.get("tool_response")
    if tool_output is None:
        tool_output = data.get("tool_output", data.get("output", ""))
    session_id = data.get("session_id", "unknown")
    tool_use_id = data.get("tool_use_id", "")
    cwd = data.get("cwd", "")

    # Truncate large inputs/outputs
    if isinstance(tool_input, dict):
        tool_input_str = json.dumps(tool_input)[:5000]
    else:
        tool_input_str = str(tool_input)[:5000]

    if isinstance(tool_output, dict):
        tool_response_str = json.dumps(tool_output)[:5000]
    else:
        tool_response_str = str(tool_output)[:5000]

    print(json.dumps({
        "parsed": True,
        "event": event,
        "tool": tool_name,
        "input": tool_input_str if event == "tool_start" else None,
        "output": tool_response_str if event == "tool_complete" else None,
        "session": session_id,
        "tool_use_id": tool_use_id,
        "cwd": cwd
    }))
except Exception as e:
    print(json.dumps({"parsed": False, "error": str(e)}))
')

# Check if parsing succeeded
PARSED_OK=$(echo "$PARSED" | "$PYTHON_CMD" -c "import json,sys; print(json.load(sys.stdin).get('parsed', False))" 2>/dev/null || echo "False")

if [ "$PARSED_OK" != "True" ]; then
  # Fallback: log raw input for debugging (scrub secrets before persisting)
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  export TIMESTAMP="$timestamp"
  echo "$INPUT_JSON" | "$PYTHON_CMD" -c '
import json, sys, os, re

# Linear-time secret matcher. Bounded quantifiers and a fixed set of auth
# schemes (instead of a generic [A-Za-z]+\s+ that overlapped the value class)
# prevent the catastrophic backtracking that pegged python at 100% CPU (#2278).
_SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|authorization|credentials?|auth)"
    r"""(["'"'"'\s:=]{1,8})"""
    r"((?:bearer|basic|token|bot)\s+)?"
    r"([A-Za-z0-9_\-/.+=]{8,256})"
)

import signal
def _ecc_bail(*_):
    sys.exit(0)
try:
    signal.signal(signal.SIGALRM, _ecc_bail)
    signal.alarm(8)  # self-terminate before the async hook 10s timeout can orphan us (#2278)
except Exception:
    pass

raw = sys.stdin.read()[:2000]
raw = _SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + (m.group(3) or "") + "[REDACTED]", raw)
print(json.dumps({"timestamp": os.environ["TIMESTAMP"], "event": "parse_error", "raw": raw}))
' >> "$OBSERVATIONS_FILE"
  exit 0
fi

# Archive if file too large (atomic: rename with unique suffix to avoid race)
if [ -f "$OBSERVATIONS_FILE" ]; then
  file_size_mb=$(du -m "$OBSERVATIONS_FILE" 2>/dev/null | cut -f1)
  if [ "${file_size_mb:-0}" -ge "$MAX_FILE_SIZE_MB" ]; then
    archive_dir="${PROJECT_DIR}/observations.archive"
    mkdir -p "$archive_dir"
    mv "$OBSERVATIONS_FILE" "$archive_dir/observations-$(date +%Y%m%d-%H%M%S)-$$.jsonl" 2>/dev/null || true
  fi
fi

# Build and write observation (now includes project context)
# Scrub common secret patterns from tool I/O before persisting
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

export PROJECT_ID_ENV="$PROJECT_ID"
export PROJECT_NAME_ENV="$PROJECT_NAME"
export TIMESTAMP="$timestamp"

echo "$PARSED" | "$PYTHON_CMD" -c '
import json, sys, os, re
import signal

def _ecc_bail(*_):
    sys.exit(0)
try:
    signal.signal(signal.SIGALRM, _ecc_bail)
    signal.alarm(8)  # self-terminate before the async hook 10s timeout can orphan us (#2278)
except Exception:
    pass

parsed = json.load(sys.stdin)
observation = {
    "timestamp": os.environ["TIMESTAMP"],
    "event": parsed["event"],
    "tool": parsed["tool"],
    "session": parsed["session"],
    "project_id": os.environ.get("PROJECT_ID_ENV", "global"),
    "project_name": os.environ.get("PROJECT_NAME_ENV", "global")
}

# Scrub secrets: match common key=value, key: value, and key"value patterns
# Includes optional auth scheme (e.g., "Bearer", "Basic") before token
# Linear-time secret matcher. Bounded quantifiers and a fixed set of auth
# schemes (instead of a generic [A-Za-z]+\s+ that overlapped the value class)
# prevent the catastrophic backtracking that pegged python at 100% CPU (#2278).
_SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|authorization|credentials?|auth)"
    r"""(["'"'"'\s:=]{1,8})"""
    r"((?:bearer|basic|token|bot)\s+)?"
    r"([A-Za-z0-9_\-/.+=]{8,256})"
)

def scrub(val):
    if val is None:
        return None
    return _SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + (m.group(3) or "") + "[REDACTED]", str(val))

if parsed["input"]:
    observation["input"] = scrub(parsed["input"])
if parsed["output"] is not None:
    observation["output"] = scrub(parsed["output"])

print(json.dumps(observation))
' >> "$OBSERVATIONS_FILE"

# Lazy-start observer if enabled but not running (first-time setup)
# Use flock for atomic check-then-act to prevent race conditions
# Fallback for macOS (no flock): use lockfile or skip
LAZY_START_LOCK="${PROJECT_DIR}/.observer-start.lock"
_REMOVE_FILE_IF_PRESENT() {
  local target="$1"
  if [ -n "$target" ] && [ -e "$target" ]; then
    rm -- "$target" 2>/dev/null || true
  fi
}

_START_OBSERVER_LOGGED() {
  local bootstrap_log="${PROJECT_DIR}/observer-start.log"
  mkdir -p "$PROJECT_DIR"
  "${SKILL_ROOT}/agents/start-observer.sh" start >> "$bootstrap_log" 2>&1 || true
}

_CHECK_OBSERVER_RUNNING() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null)
    # Validate PID is a positive integer (>1) to prevent signaling invalid targets
    case "$pid" in
      ''|*[!0-9]*|0|1)
        _REMOVE_FILE_IF_PRESENT "$pid_file"
        return 1
        ;;
    esac
    if kill -0 "$pid" 2>/dev/null; then
      return 0  # Process is alive
    fi
    # Stale PID file - remove it
    _REMOVE_FILE_IF_PRESENT "$pid_file"
  fi
  return 1  # No PID file or process dead
}

if [ -f "${CONFIG_DIR}/disabled" ]; then
  OBSERVER_ENABLED=false
else
  OBSERVER_ENABLED=false
  if [ -n "${CLV2_CONFIG:-}" ]; then
    CONFIG_FILE="$CLV2_CONFIG"
  elif [ -f "${CONFIG_DIR}/config.json" ]; then
    CONFIG_FILE="${CONFIG_DIR}/config.json"
  else
    CONFIG_FILE="${SKILL_ROOT}/config.json"
  fi
  # Use effective config path for both existence check and reading
  EFFECTIVE_CONFIG="$CONFIG_FILE"
  if [ -f "$EFFECTIVE_CONFIG" ] && [ -n "$PYTHON_CMD" ]; then
    _enabled=$(CLV2_CONFIG_PATH="$EFFECTIVE_CONFIG" "$PYTHON_CMD" -c "
import json, os
with open(os.environ['CLV2_CONFIG_PATH']) as f:
    cfg = json.load(f)
print(str(cfg.get('observer', {}).get('enabled', False)).lower())
" 2>/dev/null || echo "false")
    if [ "$_enabled" = "true" ]; then
      OBSERVER_ENABLED=true
    fi
  fi
fi

# Check both project-scoped AND global PID files (with stale PID recovery)
if [ "$OBSERVER_ENABLED" = "true" ]; then
  # Clean up stale PID files first
  _CHECK_OBSERVER_RUNNING "${PROJECT_DIR}/.observer.pid" || true
  _CHECK_OBSERVER_RUNNING "${CONFIG_DIR}/.observer.pid" || true

  # Check if observer is now running after cleanup
  if [ ! -f "${PROJECT_DIR}/.observer.pid" ] && [ ! -f "${CONFIG_DIR}/.observer.pid" ]; then
    # Use flock if available (Linux), fallback for macOS
    if command -v flock >/dev/null 2>&1; then
      (
        flock -n 9 || exit 0
        # Double-check PID files after acquiring lock
        _CHECK_OBSERVER_RUNNING "${PROJECT_DIR}/.observer.pid" || true
        _CHECK_OBSERVER_RUNNING "${CONFIG_DIR}/.observer.pid" || true
        if [ ! -f "${PROJECT_DIR}/.observer.pid" ] && [ ! -f "${CONFIG_DIR}/.observer.pid" ]; then
          _START_OBSERVER_LOGGED
        fi
      ) 9>"$LAZY_START_LOCK"
    else
      # macOS fallback: use lockfile if available, otherwise mkdir-based lock
      if command -v lockfile >/dev/null 2>&1; then
        # Use subshell to isolate exit and add trap for cleanup
        (
          trap '_REMOVE_FILE_IF_PRESENT "$LAZY_START_LOCK"' EXIT
          lockfile -r 1 -l 30 "$LAZY_START_LOCK" 2>/dev/null || exit 0
          _CHECK_OBSERVER_RUNNING "${PROJECT_DIR}/.observer.pid" || true
          _CHECK_OBSERVER_RUNNING "${CONFIG_DIR}/.observer.pid" || true
          if [ ! -f "${PROJECT_DIR}/.observer.pid" ] && [ ! -f "${CONFIG_DIR}/.observer.pid" ]; then
            _START_OBSERVER_LOGGED
          fi
          _REMOVE_FILE_IF_PRESENT "$LAZY_START_LOCK"
        )
      else
        # POSIX fallback: mkdir is atomic -- fails if dir already exists
        (
          trap 'rmdir "${LAZY_START_LOCK}.d" 2>/dev/null || true' EXIT
          mkdir "${LAZY_START_LOCK}.d" 2>/dev/null || exit 0
          _CHECK_OBSERVER_RUNNING "${PROJECT_DIR}/.observer.pid" || true
          _CHECK_OBSERVER_RUNNING "${CONFIG_DIR}/.observer.pid" || true
          if [ ! -f "${PROJECT_DIR}/.observer.pid" ] && [ ! -f "${CONFIG_DIR}/.observer.pid" ]; then
            _START_OBSERVER_LOGGED
          fi
        )
      fi
    fi
  fi
fi

# Throttle SIGUSR1: only signal observer every N observations (#521)
# This prevents rapid signaling when tool calls fire every second,
# which caused runaway parallel Claude analysis processes.
SIGNAL_EVERY_N="${ECC_OBSERVER_SIGNAL_EVERY_N:-20}"
SIGNAL_COUNTER_FILE="${PROJECT_DIR}/.observer-signal-counter"
ACTIVITY_FILE="${PROJECT_DIR}/.observer-last-activity"

touch "$ACTIVITY_FILE" 2>/dev/null || true

should_signal=0
if [ -f "$SIGNAL_COUNTER_FILE" ]; then
  counter=$(cat "$SIGNAL_COUNTER_FILE" 2>/dev/null || echo 0)
  counter=$((counter + 1))
  if [ "$counter" -ge "$SIGNAL_EVERY_N" ]; then
    should_signal=1
    counter=0
  fi
  echo "$counter" > "$SIGNAL_COUNTER_FILE"
else
  echo "1" > "$SIGNAL_COUNTER_FILE"
fi

# Signal observer if running and throttle allows (check both project-scoped and global observer, deduplicate)
if [ "$should_signal" -eq 1 ]; then
  signaled_pids=" "
  for pid_file in "${PROJECT_DIR}/.observer.pid" "${CONFIG_DIR}/.observer.pid"; do
    if [ -f "$pid_file" ]; then
      observer_pid=$(cat "$pid_file" 2>/dev/null || true)
      # Validate PID is a positive integer (>1)
      case "$observer_pid" in
        ''|*[!0-9]*|0|1)
          _REMOVE_FILE_IF_PRESENT "$pid_file"
          continue
          ;;
      esac
      # Deduplicate: skip if already signaled this pass
      case "$signaled_pids" in
        *" $observer_pid "*) continue ;;
      esac
      if kill -0 "$observer_pid" 2>/dev/null; then
        kill -USR1 "$observer_pid" 2>/dev/null || true
        signaled_pids="${signaled_pids}${observer_pid} "
      fi
    fi
  done
fi

exit 0
