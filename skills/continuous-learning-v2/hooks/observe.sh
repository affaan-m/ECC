#!/usr/bin/env bash
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

# ─────────────────────────────────────────────
# Script location
# ─────────────────────────────────────────────
#
# This hook runs before and after every tool call. Each external command is a
# process launch: a few milliseconds on Linux/macOS, but 80-280 ms under Git
# Bash on Windows, where ~50 launches per run added up to several seconds. The
# hot path therefore uses parameter expansion and shell builtins wherever an
# external command is not required, and batches the Python work into as few
# interpreter starts as possible.
# Git Bash may be handed a Windows path (C:\...\observe.sh); dirname accepted
# both separators there, so normalize before splitting.
_CLV2_SELF="$0"
case "${OSTYPE:-}" in
  msys*|cygwin*|win32*) _CLV2_SELF="${_CLV2_SELF//\\//}" ;;
esac
case "$_CLV2_SELF" in
  */*) SCRIPT_DIR="${_CLV2_SELF%/*}" ;;
  *) SCRIPT_DIR="." ;;
esac
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─────────────────────────────────────────────
# Lightweight config and automated session guards
# ─────────────────────────────────────────────
#
# IMPORTANT: keep these guards above detect-project.sh.
# Sourcing detect-project.sh creates project-scoped directories and updates
# projects.json, so automated sessions must return before that point.
#
# The guards that need nothing from stdin also run before the first interpreter
# start, so a disabled or skipped session costs no Python or git launch.

# shellcheck disable=SC1091
. "${SCRIPT_DIR}/../scripts/lib/homunculus-dir.sh"
CONFIG_DIR="$(_clv2_resolve_homunculus_dir)"

# Skip if disabled (check both default and CLV2_CONFIG-derived locations)
if [ -f "$CONFIG_DIR/disabled" ]; then
  exit 0
fi
if [ -n "${CLV2_CONFIG:-}" ]; then
  # As with $0 above: Git Bash may be given C:\...\config.json.
  _CLV2_CONFIG_PATH_NORM="$CLV2_CONFIG"
  case "${OSTYPE:-}" in
    msys*|cygwin*|win32*) _CLV2_CONFIG_PATH_NORM="${_CLV2_CONFIG_PATH_NORM//\\//}" ;;
  esac
  case "$_CLV2_CONFIG_PATH_NORM" in
    */*) _CLV2_CONFIG_PARENT="${_CLV2_CONFIG_PATH_NORM%/*}" ;;
    *) _CLV2_CONFIG_PARENT="." ;;
  esac
  if [ -f "${_CLV2_CONFIG_PARENT:-/}/disabled" ]; then
    exit 0
  fi
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
  cli|sdk-ts|sdk-cli|claude-desktop|claude-vscode) ;;
  *) exit 0 ;;
esac

# Layer 2: minimal hook profile suppresses non-essential hooks.
[ "${ECC_HOOK_PROFILE:-standard}" = "minimal" ] && exit 0

# Layer 3: cooperative skip env var for automated sessions.
[ "${ECC_SKIP_OBSERVE:-0}" = "1" ] && exit 0

