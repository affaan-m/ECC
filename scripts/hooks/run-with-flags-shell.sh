#!/usr/bin/env bash
set -euo pipefail

HOOK_ID="${1:-}"
REL_SCRIPT_PATH="${2:-}"
PROFILES_CSV="${3:-standard,strict}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

# Preserve stdin for passthrough or script execution
INPUT="$(cat)"

if [[ -z "$HOOK_ID" || -z "$REL_SCRIPT_PATH" ]]; then
  printf '%s' "$INPUT"
  exit 0
fi

# Ask Node helper if this hook is enabled
ENABLED="$(node "${PLUGIN_ROOT}/scripts/hooks/check-hook-enabled.js" "$HOOK_ID" "$PROFILES_CSV" 2>/dev/null || echo yes)"
if [[ "$ENABLED" != "yes" ]]; then
  printf '%s' "$INPUT"
  exit 0
fi

# Reject traversal / absolute / env-escape paths before touching the filesystem.
# Mirrors the containment check in run-with-flags.js (resolvedRoot prefix).
case "$REL_SCRIPT_PATH" in
  /*|\\*|~*|*..*|*\$*|*\`*|*\|*|*\;*|*\&*|*\<*|*\>*|*\"*|*\'*|*\ *|*" "*)
    echo "[Hook] Path traversal rejected for ${HOOK_ID}: ${REL_SCRIPT_PATH}" >&2
    printf '%s' "$INPUT"
    exit 0
    ;;
esac

# Canonicalize PLUGIN_ROOT (CLAUDE_PLUGIN_ROOT is env-controlled) and the
# candidate script path, then enforce containment inside the plugin root.
PLUGIN_ROOT_CANON="$(realpath -m "$PLUGIN_ROOT" 2>/dev/null || readlink -f "$PLUGIN_ROOT" 2>/dev/null || printf '%s' "$PLUGIN_ROOT")"
SCRIPT_PATH="${PLUGIN_ROOT_CANON}/${REL_SCRIPT_PATH}"
SCRIPT_CANON="$(realpath -m "$SCRIPT_PATH" 2>/dev/null || readlink -f "$SCRIPT_PATH" 2>/dev/null || printf '%s' "$SCRIPT_PATH")"
case "$SCRIPT_CANON" in
  "$PLUGIN_ROOT_CANON"/*) ;;
  *)
    echo "[Hook] Path traversal rejected for ${HOOK_ID}: ${REL_SCRIPT_PATH}" >&2
    printf '%s' "$INPUT"
    exit 0
    ;;
esac
if [[ ! -f "$SCRIPT_CANON" ]]; then
  echo "[Hook] Script not found for ${HOOK_ID}: ${SCRIPT_CANON}" >&2
  printf '%s' "$INPUT"
  exit 0
fi

# Extract phase prefix from hook ID (e.g., "pre:observe" -> "pre", "post:observe" -> "post")
# This is needed by scripts like observe.sh that behave differently for PreToolUse vs PostToolUse
HOOK_PHASE="${HOOK_ID%%:*}"

printf '%s' "$INPUT" | "$SCRIPT_CANON" "$HOOK_PHASE"
