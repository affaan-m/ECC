#!/usr/bin/env bash
# Continuous Learning v2 - Project Detection Helper
#
# Shared logic for detecting current project context.
# Sourced by observe.sh and start-observer.sh.
#
# Exports:
#   _CLV2_PROJECT_ID     - Short hash identifying the project (or "global")
#   _CLV2_PROJECT_NAME   - Human-readable project name
#   _CLV2_PROJECT_ROOT   - Absolute path to project root
#   _CLV2_PROJECT_DIR    - Project-scoped storage directory under homunculus
#
# Also sets unprefixed convenience aliases:
#   PROJECT_ID, PROJECT_NAME, PROJECT_ROOT, PROJECT_DIR
#
# Detection priority:
#   1. CLAUDE_PROJECT_DIR env var (if set)
#   2. git remote URL (hashed for uniqueness across machines)
#   3. git repo root path (fallback, machine-specific)
#   4. "global" (no project context detected)

# This file is sourced on every tool call. Each external command is a process
# launch, which costs a few milliseconds on Linux/macOS but 80-280 ms under Git
# Bash on Windows, so the hot path uses parameter expansion and shell builtins
# wherever an external command is not required.
# Git Bash may be handed a Windows path (C:\...\detect-project.sh); dirname
# accepted both separators there, so normalize before splitting.
_CLV2_DETECT_PROJECT_SELF="${BASH_SOURCE[0]}"
case "${OSTYPE:-}" in
  msys*|cygwin*|win32*) _CLV2_DETECT_PROJECT_SELF="${_CLV2_DETECT_PROJECT_SELF//\\//}" ;;
