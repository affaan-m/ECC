#!/usr/bin/env bash
# Shared continuous-learning-v2 Python interpreter resolver.
#
# Sourced by hooks/observe.sh and scripts/detect-project.sh. Defines
# _clv2_resolve_python_cmd, which prints the command the CLv2 scripts should
# run Python with.
#
# Resolution precedence:
#   1. CLV2_PYTHON_CMD, when it names a runnable command (trusted as-is)
#   2. The verdict cached for this PATH (see "Cache" below)
#   3. python3, then python, skipping:
#        - the Windows App Installer stub (AppInstallerPythonRedirector.exe)
#        - interpreters older than CLV2_MIN_PYTHON (3.9)
#   4. When no candidate is 3.9+, the first one that runs, with a one-line
#      stderr notice (observation works there; instinct-cli.py does not)
#
# Packaged aliases. On Windows with the Python Install Manager, python3 and
# python under %LOCALAPPDATA%\Microsoft\WindowsApps are working App Execution
# Aliases. Every start of one makes Windows run an App Installer update check
# for the package (AppXDeploymentServer event 603), which leaks memory in
# AppXSvc (anthropics/claude-code#98929). observe.sh runs Python several times
# per tool call, so when the chosen name is such an alias and the interpreter
# behind it is a regular python*.exe outside WindowsApps, that interpreter's
# absolute path is used instead. Microsoft Store Python reports an interpreter
# inside WindowsApps and keeps using the alias.
#
# Cache. The verdict is kept in <homunculus dir>/.python-cmd so later hooks
# start no probe at all. It is used only while PATH and what python3 and python
# resolve to are unchanged, the chosen command still exists, and (on bash 4.2+)
# it is under a day old. Anything else re-probes and rewrites it. Deleting the
# file resets it. A cache file not owned by the current user is ignored, and
# the cached command is only run when it is python3, python or a python*.exe
# path outside WindowsApps, so a planted file in a shared homunculus dir cannot
# choose what runs.

# Lowest Python the CLv2 scripts run on: instinct-cli.py uses PEP 585
# annotations (list[dict]) evaluated at def time and str.removeprefix.
CLV2_MIN_PYTHON_MAJOR=3
CLV2_MIN_PYTHON_MINOR=9

_CLV2_PYTHON_CACHE_TAG='clv2-python-cmd 1'
_CLV2_PYTHON_CACHE_TTL=86400
_CLV2_PYTHON_PROBE_TIMEOUT=10

# Prints the version verdict, then sys.executable as UTF-8 bytes. Python 2
# compatible on purpose, so an old "python" reports its version instead of a
# syntax error. Writing the path through the byte buffer avoids the
# UnicodeEncodeError print() raises for a non-ANSI profile path; if that
# write fails anyway, the verdict line alone still counts.
_CLV2_PYTHON_PROBE="import sys
print('clv2-ok' if sys.version_info[:2] >= ($CLV2_MIN_PYTHON_MAJOR, $CLV2_MIN_PYTHON_MINOR) else 'clv2-old')
sys.stdout.flush()
try:
    sys.stdout.buffer.write(sys.executable.encode('utf-8') + b'\\n')
except Exception:
    pass"

if ! command -v _clv2_resolve_homunculus_dir >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  . "${BASH_SOURCE[0]%/*}/homunculus-dir.sh"
fi

_clv2_is_app_installer_stub() {
  # Windows 10/11 ships an "App Execution Alias" stub at
  #   %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe
  #   %LOCALAPPDATA%\Microsoft\WindowsApps\python3.exe
  # Both are symlinks to AppInstallerPythonRedirector.exe which, when Python
  # is not installed from the Store, neither launches Python nor honors "-c".
  # Calls to it hang or print a bare "Python " line, silently breaking every
  # JSON-parsing step in the hooks. Detect and skip such stubs here.
  local _resolved="$1"
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

_clv2_in_windows_apps() {
  case "$1" in
    *[\\/][Ww][Ii][Nn][Dd][Oo][Ww][Ss][Aa][Pp][Pp][Ss][\\/]*) return 0 ;;
  esac
  return 1
}

