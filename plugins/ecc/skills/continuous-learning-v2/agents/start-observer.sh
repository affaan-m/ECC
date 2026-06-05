#!/bin/bash
# Continuous Learning v2 - Observer Agent Launcher
#
# Starts the background observer agent that analyzes observations
# and creates instincts. Uses Haiku model for cost efficiency.
#
# v2.1: Project-scoped — detects current project and analyzes
#       project-specific observations into project-scoped instincts.
#
# Usage:
#   start-observer.sh              # Start observer for current project (or global)
#   start-observer.sh --reset      # Clear lock and restart observer for current project
#   start-observer.sh stop         # Stop running observer
#   start-observer.sh status       # Check if observer is running

set -e

# NOTE: set -e is disabled inside the background subshell below
# to prevent claude CLI failures from killing the observer loop.

# ─────────────────────────────────────────────
# Project detection
# ─────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OBSERVER_LOOP_SCRIPT="${SCRIPT_DIR}/observer-loop.sh"

# Source shared project detection helper
# This sets: PROJECT_ID, PROJECT_NAME, PROJECT_ROOT, PROJECT_DIR
source "${SKILL_ROOT}/scripts/detect-project.sh"
PYTHON_CMD="${CLV2_PYTHON_CMD:-}"

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

# shellcheck disable=SC1091
. "${SKILL_ROOT}/scripts/lib/homunculus-dir.sh"
CONFIG_DIR="$(_ecc_resolve_homunculus_dir)"
if [ -n "${CLV2_CONFIG:-}" ]; then
  CONFIG_FILE="$CLV2_CONFIG"
elif [ -f "${CONFIG_DIR}/config.json" ]; then
  CONFIG_FILE="${CONFIG_DIR}/config.json"
else
  CONFIG_FILE="${SKILL_ROOT}/config.json"
fi
# PID file is project-scoped so each project can have its own observer
PID_FILE="${PROJECT_DIR}/.observer.pid"
LOG_FILE="${PROJECT_DIR}/observer.log"
OBSERVATIONS_FILE="${PROJECT_DIR}/observations.jsonl"
INSTINCTS_DIR="${PROJECT_DIR}/instincts/personal"
SENTINEL_FILE="${CLV2_OBSERVER_SENTINEL_FILE:-${PROJECT_ROOT:-$PROJECT_DIR}/.observer.lock}"

write_guard_sentinel() {
  printf '%s\n' 'observer paused: confirmation or permission prompt detected; rerun start-observer.sh --reset after reviewing observer.log' > "$SENTINEL_FILE"
}

stop_observer_if_running() {
  if [ -f "$PID_FILE" ]; then
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping observer for ${PROJECT_NAME} (PID: $pid)..."
      kill "$pid"
      rm -f "$PID_FILE"
      echo "Observer stopped."
      return 0
    fi

    echo "Observer not running (stale PID file)."
    rm -f "$PID_FILE"
    return 1
  fi

  echo "Observer not running."
  return 1
}

# Read config values from config.json
OBSERVER_INTERVAL_MINUTES=5
MIN_OBSERVATIONS=20
OBSERVER_ENABLED=false
if [ -f "$CONFIG_FILE" ]; then
  if [ -z "$PYTHON_CMD" ]; then
    echo "No python interpreter found; using built-in observer defaults." >&2
  else
    _config=$(CLV2_CONFIG="$CONFIG_FILE" "$PYTHON_CMD" -c "
import json, os
with open(os.environ['CLV2_CONFIG']) as f:
    cfg = json.load(f)
obs = cfg.get('observer', {})
print(obs.get('run_interval_minutes', 5))
print(obs.get('min_observations_to_analyze', 20))
print(str(obs.get('enabled', False)).lower())
" 2>/dev/null || echo "5
20
false")
    _interval=$(echo "$_config" | sed -n '1p')
    _min_obs=$(echo "$_config" | sed -n '2p')
    _enabled=$(echo "$_config" | sed -n '3p')
    if [ "$_interval" -gt 0 ] 2>/dev/null; then
      OBSERVER_INTERVAL_MINUTES="$_interval"
    fi
    if [ "$_min_obs" -gt 0 ] 2>/dev/null; then
      MIN_OBSERVATIONS="$_min_obs"
    fi
    if [ "$_enabled" = "true" ]; then
      OBSERVER_ENABLED=true
    fi
  fi
fi
OBSERVER_INTERVAL_SECONDS=$((OBSERVER_INTERVAL_MINUTES * 60))

echo "Project: ${PROJECT_NAME} (${PROJECT_ID})"
echo "Storage: ${PROJECT_DIR}"

# Windows/Git-Bash detection (Issue #295)
UNAME_LOWER="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
IS_WINDOWS=false
case "$UNAME_LOWER" in
  *mingw*|*msys*|*cygwin*) IS_WINDOWS=true ;;
