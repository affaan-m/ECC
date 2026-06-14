#!/usr/bin/env bash
# One-shot migration from the legacy Claude config tree into the
# continuous-learning-v2 data directory.
set -euo pipefail

OLD="${HOME}/.claude/homunculus"

# shellcheck disable=SC1091
. "$(dirname "$0")/lib/homunculus-dir.sh"
NEW="$(_ecc_resolve_homunculus_dir)"

if [ "$NEW" = "$OLD" ]; then
  echo "Resolved destination equals source ($OLD); nothing to migrate."
  exit 0
fi

if [ ! -d "$OLD" ]; then
  echo "Nothing to migrate (no $OLD)."
  exit 0
fi

if command -v pgrep >/dev/null 2>&1; then
  if pgrep -f "${HOME}.*observer-loop\\.sh" >/dev/null 2>&1; then
    echo "Refusing to migrate: observer-loop.sh is running." >&2
    echo "Exit all Claude Code sessions, then re-run." >&2
    exit 1
  fi
else
  echo "Warning: pgrep not available; skipping running-observer check." >&2
fi

mkdir -p "$(dirname "$NEW")"

if [ ! -d "$NEW" ]; then
  mv "$OLD" "$NEW"
  echo "Moved $OLD -> $NEW"
elif [ -z "$(ls -A "$NEW" 2>/dev/null || true)" ]; then
  rmdir "$NEW"
  mv "$OLD" "$NEW"
  echo "Moved $OLD -> $NEW (replaced empty destination)"
else
  old_count="$(find "$OLD" -type f 2>/dev/null | wc -l | tr -d ' ')"
  new_count="$(find "$NEW" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "Refusing to migrate: both paths exist with content." >&2
  echo "  Old: $OLD ($old_count files)" >&2
  echo "  New: $NEW ($new_count files)" >&2
  echo "Resolve manually, then re-run." >&2
  exit 1
fi

settings="${HOME}/.claude/settings.json"
if [ -f "$settings" ] && grep -q '"CLV2_CONFIG"' "$settings" 2>/dev/null; then
  if grep -q '\.claude/homunculus' "$settings" 2>/dev/null; then
    cat >&2 <<WARN

Advisory: ~/.claude/settings.json still sets CLV2_CONFIG under the old path.
Update it to: ${NEW}/config.json
(Not editing settings.json automatically.)

WARN
  fi
fi