_clv2_now() {
  # Sets _clv2_epoch to the current epoch seconds without starting a process,
  # or to "" on bash older than 4.2.
  _clv2_epoch=""
  if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] ||
     { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 2 ]; }; then
    printf -v _clv2_epoch '%(%s)T' -1 2>/dev/null || _clv2_epoch=""
  fi
}

_clv2_python_cache_file() {
  local _dir
  _dir="$(_clv2_resolve_homunculus_dir 2>/dev/null)" || return 1
  [ -n "$_dir" ] && [ -d "$_dir" ] || return 1
  printf '%s/.python-cmd\n' "$_dir"
}

_clv2_python_cache_read() {
  # $1 cache file, $2 python3 path, $3 python path. Prints the cached command
  # iff the entry is complete and still describes this environment.
  local _file="$1" _tag _saved _path _py3 _py _cmd _end _age
  [ -r "$_file" ] && [ -O "$_file" ] || return 1
  {
    IFS= read -r _tag && IFS= read -r _saved && IFS= read -r _path &&
      IFS= read -r _py3 && IFS= read -r _py && IFS= read -r _cmd &&
      IFS= read -r _end
  } 2>/dev/null < "$_file" || return 1
  [ "$_tag" = "$_CLV2_PYTHON_CACHE_TAG" ] && [ "$_end" = "end" ] || return 1
  [ "$_path" = "$PATH" ] && [ "$_py3" = "$2" ] && [ "$_py" = "$3" ] || return 1
  [ -n "$_cmd" ] || return 1
  _clv2_now
  if [ -n "$_clv2_epoch" ] && [ -n "$_saved" ]; then
    case "$_saved" in *[!0-9]*) return 1 ;; esac
    _age=$((_clv2_epoch - _saved))
    [ "$_age" -ge 0 ] && [ "$_age" -lt "$_CLV2_PYTHON_CACHE_TTL" ] || return 1
  fi
  # Run only what the resolver itself could have chosen.
  case "$_cmd" in
    python3|python) command -v "$_cmd" >/dev/null 2>&1 || return 1 ;;
    *) _clv2_is_python_exe "$_cmd" || return 1 ;;
  esac
  printf '%s\n' "$_cmd"
}

_clv2_python_cache_write() {
  # $1 cache file, $2 python3 path, $3 python path, $4 chosen command.
  local _file="$1" _tmp="$1.$$"
  _clv2_now
  {
    printf '%s\n' "$_CLV2_PYTHON_CACHE_TAG" "$_clv2_epoch" "$PATH" "$2" "$3" "$4" "end" > "$_tmp" &&
      mv -f "$_tmp" "$_file"
  } 2>/dev/null || rm -f "$_tmp" 2>/dev/null || true
}

_clv2_python_probe() {
  # Sets _clv2_probe_ok (1 when the interpreter meets the minimum version) and
  # _clv2_probe_exe (its sys.executable, possibly empty). Returns 1 when the
  # interpreter does not answer with a verdict line. The exit status is
  # ignored: a verdict followed by a failure still describes a working Python.
  # GNU timeout bounds a hanging alias or stub; Windows' own timeout.exe in
  # System32 is a different program and is never used.
  local _out _ok _timeout=""
  _clv2_probe_ok=""
  _clv2_probe_exe=""
  if _timeout="$(command -v timeout 2>/dev/null)"; then
    case "$_timeout" in
      *[\\/][Ss][Yy][Ss][Tt][Ee][Mm]32[\\/]*) _timeout="" ;;
    esac
  fi
  if [ -n "$_timeout" ]; then
    _out="$("$_timeout" "$_CLV2_PYTHON_PROBE_TIMEOUT" "$1" -c "$_CLV2_PYTHON_PROBE" 2>/dev/null)"
  else
    _out="$("$1" -c "$_CLV2_PYTHON_PROBE" 2>/dev/null)"
  fi
  _ok="${_out%%$'\n'*}"
  _ok="${_ok%$'\r'}"
  case "$_ok" in
    clv2-ok) _clv2_probe_ok=1 ;;
    clv2-old) ;;
    *) return 1 ;;
  esac
  case "$_out" in
    *$'\n'*)
      _clv2_probe_exe="${_out#*$'\n'}"
      _clv2_probe_exe="${_clv2_probe_exe%%$'\n'*}"
      _clv2_probe_exe="${_clv2_probe_exe%$'\r'}"
      ;;
  esac
  return 0
}