# ─────────────────────────────────────────────
# Python interpreter
# ─────────────────────────────────────────────

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
  local _resolved=""
  # hash + BASH_CMDS yields the resolved path without a command-substitution
  # subshell (bash >= 4). Older shells fall through to `command -v`.
  if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ] && hash "$_candidate" 2>/dev/null; then
    _resolved="${BASH_CMDS[$_candidate]:-}"
  fi
  if [ -z "$_resolved" ]; then
    _resolved="$(command -v "$_candidate" 2>/dev/null || true)"
  fi
  [ -z "$_resolved" ] && return 1
  case "$_resolved" in
    *AppInstallerPythonRedirector.exe|*AppInstallerPythonRedirector.EXE) return 0 ;;
  esac
  # The alias stubs live under ...\Microsoft\WindowsApps\, so a candidate
  # resolved there always has its link followed. Anywhere else only a symbolic
  # link can lead to the stub, and only where Windows programs can run at all
  # (Git Bash, Cygwin, WSL). Both checks are builtins, so an ordinary file, and
  # any python3 on plain Linux or macOS (usually a symlink), costs no readlink
  # launch on every tool call.
  case "$_resolved" in
    */[Ww]indows[Aa]pps/*) ;;
    *)
      [ -L "$_resolved" ] || return 1
      case "${OSTYPE:-}" in
        msys*|cygwin*|win32*) ;;
        *) [ -n "${WSL_DISTRO_NAME:-}${WSL_INTEROP:-}" ] || return 1 ;;
      esac
      ;;
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

# Sets _CLV2_LAUNCHER_PATH instead of printing, so the hot path can ask for the
# launcher without a command-substitution subshell.
_clv2_pick_install_manager_launcher() {
  # With the Python Install Manager, python3/python in
  #   %LOCALAPPDATA%\Microsoft\WindowsApps
  # are App Execution Aliases. Every start of one makes Windows run an App
  # Installer update check (AppXDeploymentServer event 603), and this hook
  # starts Python several times per tool call. The Install Manager's global
  # shortcuts in %LOCALAPPDATA%\Python\bin start the same runtime without that
  # check, so select the shortcut for $1 when it is an alias and one exists.
  # Microsoft Store Python has no such shortcut and keeps its alias. Only the
  # current user's WindowsApps counts: an alias from anywhere else is left alone.
  # The alias is also kept when it may not be the Install Manager's (Store
  # Python provides the same name, and either package can own it) and when
  # PYTHON_MANAGER_DEFAULT picks the runtime, which the alias honours and the
  # shortcut, generated for one runtime, does not.
  _CLV2_LAUNCHER_PATH=""
  local _candidate="$1" _resolved="" _local _store
  [ -n "${LOCALAPPDATA:-}" ] || return 1
  [ -z "${PYTHON_MANAGER_DEFAULT:-}" ] || return 1
  # hash + BASH_CMDS yields the resolved path without a command-substitution
  # subshell (bash >= 4). Older shells fall through to `command -v`.
  if [ "${BASH_VERSINFO[0]:-0}" -ge 4 ] && hash "$_candidate" 2>/dev/null; then
    _resolved="${BASH_CMDS[$_candidate]:-}"
  fi
  if [ -z "$_resolved" ]; then
    _resolved="$(command -v "$_candidate" 2>/dev/null || true)"
  fi
  case "$_resolved" in */*) ;; *) return 1 ;; esac
  # Git Bash accepts C:/... paths, so swapping separators avoids a cygpath start.
  _local="${LOCALAPPDATA//\\//}"
  _local="${_local%/}"
  # The resolved path is /c/... (or a mount such as /tmp/...) while LOCALAPPDATA
  # is C:\..., so ask whether the two name the same directory instead of
  # comparing strings.
  [ "${_resolved%/*}" -ef "$_local/Microsoft/WindowsApps" ] || return 1
  # A glob, not a command, so this check starts no process.
  for _store in "$_local"/Microsoft/WindowsApps/PythonSoftwareFoundation.Python.3*/"${_candidate}.exe"; do
    [ -e "$_store" ] && return 1
  done
  [ -f "$_local/Python/bin/${_candidate}.exe" ] && [ -x "$_local/Python/bin/${_candidate}.exe" ] || return 1
  _CLV2_LAUNCHER_PATH="$_local/Python/bin/${_candidate}.exe"
}

# Sets _CLV2_RESOLVED_PYTHON instead of printing, so the hot path can resolve
# the interpreter without a command-substitution subshell.
_clv2_pick_python_cmd() {
  _CLV2_RESOLVED_PYTHON=""

  if [ -n "${CLV2_PYTHON_CMD:-}" ] && command -v "$CLV2_PYTHON_CMD" >/dev/null 2>&1; then
    _CLV2_RESOLVED_PYTHON="$CLV2_PYTHON_CMD"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1 && ! _is_windows_app_installer_stub python3; then
    if _clv2_pick_install_manager_launcher python3; then
      _CLV2_RESOLVED_PYTHON="$_CLV2_LAUNCHER_PATH"
    else
      _CLV2_RESOLVED_PYTHON="python3"
    fi
    return 0
  fi

  if command -v python >/dev/null 2>&1 && ! _is_windows_app_installer_stub python; then
    if _clv2_pick_install_manager_launcher python; then
      _CLV2_RESOLVED_PYTHON="$_CLV2_LAUNCHER_PATH"
    else
      _CLV2_RESOLVED_PYTHON="python"
    fi
    return 0
  fi

  return 1
}

_CLV2_RESOLVED_PYTHON=""
_clv2_pick_python_cmd 2>/dev/null || true
PYTHON_CMD="$_CLV2_RESOLVED_PYTHON"
if [ -z "$PYTHON_CMD" ]; then
  echo "[observe] No python interpreter found, skipping observation" >&2
  exit 0
fi

# Propagate our stub-aware selection so detect-project.sh (which is sourced
# below) does not re-resolve and silently fall back to the App Installer stub.
# detect-project.sh honors an already-set CLV2_PYTHON_CMD.
export CLV2_PYTHON_CMD="${CLV2_PYTHON_CMD:-$PYTHON_CMD}"

# ─────────────────────────────────────────────
# Read cwd, agent_id and the observer flag in one interpreter start
# ─────────────────────────────────────────────

# Resolve the observer config path now so its "enabled" flag can be read by
# the same Python start that parses stdin (used by the lazy-start block below).
if [ -n "${CLV2_CONFIG:-}" ]; then
  CONFIG_FILE="$CLV2_CONFIG"
elif [ -f "${CONFIG_DIR}/config.json" ]; then
  CONFIG_FILE="${CONFIG_DIR}/config.json"
else
  CONFIG_FILE="${SKILL_ROOT}/config.json"
fi
# Use effective config path for both existence check and reading
EFFECTIVE_CONFIG="$CONFIG_FILE"
_CLV2_CONFIG_FOR_PY=""
if [ -f "$EFFECTIVE_CONFIG" ]; then
  _CLV2_CONFIG_FOR_PY="$EFFECTIVE_CONFIG"
