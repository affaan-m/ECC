#!/usr/bin/env bash
# session-guardian.sh — Observer session guard
# Exit 0 = proceed. Exit 1 = skip this observer cycle.
# Called by observer-loop.sh before spawning any Claude session.
#
# Config (env vars, all optional):
#   OBSERVER_INTERVAL_SECONDS    default: 300   (per-project cooldown)
#   OBSERVER_LAST_RUN_LOG        default: ~/.claude/observer-last-run.log
#   OBSERVER_ACTIVE_HOURS_START  default: 800   (8:00 AM local, set to 0 to disable)
#   OBSERVER_ACTIVE_HOURS_END    default: 2300  (11:00 PM local, set to 0 to disable)
#   OBSERVER_MAX_IDLE_SECONDS    default: 1800  (30 min; set to 0 to disable)
#
# Gate execution order (cheapest first):
#   Gate 1: Time window check    (~0ms, string comparison)
#   Gate 2: Project cooldown log (~1ms, file read + mkdir lock)
#   Gate 3: Idle detection       (~5-50ms, OS syscall; fail open)

set -euo pipefail

INTERVAL="${OBSERVER_INTERVAL_SECONDS:-300}"
LOG_PATH="${OBSERVER_LAST_RUN_LOG:-$HOME/.claude/observer-last-run.log}"
ACTIVE_START="${OBSERVER_ACTIVE_HOURS_START:-800}"
ACTIVE_END="${OBSERVER_ACTIVE_HOURS_END:-2300}"
MAX_IDLE="${OBSERVER_MAX_IDLE_SECONDS:-1800}"

# ── Gate 1: Time Window ───────────────────────────────────────────────────────
# Skip observer cycles outside configured active hours (local system time).
# Uses HHMM integer comparison. Works on BSD date (macOS) and GNU date (Linux).
# Supports overnight windows such as 2200-0600.
# Set both ACTIVE_START and ACTIVE_END to 0 to disable this gate.
if [ "$ACTIVE_START" -ne 0 ] || [ "$ACTIVE_END" -ne 0 ]; then
  current_hhmm=$(date +%k%M | tr -d ' ')
  current_hhmm_num=$(( 10#${current_hhmm:-0} ))
  active_start_num=$(( 10#${ACTIVE_START:-800} ))
  active_end_num=$(( 10#${ACTIVE_END:-2300} ))

  within_active_hours=0
  if [ "$active_start_num" -lt "$active_end_num" ]; then
    if [ "$current_hhmm_num" -ge "$active_start_num" ] && [ "$current_hhmm_num" -lt "$active_end_num" ]; then
      within_active_hours=1
    fi
  else
    if [ "$current_hhmm_num" -ge "$active_start_num" ] || [ "$current_hhmm_num" -lt "$active_end_num" ]; then
      within_active_hours=1
    fi
  fi

  if [ "$within_active_hours" -ne 1 ]; then
    echo "session-guardian: outside active hours (${current_hhmm}, window ${ACTIVE_START}-${ACTIVE_END})" >&2
    exit 1
  fi
fi

# ── Gate 2: Project Cooldown Log ─────────────────────────────────────────────
# Prevent the same project being observed faster than OBSERVER_INTERVAL_SECONDS.
# Key: PROJECT_DIR when provided by the observer, otherwise git root path.
# Uses mkdir-based lock for safe concurrent access. Skips the cycle on lock contention.
# stderr uses basename only — never prints the full absolute path.

project_root="${PROJECT_DIR:-}"
if [ -z "$project_root" ] || [ ! -d "$project_root" ]; then
  project_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
fi
project_name="$(basename "$project_root")"
now="$(date +%s)"

mkdir -p "$(dirname "$LOG_PATH")" || {
  echo "session-guardian: cannot create log dir, proceeding" >&2
  exit 0
}

_lock_dir="${LOG_PATH}.lock"
if ! mkdir "$_lock_dir" 2>/dev/null; then
  # Another observer holds the lock — skip this cycle to avoid double-spawns
  echo "session-guardian: log locked by concurrent process, skipping cycle" >&2
  exit 1
else
  trap 'rm -rf "$_lock_dir"' EXIT INT TERM

  last_spawn=0
  last_spawn=$(awk -F '\t' -v key="$project_root" '$1 == key { value = $2 } END { if (value != "") print value }' "$LOG_PATH" 2>/dev/null) || true
  last_spawn="${last_spawn:-0}"
  [[ "$last_spawn" =~ ^[0-9]+$ ]] || last_spawn=0

  elapsed=$(( now - last_spawn ))
  if [ "$elapsed" -lt "$INTERVAL" ]; then
    rm -rf "$_lock_dir"
    trap - EXIT INT TERM
    echo "session-guardian: cooldown active for '${project_name}' (last spawn ${elapsed}s ago, interval ${INTERVAL}s)" >&2
    exit 1
  fi

  # Update log: remove old entry for this project, append new timestamp (tab-delimited)
  tmp_log="$(mktemp "$(dirname "$LOG_PATH")/observer-last-run.XXXXXX")"
  awk -F '\t' -v key="$project_root" '$1 != key' "$LOG_PATH" > "$tmp_log" 2>/dev/null || true
  printf '%s\t%s\n' "$project_root" "$now" >> "$tmp_log"
  mv "$tmp_log" "$LOG_PATH"

  rm -rf "$_lock_dir"
  trap - EXIT INT TERM
fi

# ── Gate 3: Idle Detection ────────────────────────────────────────────────────
# Skip cycles when no user input received for too long. Fail open if idle time
# cannot be determined (Linux without xprintidle, headless, unknown OS).
# Set OBSERVER_MAX_IDLE_SECONDS=0 to disable this gate.

get_idle_seconds() {
  local _raw
  case "$(uname -s)" in
    Darwin)
      _raw=$( { /usr/sbin/ioreg -c IOHIDSystem \
        | /usr/bin/awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'; } \
        2>/dev/null ) || true
      printf '%s\n' "${_raw:-0}" | head -n1
      ;;
    Linux)
      if command -v xprintidle >/dev/null 2>&1; then
        _raw=$(xprintidle 2>/dev/null) || true
        echo $(( ${_raw:-0} / 1000 ))
      else
        echo 0  # fail open: xprintidle not installed
      fi
      ;;
    *MINGW*|*MSYS*|*CYGWIN*)
      _raw=$(powershell.exe -NoProfile -NonInteractive -Command \
        "try { \
          Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public int dwTime; }' -Name WinAPI -Namespace PInvoke; \
          \$l = New-Object PInvoke.WinAPI+LASTINPUTINFO; \$l.cbSize = 8; \
          [PInvoke.WinAPI]::GetLastInputInfo([ref]\$l) | Out-Null; \
          [int][Math]::Max(0, [long]([Environment]::TickCount - [long]\$l.dwTime) / 1000) \
        } catch { 0 }" \
        2>/dev/null | tr -d '\r') || true
      printf '%s\n' "${_raw:-0}" | head -n1
      ;;
    *)
      echo 0  # fail open: unknown platform
      ;;
  esac
}

if [ "$MAX_IDLE" -gt 0 ]; then
  idle_seconds=$(get_idle_seconds)
  if [ "$idle_seconds" -gt "$MAX_IDLE" ]; then
    echo "session-guardian: user idle ${idle_seconds}s (threshold ${MAX_IDLE}s), skipping" >&2
    exit 1
  fi
fi

exit 0