esac

ACTION="start"
RESET_OBSERVER=false

for arg in "$@"; do
  case "$arg" in
    start|stop|status)
      ACTION="$arg"
      ;;
    --reset)
      RESET_OBSERVER=true
      ;;
    *)
      echo "Usage: $0 [start|stop|status] [--reset]"
      exit 1
      ;;
  esac
done

if [ "$RESET_OBSERVER" = "true" ]; then
  rm -f "$SENTINEL_FILE"
fi

case "$ACTION" in
  stop)
    stop_observer_if_running || true
    exit 0
    ;;

  status)
    if [ -f "$PID_FILE" ]; then
      pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        echo "Observer is running (PID: $pid)"
        echo "Log: $LOG_FILE"
        echo "Observations: $(wc -l < "$OBSERVATIONS_FILE" 2>/dev/null || echo 0) lines"
        # Also show instinct count
        instinct_count=$(find "$INSTINCTS_DIR" -name "*.yaml" 2>/dev/null | wc -l)
        echo "Instincts: $instinct_count"
        exit 0
      else
        echo "Observer not running (stale PID file)"
        rm -f "$PID_FILE"
        exit 1
      fi
    else
      echo "Observer not running"
      exit 1
    fi
    ;;

  start)
    # Check if observer is disabled in config
    if [ "$OBSERVER_ENABLED" != "true" ]; then
      echo "Observer is disabled in config.json (observer.enabled: false)."
      echo "Set observer.enabled to true in config.json to enable."
      exit 1
    fi

    # Check if already running
    if [ -f "$PID_FILE" ]; then
      pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        echo "Observer already running for ${PROJECT_NAME} (PID: $pid)"
        exit 0
      fi
      rm -f "$PID_FILE"
    fi

    echo "Starting observer agent for ${PROJECT_NAME}..."

    if [ ! -x "$OBSERVER_LOOP_SCRIPT" ]; then
      echo "Observer loop script not found or not executable: $OBSERVER_LOOP_SCRIPT"
      exit 1
    fi

    mkdir -p "$PROJECT_DIR"
    touch "$LOG_FILE"
    start_line=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)

    nohup env \
      CONFIG_DIR="$CONFIG_DIR" \
      PID_FILE="$PID_FILE" \
      LOG_FILE="$LOG_FILE" \
      OBSERVATIONS_FILE="$OBSERVATIONS_FILE" \
      INSTINCTS_DIR="$INSTINCTS_DIR" \
      PROJECT_DIR="$PROJECT_DIR" \
      PROJECT_NAME="$PROJECT_NAME" \
      PROJECT_ID="$PROJECT_ID" \
      MIN_OBSERVATIONS="$MIN_OBSERVATIONS" \
      OBSERVER_INTERVAL_SECONDS="$OBSERVER_INTERVAL_SECONDS" \
      CLV2_IS_WINDOWS="$IS_WINDOWS" \
      CLV2_OBSERVER_PROMPT_PATTERN="$CLV2_OBSERVER_PROMPT_PATTERN" \
      "$OBSERVER_LOOP_SCRIPT" >> "$LOG_FILE" 2>&1 &

    # Wait for PID file
    sleep 2

    # Check for confirmation-seeking output in the observer log
    if tail -n +"$((start_line + 1))" "$LOG_FILE" 2>/dev/null | grep -E -i -q "$CLV2_OBSERVER_PROMPT_PATTERN"; then
      echo "OBSERVER_ABORT: Confirmation or permission prompt detected in observer output. Failing closed."
      stop_observer_if_running >/dev/null 2>&1 || true
      write_guard_sentinel
      exit 2
    fi

    if [ -f "$PID_FILE" ]; then
      pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        echo "Observer started (PID: $pid)"
        echo "Log: $LOG_FILE"
      else
        echo "Failed to start observer (process died immediately, check $LOG_FILE)"
        exit 1
      fi
    else
      echo "Failed to start observer"
      exit 1
    fi
    ;;

  *)
    echo "Usage: $0 [start|stop|status] [--reset]"
    exit 1
    ;;
esac