fi

# Output: agent_id on line 1, observer.enabled on line 2, then cwd as everything
# after that, closed by a "." so trailing characters survive $(...). cwd is the
# only value that must arrive byte for byte (a directory name may contain a
# newline on POSIX), so it is the one that is not confined to a line. A value
# that fails to parse is emitted empty (or "false"), matching the previous
# separate calls.
_CLV2_STDIN_FIELDS=$(CLV2_CONFIG_PATH="$_CLV2_CONFIG_FOR_PY" "$PYTHON_CMD" -c '
import json, os, sys

# Each value is checked against the stdout encoding on its own (cp1252 through a
# pipe on native Windows Python), so one unprintable value is emitted empty
# instead of failing the whole write and hiding the other two.
def printable(text):
    text.encode(sys.stdout.encoding or "utf-8")
    return text

def one_line(value):
    return printable(str(value).replace("\r", " ").replace("\n", " "))

try:
    data = json.load(sys.stdin)
except Exception:
    data = None

# Only an absolute, existing directory is reported, in canonical form and with
# its characters unchanged; anything else is emitted empty so it cannot select
# a project (see below).
try:
    cwd = data.get("cwd", "")
    cwd = cwd[:4096] if isinstance(cwd, str) else ""
    if os.path.isabs(cwd) and os.path.isdir(cwd):
        cwd = printable(os.path.realpath(cwd))
    else:
        cwd = ""
except Exception:
    cwd = ""

try:
    agent_id = one_line(data.get("agent_id", ""))
except Exception:
    agent_id = ""

enabled = "false"
config_path = os.environ.get("CLV2_CONFIG_PATH", "")
if config_path:
    try:
        with open(config_path) as f:
            cfg = json.load(f)
        # Only the literal values may leave this block: a user-written string
        # with a newline in it would shift the fields that follow.
        enabled = "true" if str(cfg.get("observer", {}).get("enabled", False)).lower() == "true" else "false"
    except Exception:
        enabled = "false"

# newline="" keeps a newline inside cwd from becoming CRLF on native Windows.
out = sys.stdout
try:
    out.reconfigure(newline="")
except Exception:
    pass
out.write(agent_id + "\n" + enabled + "\n" + cwd + ".")
' 2>/dev/null <<< "$INPUT_JSON" || true)

STDIN_CWD=""
_ECC_AGENT_ID=""
_CLV2_OBSERVER_ENABLED="false"
# Accept the output only in its complete shape: two lines, then cwd closed by
# ".". Anything else (Python failed part-way) leaves all three at their safe
# defaults.
case "$_CLV2_STDIN_FIELDS" in
  *$'\n'*$'\n'*.)
    _ECC_AGENT_ID="${_CLV2_STDIN_FIELDS%%$'\n'*}"
    _CLV2_STDIN_REST="${_CLV2_STDIN_FIELDS#*$'\n'}"
    _CLV2_OBSERVER_ENABLED="${_CLV2_STDIN_REST%%$'\n'*}"
    STDIN_CWD="${_CLV2_STDIN_REST#*$'\n'}"
    STDIN_CWD="${STDIN_CWD%.}"
    # A Python that could not switch off newline translation writes CRLF.
    _ECC_AGENT_ID="${_ECC_AGENT_ID%$'\r'}"
    _CLV2_OBSERVER_ENABLED="${_CLV2_OBSERVER_ENABLED%$'\r'}"
    ;;
esac

# Layer 4: subagent sessions are automated by definition.
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
# Resolve stdin cwd to its repository root
# ─────────────────────────────────────────────

# If cwd is a subdirectory inside a git repo, resolve it to the repo root so
# observations attach to the project instead of a nested path.

# Only a validated, absolute payload cwd may select a project. Missing,
# relative, or non-existent paths must not fall through to detect-project.sh's
# inherited-process-cwd discovery, which can attach an observation to an
# unrelated repository that happened to launch the hook.
if [ -n "$STDIN_CWD" ] && [ -d "$STDIN_CWD" ]; then
  _GIT_ROOT=$(git -C "$STDIN_CWD" rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$_GIT_ROOT" ]; then
    export CLAUDE_PROJECT_DIR="$_GIT_ROOT"
    unset CLV2_NO_PROJECT
  else
    unset CLAUDE_PROJECT_DIR
    export CLV2_NO_PROJECT=1
  fi
else
  unset CLAUDE_PROJECT_DIR
  export CLV2_NO_PROJECT=1
fi

# ─────────────────────────────────────────────
# Project detection
# ─────────────────────────────────────────────

# Source shared project detection helper
# This sets: PROJECT_ID, PROJECT_NAME, PROJECT_ROOT, PROJECT_DIR
source "${SKILL_ROOT}/scripts/detect-project.sh"
PYTHON_CMD="${CLV2_PYTHON_CMD:-$PYTHON_CMD}"

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

OBSERVATIONS_FILE="${PROJECT_DIR}/observations.jsonl"
MAX_FILE_SIZE_MB=10

# Old-file purging runs once a day per project. Size-based rotation still runs
# on every observation so the existing active-log size limit stays effective.
# Shells without printf '%(...)T' (bash < 4.2) retain per-call housekeeping.
_CLV2_HOUSEKEEPING_MARKER="${PROJECT_DIR}/.housekeeping-day"
_CLV2_HOUSEKEEPING_TODAY=""
_CLV2_HOUSEKEEPING_LAST=""
if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] ||
   { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 2 ]; }; then
  printf -v _CLV2_HOUSEKEEPING_TODAY '%(%Y%m%d)T' -1
  if [ -f "$_CLV2_HOUSEKEEPING_MARKER" ]; then
    IFS= read -r _CLV2_HOUSEKEEPING_LAST < "$_CLV2_HOUSEKEEPING_MARKER" 2>/dev/null || true
  fi