esac
case "$_CLV2_DETECT_PROJECT_SELF" in
  */*) _CLV2_DETECT_PROJECT_SCRIPT_DIR="${_CLV2_DETECT_PROJECT_SELF%/*}" ;;
  *) _CLV2_DETECT_PROJECT_SCRIPT_DIR="." ;;
esac
# shellcheck disable=SC1091
. "${_CLV2_DETECT_PROJECT_SCRIPT_DIR}/lib/homunculus-dir.sh"
_CLV2_HOMUNCULUS_DIR="$(_clv2_resolve_homunculus_dir)"
_CLV2_PROJECTS_DIR="${_CLV2_HOMUNCULUS_DIR}/projects"
_CLV2_REGISTRY_FILE="${_CLV2_HOMUNCULUS_DIR}/projects.json"

_clv2_resolve_python_cmd() {
  if [ -n "${CLV2_PYTHON_CMD:-}" ] && command -v "$CLV2_PYTHON_CMD" >/dev/null 2>&1; then
    printf '%s\n' "$CLV2_PYTHON_CMD"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf '%s\n' python3
    return 0
  fi

  if command -v python >/dev/null 2>&1; then
    printf '%s\n' python
    return 0
  fi

  return 1
}

if [ -n "${CLV2_PYTHON_CMD:-}" ] && command -v "$CLV2_PYTHON_CMD" >/dev/null 2>&1; then
  # Already resolved by the caller (observe.sh exports it): reuse it without
  # paying for a command-substitution subshell.
  _CLV2_PYTHON_CMD="$CLV2_PYTHON_CMD"
else
  _CLV2_PYTHON_CMD="$(_clv2_resolve_python_cmd 2>/dev/null || true)"
fi
CLV2_PYTHON_CMD="$_CLV2_PYTHON_CMD"
export CLV2_PYTHON_CMD

CLV2_OBSERVER_PROMPT_PATTERN='Can you confirm|requires permission|Awaiting (user confirmation|confirmation|approval|permission)|confirm I should proceed|once granted access|grant.*access'
export CLV2_OBSERVER_PROMPT_PATTERN

_clv2_normalize_remote_url() {
  local url="$1"
  [ -z "$url" ] && return 0

  local is_network=0
  case "$url" in
    file://*) is_network=0 ;;
    *://*) is_network=1 ;;
    *@*:*) is_network=1 ;;
    *) is_network=0 ;;
  esac

  url=$(printf '%s' "$url" | sed -E 's|://[^@]+@|://|')
  url=$(printf '%s' "$url" | sed -E 's|^[A-Za-z][A-Za-z0-9+.-]*://||')
  url=$(printf '%s' "$url" | sed -E 's|^[^@/:]+@([^:/]+):|\1/|')
  url=$(printf '%s' "$url" | sed -E 's|\.git/?$||; s|/+$||')

  if [ "$is_network" = "1" ]; then
    printf '%s' "$url" | tr '[:upper:]' '[:lower:]'
  else
    printf '%s' "$url"
  fi
}

_clv2_main_worktree_root() {
  local root="$1"
  [ -z "$root" ] && return 0
  command -v git >/dev/null 2>&1 || return 0

  git -C "$root" worktree list --porcelain 2>/dev/null | while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        printf '%s\n' "${line#worktree }"
        break
        ;;
    esac
  done
}

_clv2_detect_project() {
  local project_root=""
  local project_name=""
  local project_id=""
  local source_hint=""

  if [ "${CLV2_NO_PROJECT:-0}" = "1" ]; then
    _CLV2_PROJECT_ID="global"
    _CLV2_PROJECT_NAME="global"
    _CLV2_PROJECT_ROOT=""
    _CLV2_PROJECT_DIR="${_CLV2_HOMUNCULUS_DIR}"
    mkdir -p "$_CLV2_PROJECT_DIR"
    return 0
  fi

  # 1. Try CLAUDE_PROJECT_DIR env var (explicit override)
  if [ -n "$CLAUDE_PROJECT_DIR" ] && [ -d "$CLAUDE_PROJECT_DIR" ]; then
    if command -v git &>/dev/null; then
      project_root=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null || true)
      if [ -n "$project_root" ]; then
        source_hint="env"
      fi
    fi
    # Non-git directory explicitly pointed at by CLAUDE_PROJECT_DIR: honor it as
    # a project root (path-hash identity) rather than collapsing to the shared
    # `global` bucket. Gated on the explicit env var so an arbitrary non-git cwd
    # never becomes a "project" — priority 2 below stays git-only on purpose.
    if [ -z "$project_root" ]; then
      project_root=$(cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && pwd -P)
      if [ -n "$project_root" ]; then
        source_hint="env-nogit"
      fi
    fi
  fi

  # 2. Try git repo root from CWD (only if git is available)
  if [ -z "$project_root" ] && command -v git &>/dev/null; then
    project_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$project_root" ]; then
      source_hint="git"
    fi
  fi

  # 3. No project detected — fall back to global
  if [ -z "$project_root" ]; then
    _CLV2_PROJECT_ID="global"
    _CLV2_PROJECT_NAME="global"
    _CLV2_PROJECT_ROOT=""
    _CLV2_PROJECT_DIR="${_CLV2_HOMUNCULUS_DIR}"
    mkdir -p "$_CLV2_PROJECT_DIR"
    return 0
  fi

  # Derive project name from directory basename
  # Normalize Windows backslashes so basename works when CLAUDE_PROJECT_DIR
  # is passed as e.g. C:\Users\...\project.
  local _norm_root
  _norm_root=$(printf '%s' "$project_root" | sed 's|\\|/|g')
  project_name=$(basename "$_norm_root")

  # Derive project ID: prefer git remote URL hash (portable across machines),
  # fall back to path hash (machine-specific but still useful)
  local remote_url=""
  if command -v git &>/dev/null; then
    if [ "$source_hint" = "git" ] || [ -e "${project_root}/.git" ]; then
      remote_url=$(git -C "$project_root" remote get-url origin 2>/dev/null || true)
    fi
  fi

  local raw_remote_url="$remote_url"
  # Remembered for the detection cache: the origin this id was derived from.
  _CLV2_PROJECT_REMOTE_SEEN="$raw_remote_url"

  # Strip embedded credentials from remote URL (e.g., https://ghp_xxxx@github.com/...)
  if [ -n "$remote_url" ]; then
    remote_url=$(printf '%s' "$remote_url" | sed -E 's|://[^@]+@|://|')
  fi

  local legacy_hash_input="${remote_url:-$project_root}"
  local normalized_remote=""
  if [ -n "$remote_url" ]; then
    normalized_remote=$(_clv2_normalize_remote_url "$remote_url")
  fi

  local fallback_root="$project_root"
  if [ -z "$remote_url" ]; then
    local main_worktree_root
    main_worktree_root=$(_clv2_main_worktree_root "$project_root")
    [ -n "$main_worktree_root" ] && fallback_root="$main_worktree_root"
  fi

  local hash_input="${normalized_remote:-${remote_url:-$fallback_root}}"
  # Prefer Python for consistent SHA256 behavior across shells/platforms.
  # Pass the value via env var and encode as UTF-8 inside Python so the hash
  # is locale-independent (shells vary between UTF-8 / CP932 / CP1252, which
  # would otherwise produce different hashes for the same non-ASCII path).
  if [ -n "$_CLV2_PYTHON_CMD" ]; then
    project_id=$(_CLV2_HASH_INPUT="$hash_input" "$_CLV2_PYTHON_CMD" -c '
import os, hashlib
s = os.environ["_CLV2_HASH_INPUT"]
print(hashlib.sha256(s.encode("utf-8")).hexdigest()[:12])
' 2>/dev/null)
  fi

  # Fallback if Python is unavailable or hash generation failed.
  if [ -z "$project_id" ]; then
    project_id=$(printf '%s' "$hash_input" | shasum -a 256 2>/dev/null | cut -c1-12 || \
                 printf '%s' "$hash_input" | sha256sum 2>/dev/null | cut -c1-12 || \
                 echo "fallback")
  fi

  # Backward compatibility: migrate a single legacy project directory from
  # credential-stripped or raw remote hashes to the normalized remote hash.
  if [ -n "$_CLV2_PYTHON_CMD" ] && [ ! -d "${_CLV2_PROJECTS_DIR}/${project_id}" ]; then
    local legacy_inputs=()
    [ -n "$legacy_hash_input" ] && [ "$legacy_hash_input" != "$hash_input" ] \
      && legacy_inputs+=("$legacy_hash_input")
    [ -n "$raw_remote_url" ] && [ "$raw_remote_url" != "$hash_input" ] \
      && [ "$raw_remote_url" != "$legacy_hash_input" ] \
      && legacy_inputs+=("$raw_remote_url")

    local legacy_input legacy_id
    for legacy_input in "${legacy_inputs[@]}"; do
      legacy_id=$(_CLV2_HASH_INPUT="$legacy_input" "$_CLV2_PYTHON_CMD" -c '
import os, hashlib
s = os.environ["_CLV2_HASH_INPUT"]
print(hashlib.sha256(s.encode("utf-8")).hexdigest()[:12])
' 2>/dev/null)
      if [ -n "$legacy_id" ] && [ "$legacy_id" != "$project_id" ] \
         && [ -d "${_CLV2_PROJECTS_DIR}/${legacy_id}" ]; then
        if mv "${_CLV2_PROJECTS_DIR}/${legacy_id}" "${_CLV2_PROJECTS_DIR}/${project_id}" 2>/dev/null; then
          break
        else
          project_id="$legacy_id"
          break
        fi
      fi
    done
  fi

  # Export results
  _CLV2_PROJECT_ID="$project_id"
  _CLV2_PROJECT_NAME="$project_name"
  _CLV2_PROJECT_ROOT="$project_root"
  _CLV2_PROJECT_DIR="${_CLV2_PROJECTS_DIR}/${project_id}"

  # Ensure project directory structure exists
  mkdir -p "${_CLV2_PROJECT_DIR}/instincts/personal"
  mkdir -p "${_CLV2_PROJECT_DIR}/instincts/inherited"
  mkdir -p "${_CLV2_PROJECT_DIR}/observations.archive"
  mkdir -p "${_CLV2_PROJECT_DIR}/evolved/skills"
  mkdir -p "${_CLV2_PROJECT_DIR}/evolved/commands"
  mkdir -p "${_CLV2_PROJECT_DIR}/evolved/agents"

  # Update project registry (lightweight JSON mapping)
  _clv2_update_project_registry "$project_id" "$project_name" "$project_root" "$remote_url"
}

_clv2_update_project_registry() {
  local pid="$1"
  local pname="$2"
  local proot="$3"
  local premote="$4"
  local pdir="$_CLV2_PROJECT_DIR"

  mkdir -p "$(dirname "$_CLV2_REGISTRY_FILE")"

  if [ -z "$_CLV2_PYTHON_CMD" ]; then
    return 0
  fi

  # Pass values via env vars to avoid shell→python injection.
  # Python reads them with os.environ, which is safe for any string content.
  _CLV2_REG_PID="$pid" \
  _CLV2_REG_PNAME="$pname" \
  _CLV2_REG_PROOT="$proot" \
  _CLV2_REG_PREMOTE="$premote" \
  _CLV2_REG_PDIR="$pdir" \
  _CLV2_REG_FILE="$_CLV2_REGISTRY_FILE" \
  "$_CLV2_PYTHON_CMD" -c '
import json, os, tempfile
from datetime import datetime, timezone

registry_path = os.environ["_CLV2_REG_FILE"]
project_dir = os.environ["_CLV2_REG_PDIR"]
project_file = os.path.join(project_dir, "project.json")

os.makedirs(project_dir, exist_ok=True)

def atomic_write_json(path, payload):
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{os.path.basename(path)}.tmp.",
        dir=os.path.dirname(path),
        text=True,
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, indent=2)
            f.write("\n")
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

try:
    with open(registry_path) as f:
        registry = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    registry = {}

now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
entry = registry.get(os.environ["_CLV2_REG_PID"], {})

metadata = {
    "id": os.environ["_CLV2_REG_PID"],
    "name": os.environ["_CLV2_REG_PNAME"],
    "root": os.environ["_CLV2_REG_PROOT"],
    "remote": os.environ["_CLV2_REG_PREMOTE"],
    "created_at": entry.get("created_at", now),
    "last_seen": now,
}

registry[os.environ["_CLV2_REG_PID"]] = metadata

atomic_write_json(project_file, metadata)
atomic_write_json(registry_path, registry)
' 2>/dev/null || true
}

# ─────────────────────────────────────────────
# Per-directory detection cache
# ─────────────────────────────────────────────
#
# Full detection launches git twice, python twice, sed six times and mkdir
# seven times, and rewrites projects.json. The answer rarely changes, so it is
# cached per (CLV2_NO_PROJECT, CLAUDE_PROJECT_DIR, PWD) for the rest of the day;
# a hit costs one git launch (none for a cached "global").
#
# A cached entry is rejected, and full detection reruns, when:
#   - it was written on another day (so the registry last_seen still refreshes
#     at least daily)
#   - the repository's .git/config is not older than the entry (a setting that
#     decides the root or the id, such as core.worktree, was changed)
#   - git no longer reports the origin the entry was derived from (remote
#     added, changed or removed, which changes the project id)
#   - a nearer .git marker changes discovery from the explicit project or cwd
#   - the project storage directory or the project root no longer exists
#   - the stored id is not a shape detection can produce
#
# The origin is asked from git on every hit (one `git remote get-url`), in
# addition to the timestamp check, because the effective origin can come from
# the repository config, a file it includes, the global or system config, or
# GIT_CONFIG_* variables, and only git resolves all of those. The entry stores
# the origin that detection itself read, so an entry written while the config
# was being changed fails this comparison too.
#
# Only a repository with its own .git/config file is cached. Linked worktrees,
# submodules and non-git CLAUDE_PROJECT_DIR roots are detected on every call,
# as is a "global" result reached because no repository was found.
#
# Set CLV2_PROJECT_CACHE=0 to disable. The day stamp needs printf '%(...)T'
# (bash >= 4.2); older shells such as the macOS system bash 3.2 skip the cache
# and detect on every call, exactly as before.
_CLV2_PROJECT_CACHE_HIT=0
_CLV2_PROJECT_CACHE_FILE=""
_CLV2_PROJECT_CACHE_KEY=""
_CLV2_PROJECT_CACHE_DAY=""
_CLV2_PROJECT_CACHE_VERSION="clv2-project-cache-2"
_CLV2_PROJECT_REMOTE_SEEN=""
_CLV2_PROJECT_CACHE_REMOTE=""

# Drop embedded credentials (https://token@host/...) so they never reach the
# cache file. Same rule as the sed in _clv2_detect_project, without a launch:
# the leftmost "://<non-@ characters>@" becomes "://".
_clv2_project_cache_remote() {
  _CLV2_PROJECT_CACHE_REMOTE="$1"
  if [[ "$1" =~ ://[^@]+@ ]]; then
    _CLV2_PROJECT_CACHE_REMOTE="${1/"${BASH_REMATCH[0]}"/://}"
  fi
}

_clv2_project_cache_prepare() {
  [ "${CLV2_PROJECT_CACHE:-1}" = "0" ] && return 1
  if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ] ||
     { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -lt 2 ]; }; then
    return 1
  fi

  local key="${CLV2_NO_PROJECT:-0}|${CLAUDE_PROJECT_DIR:-}|${PWD}"
  # The entry is line-based, so a key that spans lines cannot be stored.
  case "$key" in *$'\n'*|*$'\r'*) return 1 ;; esac

  local name="${key//[^A-Za-z0-9._-]/_}"
  [ "${#name}" -gt 200 ] && return 1

  printf -v _CLV2_PROJECT_CACHE_DAY '%(%Y%m%d)T' -1
  _CLV2_PROJECT_CACHE_KEY="$key"
  _CLV2_PROJECT_CACHE_FILE="${_CLV2_HOMUNCULUS_DIR}/.project-cache/${name}"
  return 0
}

# Confirm that discovery still selects the cached root without another Git
# launch. A newly initialized repo, worktree marker, or even broken .git link
# between the selected starting directory and that root requires fresh Git.
_clv2_project_cache_same_root() {
  local expected="$1"
  local start="${CLAUDE_PROJECT_DIR:-}"
  [ -n "$start" ] && [ -d "$start" ] || start="."
  local probe="$start" depth=0
  while [ "$depth" -lt 512 ]; do
    [ "$probe" -ef "$expected" ] && return 0
    if [ -e "$probe/.git" ] || [ -L "$probe/.git" ]; then return 1; fi
    [ "$probe" -ef "$probe/.." ] && return 1
    # Let the filesystem resolve aliases and .. without a cd/pwd subprocess.
    probe="$probe/.."
    depth=$((depth + 1))
  done
  return 1
}

_clv2_project_cache_load() {
  local file="$_CLV2_PROJECT_CACHE_FILE"
  [ -n "$file" ] && [ -f "$file" ] || return 1

  local version day key id name root remote
  {
    IFS= read -r version && IFS= read -r day && IFS= read -r key &&
      IFS= read -r id && IFS= read -r name && IFS= read -r root &&
      IFS= read -r remote
  } < "$file" 2>/dev/null || return 1

  [ "$version" = "$_CLV2_PROJECT_CACHE_VERSION" ] || return 1
  [ "$day" = "$_CLV2_PROJECT_CACHE_DAY" ] || return 1
  # Sanitized file names can collide; the stored key is the real identity.
  [ "$key" = "$_CLV2_PROJECT_CACHE_KEY" ] || return 1

  # The id becomes a path segment, so accept only what detection can emit:
  # "global", the "fallback" literal, or 12 lowercase hex characters.
  local dir
  case "$id" in
    global)
      [ -z "$root" ] || return 1
      dir="$_CLV2_HOMUNCULUS_DIR"
      ;;
    fallback) dir="${_CLV2_PROJECTS_DIR}/${id}" ;;
    ''|*[!0-9a-f]*) return 1 ;;
    *)
      [ "${#id}" -eq 12 ] || return 1
      dir="${_CLV2_PROJECTS_DIR}/${id}"
      ;;
  esac
  [ -d "$dir" ] || return 1

  if [ "$id" != "global" ]; then
    # The root feeds CLV2_OBSERVER_SENTINEL_FILE; it must still be a directory,
    # and still a repository with its own .git/config file (see the store side).
    [ -n "$root" ] && [ -d "$root" ] || return 1
    [ -f "${root}/.git/config" ] || return 1
    _clv2_project_cache_same_root "$root" || return 1
    # Settings in the repository's own config (core.worktree moves the root,
    # a remote changes the id) are trusted only while the entry is strictly
    # newer than that file. Equal timestamps count as stale so a change in the
    # same clock tick is not missed on filesystems with coarse mtimes.
    [ "$file" -nt "${root}/.git/config" ] || return 1
    # The id is derived from the origin, so the entry is trusted only while
    # git reports the same origin that detection read when it wrote the entry.
    # A repository without an origin stores an empty line and must still have
    # none. Without git the origin cannot be confirmed, so nothing is trusted.
    command -v git >/dev/null 2>&1 || return 1
    local live
    live=$(git -C "$root" remote get-url origin 2>/dev/null || true)
    _clv2_project_cache_remote "$live"
    [ "$_CLV2_PROJECT_CACHE_REMOTE" = "$remote" ] || return 1
  fi

  _CLV2_PROJECT_ID="$id"
  _CLV2_PROJECT_NAME="$name"
  _CLV2_PROJECT_ROOT="$root"
  _CLV2_PROJECT_DIR="$dir"
  _CLV2_PROJECT_CACHE_HIT=1
  return 0
}

_clv2_project_cache_store() {
  local file="$_CLV2_PROJECT_CACHE_FILE"
  [ -n "$file" ] || return 0

  # "global" reached by fallthrough (no repository found) is not cached, so a
  # directory that becomes a repository later is picked up on the next call.
  # An explicit CLV2_NO_PROJECT=1 is part of the key and is safe to cache.
  if [ "$_CLV2_PROJECT_ID" = "global" ] && [ "${CLV2_NO_PROJECT:-0}" != "1" ]; then
    return 0
  fi

  case "${_CLV2_PROJECT_NAME}${_CLV2_PROJECT_ROOT}" in *$'\n'*|*$'\r'*) return 0 ;; esac

  local remote=""
  if [ "$_CLV2_PROJECT_ID" != "global" ]; then
    # A project is cached only when it is a repository with its own .git
    # directory. Linked worktrees and submodules (.git is a file; their id can
    # also depend on the main worktree) and non-git CLAUDE_PROJECT_DIR roots
    # are detected on every call, as before.
    [ -n "$_CLV2_PROJECT_ROOT" ] && [ -f "${_CLV2_PROJECT_ROOT}/.git/config" ] || return 0
    _clv2_project_cache_remote "$_CLV2_PROJECT_REMOTE_SEEN"
    remote="$_CLV2_PROJECT_CACHE_REMOTE"
    # The entry is line-based; an origin that spans lines cannot be stored.
    case "$remote" in *$'\n'*|*$'\r'*) return 0 ;; esac
  fi

  local dir="${file%/*}"
  local tmp="${file}.$$"
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir" 2>/dev/null || return 0
  fi

  # Write then rename so a concurrent reader never sees a partial entry.
  if printf '%s\n' \
    "$_CLV2_PROJECT_CACHE_VERSION" \
    "$_CLV2_PROJECT_CACHE_DAY" \
    "$_CLV2_PROJECT_CACHE_KEY" \
    "$_CLV2_PROJECT_ID" \
    "$_CLV2_PROJECT_NAME" \
    "$_CLV2_PROJECT_ROOT" \
    "$remote" > "$tmp" 2>/dev/null; then
    mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
  fi
  return 0
}

# Auto-detect on source
if _clv2_project_cache_prepare && _clv2_project_cache_load; then
  :
else
  _clv2_detect_project
  _clv2_project_cache_store
fi

# Convenience aliases for callers (short names pointing to prefixed vars)
PROJECT_ID="$_CLV2_PROJECT_ID"
PROJECT_NAME="$_CLV2_PROJECT_NAME"
PROJECT_ROOT="$_CLV2_PROJECT_ROOT"
PROJECT_DIR="$_CLV2_PROJECT_DIR"

if [ -n "$PROJECT_ROOT" ]; then
  CLV2_OBSERVER_SENTINEL_FILE="${PROJECT_ROOT}/.observer.lock"
else
  CLV2_OBSERVER_SENTINEL_FILE="${PROJECT_DIR}/.observer.lock"
fi
export CLV2_OBSERVER_SENTINEL_FILE
