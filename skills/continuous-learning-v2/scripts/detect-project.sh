#!/bin/bash
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

# shellcheck disable=SC1091
. "$(dirname "${BASH_SOURCE[0]}")/lib/homunculus-dir.sh"
_CLV2_HOMUNCULUS_DIR="$(_ecc_resolve_homunculus_dir)"
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

_CLV2_PYTHON_CMD="$(_clv2_resolve_python_cmd 2>/dev/null || true)"
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

  # 1. Try CLAUDE_PROJECT_DIR env var
  if [ -n "$CLAUDE_PROJECT_DIR" ] && [ -d "$CLAUDE_PROJECT_DIR" ] && command -v git &>/dev/null; then
    project_root=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$project_root" ]; then
      source_hint="env"
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

# Auto-detect on source
_clv2_detect_project

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