fi
if [ -z "$_CLV2_HOUSEKEEPING_TODAY" ] || [ "$_CLV2_HOUSEKEEPING_LAST" != "$_CLV2_HOUSEKEEPING_TODAY" ]; then
  # Auto-purge observation files older than 30 days (runs once per session)
  PURGE_MARKER="${PROJECT_DIR}/.last-purge"
  if [ ! -f "$PURGE_MARKER" ] || [ "$(find "$PURGE_MARKER" -mtime +1 2>/dev/null)" ]; then
    find "${PROJECT_DIR}" -name "observations-*.jsonl" -mtime +30 -delete 2>/dev/null || true
    touch "$PURGE_MARKER" 2>/dev/null || true
  fi

  # Recorded after the work, so an interrupted run is repeated by the next call.
  if [ -n "$_CLV2_HOUSEKEEPING_TODAY" ]; then
    printf '%s\n' "$_CLV2_HOUSEKEEPING_TODAY" > "$_CLV2_HOUSEKEEPING_MARKER" 2>/dev/null || true
  fi
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


# ─────────────────────────────────────────────
# Parse, scrub and write the observation in one interpreter start
# ─────────────────────────────────────────────
#
# HOOK_PHASE goes in via env var since Claude Code does not include the hook
# type in stdin JSON. Exit status 3 means the payload could not be parsed; the
# shell then records a scrubbed parse_error instead (block below).
export PROJECT_ID_ENV="$PROJECT_ID"
export PROJECT_NAME_ENV="$PROJECT_NAME"
export OBSERVATION_CWD_ENV="$STDIN_CWD"

_CLV2_WRITE_RC=0
HOOK_PHASE="$HOOK_PHASE" "$PYTHON_CMD" -c '
import json, sys, os, re
import signal

def _clv2_bail(*_):
    print("[observe] SIGALRM timeout: in-flight observation dropped before write (#2300)", file=sys.stderr)
    sys.exit(0)
try:
    signal.signal(signal.SIGALRM, _clv2_bail)
    signal.alarm(8)  # self-terminate before the async hook 10s timeout can orphan us (#2278)
except Exception:
    pass
import time

try:
    data = json.loads(sys.stdin.read())

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
    cwd = data.get("cwd", "")
    cwd = cwd[:4096] if isinstance(cwd, str) else ""

    # Truncate large inputs/outputs
    if isinstance(tool_input, dict):
        tool_input_str = json.dumps(tool_input)[:5000]
    else:
        tool_input_str = str(tool_input)[:5000]

    if isinstance(tool_output, dict):
        tool_response_str = json.dumps(tool_output)[:5000]
    else:
        tool_response_str = str(tool_output)[:5000]
except Exception:
    sys.exit(3)

observation = {
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "event": event,
    "tool": tool_name,
    "session": session_id,
    "project_id": os.environ.get("PROJECT_ID_ENV", "global"),
    "project_name": os.environ.get("PROJECT_NAME_ENV", "global")
}