_clv2_is_python_exe() {
  # True iff $1 is an absolute POSIX path to a regular, executable python*.exe
  # outside WindowsApps.
  case "$1" in
    /*) ;;
    *) return 1 ;;
  esac
  _clv2_in_windows_apps "$1" && return 1
  case "${1##*/}" in
    [Pp][Yy][Tt][Hh][Oo][Nn]*.[Ee][Xx][Ee]) ;;
    *) return 1 ;;
  esac
  [ -f "$1" ] && [ -x "$1" ]
}

_clv2_alias_target() {
  # $1: sys.executable reported through a packaged alias. Prints it as an
  # absolute POSIX path iff it is a regular python*.exe outside WindowsApps.
  local _exe="$1"
  [ -n "$_exe" ] || return 1
  _clv2_in_windows_apps "$_exe" && return 1
  case "$_exe" in
    [A-Za-z]:[\\/]*)
      command -v cygpath >/dev/null 2>&1 || return 1
      _exe="$(cygpath -u "$_exe" 2>/dev/null)" || return 1
      ;;
  esac
  _clv2_is_python_exe "$_exe" || return 1
  printf '%s\n' "$_exe"
}

_clv2_resolve_python_cmd() {
  if [ -n "${CLV2_PYTHON_CMD:-}" ] && command -v "$CLV2_PYTHON_CMD" >/dev/null 2>&1; then
    printf '%s\n' "$CLV2_PYTHON_CMD"
    return 0
  fi

  local _py3 _py _cache _cmd _fallback _choice _name _resolved _target
  _py3="$(command -v python3 2>/dev/null || true)"
  _py="$(command -v python 2>/dev/null || true)"
  [ -n "$_py3" ] || [ -n "$_py" ] || return 1

  _cache="$(_clv2_python_cache_file 2>/dev/null || true)"
  if [ -n "$_cache" ] && _cmd="$(_clv2_python_cache_read "$_cache" "$_py3" "$_py")"; then
    printf '%s\n' "$_cmd"
    return 0
  fi

  _cmd=""
  _fallback=""
  for _name in python3 python; do
    if [ "$_name" = python3 ]; then _resolved="$_py3"; else _resolved="$_py"; fi
    [ -n "$_resolved" ] || continue
    _clv2_is_app_installer_stub "$_resolved" && continue
    _clv2_python_probe "$_name" || continue
    _choice="$_name"
    if _clv2_in_windows_apps "$_resolved" &&
       _target="$(_clv2_alias_target "$_clv2_probe_exe")"; then
      _choice="$_target"
    fi
    if [ -n "$_clv2_probe_ok" ]; then
      _cmd="$_choice"
      break
    fi
    [ -n "$_fallback" ] || _fallback="$_choice"
  done
  if [ -z "$_cmd" ] && [ -n "$_fallback" ]; then
    # Older Pythons still run observe.sh; only instinct-cli.py needs 3.9.
    _cmd="$_fallback"
    printf '[clv2] No Python %s.%s+ found; using %s. instinct-cli.py needs Python %s.%s or newer.\n' \
      "$CLV2_MIN_PYTHON_MAJOR" "$CLV2_MIN_PYTHON_MINOR" "$_cmd" \
      "$CLV2_MIN_PYTHON_MAJOR" "$CLV2_MIN_PYTHON_MINOR" >&2
  fi
  [ -n "$_cmd" ] || return 1

  [ -z "$_cache" ] || _clv2_python_cache_write "$_cache" "$_py3" "$_py" "$_cmd"
  printf '%s\n' "$_cmd"
}