# Scrub secrets, including JSON-escaped quotes/backslashes in serialized tool I/O.
# This is defense in depth; arbitrary content still requires a metadata-only capture boundary.
# Includes optional auth scheme (e.g., "Bearer", "Basic") before token
# Linear-time secret matcher. Bounded quantifiers and a fixed set of auth
# schemes (instead of a generic [A-Za-z]+\s+ that overlapped the value class)
# prevent the catastrophic backtracking that pegged python at 100% CPU (#2278).
# The value class is disjoint from the separators, so it runs to the end of the
# token: a long labeled key is redacted whole instead of leaving its tail.
_SECRET_RE = re.compile(
    r"(?i)((?:api[_-]?key|token|secret|password|authorization|credentials?|auth)(?:_access_key|_key)?)"
    r"""(["'"'"'\s:=\\]{1,8})"""
    r"((?:bearer|basic|token|bot)\s+)?"
    r"([A-Za-z0-9_\-/.+=]{8,})"
)
# Value-shaped secrets that carry no keyword: PEM private key blocks (to END or
# end of the truncated text), GitHub tokens, AWS key IDs, Anthropic and OpenAI
# style sk- keys, JWTs (eyJ header, payload, optional signature) and DSN
# passwords (scheme://user:PASSWORD@host keeps scheme and user). Each branch is
# anchored on a literal prefix and uses bounded or non-overlapping classes (#2278);
# the sk- and JWT classes run to the end of the token so a long value is never
# half redacted.
# Tokens may follow a JSON escape (\n, \t, \uXXXX) since dict I/O is encoded
# before scrubbing; a DSN cut by truncation before its "@" ends at \Z,
# except a bare trailing host:port after http(s):// such as http://localhost:3000;
# any other scheme (postgres://app:1234) is redacted even when the password is numeric (#3568).
# PEM blocks run first: a label such as secret= in front of the BEGIN marker
# would otherwise let _SECRET_RE eat "-----BEGIN" and hide the block from this match.
_PEM_RE = re.compile(r"-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]{0,40}PRIVATE KEY-----|\Z)")
_SECRET_VALUE_RE = re.compile(
    r"(?:(?<![A-Za-z0-9_])|(?<=\\[bfnrt])|(?<=\\u[0-9a-fA-F]{4}))(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|(?:AKIA|ASIA)[A-Z0-9]{16})\b"
    r"|(?:(?<![A-Za-z0-9_-])|(?<=\\[bfnrt])|(?<=\\u[0-9a-fA-F]{4}))(?:sk-(?:ant|proj|svcacct|admin|or)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}[A-Za-z0-9_-]*|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)"
    r"""|(?<=://)(?:(?<=https://)|(?<=http://)|(?<!https://)(?<!http://)())([^\s:/@"\\]{1,256}:)(?(1)|(?!\d{1,5}\Z))[^\s@/"\\]{1,256}(?=@|\Z)"""
)
# A capture cut at its length limit can end inside an sk- key or JWT that the
# full patterns no longer match. Only applied when the text was actually cut,
# so a short output that happens to end in "sk-learn" stays readable.
_CUT_TAIL_RE = re.compile(
    r"(?:(?<![A-Za-z0-9_-])|(?<=\\[bfnrt])|(?<=\\u[0-9a-fA-F]{4}))(?:sk-[A-Za-z0-9_-]*|eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)?)\Z"
)

def scrub(val):
    if val is None:
        return None
    val = str(val)
    # Tool I/O is cut to 5000 chars before it reaches this process.
    cut = len(val) >= 5000
    val = _PEM_RE.sub("[REDACTED]", val)
    val = _SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + (m.group(3) or "") + "[REDACTED]", val)
    val = _SECRET_VALUE_RE.sub(lambda m: (m.group(2) or "") + "[REDACTED]", val)
    return _CUT_TAIL_RE.sub("[REDACTED]", val) if cut else val

# Prefer the canonical cwd that passed the project-selection boundary. Retain a
# bounded rejected string as diagnostic metadata without ever using it to select
# a project. Apply the same secret scrubber as tool I/O because path components
# can still contain credentials or tokens (for example, generated checkout names).
cwd = os.environ.get("OBSERVATION_CWD_ENV", "") or cwd
if cwd:
    observation["cwd"] = scrub(cwd)

input_value = tool_input_str if event == "tool_start" else None
output_value = tool_response_str if event == "tool_complete" else None

if input_value:
    observation["input"] = scrub(input_value)
if output_value is not None:
    observation["output"] = scrub(output_value)

print(json.dumps(observation))
' <<< "$INPUT_JSON" >> "$OBSERVATIONS_FILE" || _CLV2_WRITE_RC=$?

if [ "$_CLV2_WRITE_RC" -eq 3 ]; then
  # Fallback: log raw input for debugging (scrub secrets before persisting)
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  export TIMESTAMP="$timestamp"
  echo "$INPUT_JSON" | "$PYTHON_CMD" -c '
import json, sys, os, re

# Linear-time secret matcher. Bounded quantifiers and a fixed set of auth
# schemes (instead of a generic [A-Za-z]+\s+ that overlapped the value class)
# prevent the catastrophic backtracking that pegged python at 100% CPU (#2278).
# The value class is disjoint from the separators, so it runs to the end of the
# token: a long labeled key is redacted whole instead of leaving its tail.
_SECRET_RE = re.compile(
    r"(?i)((?:api[_-]?key|token|secret|password|authorization|credentials?|auth)(?:_access_key|_key)?)"
    r"""(["'"'"'\s:=\\]{1,8})"""
    r"((?:bearer|basic|token|bot)\s+)?"
    r"([A-Za-z0-9_\-/.+=]{8,})"
)
# Value-shaped secrets that carry no keyword: PEM private key blocks (to END or
# end of the truncated text), GitHub tokens, AWS key IDs, Anthropic and OpenAI
# style sk- keys, JWTs (eyJ header, payload, optional signature) and DSN
# passwords (scheme://user:PASSWORD@host keeps scheme and user). Each branch is
# anchored on a literal prefix and uses bounded or non-overlapping classes (#2278);
# the sk- and JWT classes run to the end of the token so a long value is never
# half redacted.
# Tokens may follow a JSON escape (\n, \t, \uXXXX) since dict I/O is encoded
# before scrubbing; a DSN cut by truncation before its "@" ends at \Z,
# except a bare trailing host:port after http(s):// such as http://localhost:3000;
# any other scheme (postgres://app:1234) is redacted even when the password is numeric (#3568).
# PEM blocks run first: a label such as secret= in front of the BEGIN marker
# would otherwise let _SECRET_RE eat "-----BEGIN" and hide the block from this match.
_PEM_RE = re.compile(r"-----BEGIN[A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]{0,40}PRIVATE KEY-----|\Z)")
_SECRET_VALUE_RE = re.compile(
    r"(?:(?<![A-Za-z0-9_])|(?<=\\[bfnrt])|(?<=\\u[0-9a-fA-F]{4}))(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|(?:AKIA|ASIA)[A-Z0-9]{16})\b"
    r"|(?:(?<![A-Za-z0-9_-])|(?<=\\[bfnrt])|(?<=\\u[0-9a-fA-F]{4}))(?:sk-(?:ant|proj|svcacct|admin|or)-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}[A-Za-z0-9_-]*|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)"
    r"""|(?<=://)(?:(?<=https://)|(?<=http://)|(?<!https://)(?<!http://)())([^\s:/@"\\]{1,256}:)(?(1)|(?!\d{1,5}\Z))[^\s@/"\\]{1,256}(?=@|\Z)"""
)
# A capture cut at its length limit can end inside an sk- key or JWT that the
# full patterns no longer match. Only applied when the text was actually cut,
# so a short output that happens to end in "sk-learn" stays readable.
_CUT_TAIL_RE = re.compile(
    r"(?:(?<![A-Za-z0-9_-])|(?<=\\[bfnrt])|(?<=\\u[0-9a-fA-F]{4}))(?:sk-[A-Za-z0-9_-]*|eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)?)\Z"
)

import signal
def _clv2_bail(*_):
    print("[observe] SIGALRM timeout: parse-error fallback observation dropped before write (#2300)", file=sys.stderr)
    sys.exit(0)
try:
    signal.signal(signal.SIGALRM, _clv2_bail)
    signal.alarm(8)  # self-terminate before the async hook 10s timeout can orphan us (#2278)
except Exception:
    pass

raw_full = sys.stdin.read()
raw = raw_full[:2000]
raw = _PEM_RE.sub("[REDACTED]", raw)
raw = _SECRET_RE.sub(lambda m: m.group(1) + m.group(2) + (m.group(3) or "") + "[REDACTED]", raw)
raw = _SECRET_VALUE_RE.sub(lambda m: (m.group(2) or "") + "[REDACTED]", raw)
if len(raw_full) > 2000:
    raw = _CUT_TAIL_RE.sub("[REDACTED]", raw)
print(json.dumps({"timestamp": os.environ["TIMESTAMP"], "event": "parse_error", "raw": raw}))
' >> "$OBSERVATIONS_FILE"
  exit 0
fi

# Any other failure keeps the previous behavior: the hook exits non-zero.
if [ "$_CLV2_WRITE_RC" -ne 0 ]; then
  exit "$_CLV2_WRITE_RC"
fi

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
  # Every call site below sits inside the lazy-start lock (flock / lockfile /
  # mkdir), so the streak read-modify-write in _NOTE_OBSERVER_NOSURVIVE is
  # serialized here without a second lock -- concurrent hook invocations cannot
  # lose an increment or double-log the warning. Counting at the restart (rather
  # than at detection) also means N racing hooks record one death, not N.
  if [ "${OBSERVER_DIED:-false}" = "true" ]; then
    _NOTE_OBSERVER_NOSURVIVE
  fi
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
    # Stale PID file - remove it. A well-formed PID that is no longer alive
    # means an observer we launched has since died, which is the only evidence
    # of non-survival any process ever sees (#2489). Record it; the caller
    # decides whether the streak is long enough to warn about.
    OBSERVER_DIED=true
    _REMOVE_FILE_IF_PRESENT "$pid_file"
  fi
  return 1  # No PID file or process dead
}

# The observer is lazy-started from a hook process that exits immediately after.
# start-observer.sh's own liveness check runs inside that still-living process
# tree, so it always sees a healthy observer and reports success -- on native
# Windows the reap happens later, when the hook's Job Object closes. The next
# hook invocation is therefore the only place the death is observable, and
# before #2489 it silently deleted the stale PID and restarted, once per tool
# call, forever. Warn once per streak so this is signal rather than noise.
_NOTE_OBSERVER_NOSURVIVE() {
  local streak_file="${PROJECT_DIR}/.observer-nosurvive-count"
  local log_file="${PROJECT_DIR}/observer-start.log"
  local warn_after="${ECC_OBSERVER_NOSURVIVE_WARN_AFTER:-3}"
  local streak
  streak=$(cat "$streak_file" 2>/dev/null || echo 0)
  # Force base 10 after the digit check: a stray leading zero would otherwise
  # make bash read the value as octal, and `08` is an arithmetic error that
  # would abort the whole hook under `set -e`.
  case "$streak" in ''|*[!0-9]*) streak=0 ;; *) streak=$((10#$streak)) ;; esac
  # Reject every all-zero spelling, not just the literal `0`: `00` passes a
  # digits-only check but compares as zero, and since the streak only grows the
  # threshold could never be reached -- silently disabling the diagnostic.
  case "$warn_after" in ''|*[!0-9]*) warn_after=3 ;; *) warn_after=$((10#$warn_after)) ;; esac
  if [ "$warn_after" -lt 1 ]; then warn_after=3; fi
  streak=$((streak + 1))

  # Warn only on a persisted increment, and only on equality. Both conditions
  # are what keep this to one warning per streak:
  #   - `-eq` rather than `-ge` stops it repeating once the threshold is passed.
  #   - Requiring the write to succeed stops it repeating when the write fails:
  #     a stuck counter file would otherwise be reread at `warn_after - 1` on
  #     every tool call, re-incremented in memory, and warn every time.
  # A failed write is still never fatal -- observe.sh runs on every tool call
  # and the repo rule is that hooks exit 0 on non-critical errors, so a full
  # disk must not break tool execution. The `if` context keeps `set -e` happy.
  if printf '%s\n' "$streak" > "$streak_file" 2>/dev/null &&
     [ "$streak" -eq "$warn_after" ]; then
    local platform_hint
    local uname_lower
    uname_lower=$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')
    case "$uname_lower" in
      *mingw*|*msys*|*cygwin*)
        platform_hint='[observe] On native Windows (Git Bash/MSYS2) this is expected: the background launch does not detach the observer from the hook process Job Object, so it is killed when the hook exits. Run under WSL2, Linux or macOS. See issue #2489.'
        ;;
      *)
        platform_hint="[observe] Check ${PROJECT_DIR}/observer.log for the reason the observer exited."
        ;;
    esac

    local message
    printf -v message '%s\n%s\n%s\n%s' \
      "[observe] Observer did not survive to the next hook invocation ${streak} times in a row." \
      "[observe] Startup reports success, but the process is gone by the following tool call, so no analysis ever runs." \
      "$platform_hint" \
      "[observe] Set ECC_OBSERVER_NOSURVIVE_WARN_AFTER to change this threshold (currently ${warn_after})."
    # An unwritable log must not silently swallow the diagnostic, so fall back
    # to stderr. Safe from spam: this block runs once per streak, not per call.
    if ! printf '%s\n' "$message" >> "$log_file" 2>/dev/null; then
      printf '%s\n' "$message" >&2 2>/dev/null || true
    fi
  fi
  return 0
}

_RESET_OBSERVER_NOSURVIVE_STREAK() {
  _REMOVE_FILE_IF_PRESENT "${PROJECT_DIR}/.observer-nosurvive-count"
}

if [ -f "${CONFIG_DIR}/disabled" ]; then
  OBSERVER_ENABLED=false
else
  OBSERVER_ENABLED=false
  # CONFIG_FILE / EFFECTIVE_CONFIG were resolved before stdin parsing, and the
  # "enabled" flag was read by that same interpreter start.
  if [ -f "$EFFECTIVE_CONFIG" ] && [ -n "$PYTHON_CMD" ]; then
    if [ "${_CLV2_OBSERVER_ENABLED:-false}" = "true" ]; then
      OBSERVER_ENABLED=true
    fi
  fi
fi

# Observers are deliberately scope-pinned: each project (and the global scope)
# owns a distinct PROJECT_DIR, PID file, observation stream, and lazy-start lock.
# An observer from another scope cannot consume this observation stream and must
# not suppress startup or receive signals for the current scope.
if [ "$OBSERVER_ENABLED" = "true" ]; then
  # Clean up stale PID files first.
  # `if` context (not `|| true`) so `set -e` stays satisfied while we still
  # capture whether this scope's PID file pointed at a live observer.
  OBSERVER_ALIVE=false
  OBSERVER_DIED=false
  if _CHECK_OBSERVER_RUNNING "${PROJECT_DIR}/.observer.pid"; then OBSERVER_ALIVE=true; fi

  # A live observer clears the streak so a later one-off crash does not inherit
  # an old count. This is an idempotent unlink, not a read-modify-write, so it
  # needs no lock. The matching increment runs inside the lazy-start lock, in
  # _START_OBSERVER_LOGGED.
  if [ "$OBSERVER_ALIVE" = "true" ]; then
    _RESET_OBSERVER_NOSURVIVE_STREAK
  fi

  # Check if observer is now running after cleanup
  if [ ! -f "${PROJECT_DIR}/.observer.pid" ]; then
    # Use flock if available (Linux), fallback for macOS
    if command -v flock >/dev/null 2>&1; then
      (
        flock -n 9 || exit 0
        # Double-check this scope's PID file after acquiring the lock.
        _CHECK_OBSERVER_RUNNING "${PROJECT_DIR}/.observer.pid" || true
        if [ ! -f "${PROJECT_DIR}/.observer.pid" ]; then
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
          if [ ! -f "${PROJECT_DIR}/.observer.pid" ]; then
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
          if [ ! -f "${PROJECT_DIR}/.observer.pid" ]; then
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
# Use a regular-file OS lock. Keep legacy mkdir locks untouched: a killed
# Windows process cannot run shell traps, and reclaiming those directories can
# race a live owner. The versioned file makes a stranded directory irrelevant.
SIGNAL_COUNTER_LOCK="${SIGNAL_COUNTER_FILE}.lock.v2"
ACTIVITY_FILE="${PROJECT_DIR}/.observer-last-activity"

touch "$ACTIVITY_FILE" 2>/dev/null || true

# Serialize the throttle-counter read-modify-write. observe.sh runs on every
# tool call (which can fire every second), so concurrent invocations previously
# raced on this counter: both read the same value, both incremented, and one
# write was lost, signaling the observer at unpredictable intervals (#2296).
# Prefer flock; Python supplies the same OS-released lock on macOS and Windows.
should_signal=0

_clv2_bump_signal_counter() {
  counter=0
  if [ -f "$SIGNAL_COUNTER_FILE" ]; then
    counter=$(head -c 20 "$SIGNAL_COUNTER_FILE" 2>/dev/null || echo 0)
  fi
  # Bound parsing and avoid shell arithmetic overflow on corrupt local state.
  case "$counter" in
    ''|*[!0-9]*) counter=0 ;;
  esac
  if [ "${#counter}" -gt 18 ]; then counter=0; fi
  counter=$((10#$counter + 1))
  if [ "$counter" -ge "$SIGNAL_EVERY_N" ]; then
    should_signal=1
    counter=0
  fi
  echo "$counter" > "$SIGNAL_COUNTER_FILE"
}

if command -v flock >/dev/null 2>&1 && exec 8>"$SIGNAL_COUNTER_LOCK" 2>/dev/null; then
  # flock is auto-released when fd 8 closes or the process dies, so there is no
  # stale lock and no lost increment. Use a bounded -w wait so the hook never
  # blocks indefinitely, and only bump the counter while the lock is held -- on
  # a timeout we skip the tick rather than doing an unlocked read-modify-write.
  if flock -w 2 8 2>/dev/null; then
    _clv2_bump_signal_counter
    flock -u 8 2>/dev/null || true
  fi
  exec 8>&- 2>/dev/null || true
else
  # One interpreter, monotonic elapsed-time wait, no MSYS2 sleep subprocesses.
  # Both fcntl and msvcrt release ownership even on SIGKILL/TerminateProcess.
  # If locking is unavailable or busy, skip the optional tick without an
  # unlocked update. Observation capture above has already completed.
  should_signal=$("$PYTHON_CMD" - "$SIGNAL_COUNTER_LOCK" "$SIGNAL_COUNTER_FILE" "$SIGNAL_EVERY_N" <<'PY'
import os
import re
import sys
import time

try:
    if os.name == "nt":
        import msvcrt
        # Git Bash passes /c/... paths to native Windows Python unchanged.
        for index in (1, 2):
            sys.argv[index] = re.sub(r"^/([A-Za-z])/", r"\1:/", sys.argv[index])
        def acquire(handle):
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        def acquire(handle):
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    with open(sys.argv[1], "a+b") as guard:
        if os.name == "nt" and os.fstat(guard.fileno()).st_size == 0:
            guard.write(b"0")
            guard.flush()
        deadline = time.monotonic() + 2.0
        while True:
            try:
                acquire(guard)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    print(0)
                    sys.exit(0)
                time.sleep(0.02)
        try:
            with open(sys.argv[2], encoding="ascii") as source:
                value = source.read(20).strip()
        except FileNotFoundError:
            value = ""
        counter = int(value) if 0 < len(value) <= 18 and value.isascii() and value.isdigit() else 0
        counter += 1
        signal = int(counter >= int(sys.argv[3]))
        if signal:
            counter = 0
        with open(sys.argv[2], "w", encoding="ascii") as target:
            target.write(str(counter) + "\n")
        print(signal)
except (ImportError, OSError, ValueError):
    print(0)
PY
  ) || should_signal=0
fi

# Signal only the observer that owns the current observation stream.
if [ "$should_signal" -eq 1 ]; then
  pid_file="${PROJECT_DIR}/.observer.pid"
  if [ -f "$pid_file" ]; then
    observer_pid=$(cat "$pid_file" 2>/dev/null || true)
    # Validate PID is a positive integer (>1)
    case "$observer_pid" in
      ''|*[!0-9]*|0|1)
        _REMOVE_FILE_IF_PRESENT "$pid_file"
        observer_pid=""
        ;;
    esac
    if [ -n "$observer_pid" ] && kill -0 "$observer_pid" 2>/dev/null; then
      kill -USR1 "$observer_pid" 2>/dev/null || true
    fi
  fi
fi

exit 0
