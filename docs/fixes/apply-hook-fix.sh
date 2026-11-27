#!/usr/bin/env bash
# Apply ECC hook fix to ~/.claude/settings.local.json.
#
# - Creates a timestamped backup next to the original.
# - Rewrites the file as UTF-8 (no BOM), LF line endings.
# - Routes hook commands directly at observe-wrapper.sh with a "pre"/"post" arg.
#
# Related fix doc: docs/fixes/HOOK-FIX-20260421.md

set -euo pipefail

TARGET="${1:-$HOME/.claude/settings.local.json}"
WRAPPER="${ECC_OBSERVE_WRAPPER:-$HOME/.claude/skills/continuous-learning/hooks/observe-wrapper.sh}"

if [ ! -f "$WRAPPER" ]; then
  echo "[hook-fix] wrapper not found: $WRAPPER" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"

if [ -f "$TARGET" ]; then
  ts="$(date +%Y%m%d-%H%M%S)"
  cp "$TARGET" "$TARGET.bak-hookfix-$ts"
  echo "[hook-fix] backup: $TARGET.bak-hookfix-$ts"
fi

# Convert wrapper path to forward-slash form for JSON.
wrapper_fwd="$(printf '%s' "$WRAPPER" | tr '\\\\' '/')"

# Write the new config as UTF-8 (no BOM), LF line endings.
printf '%s\n' '{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "'"$wrapper_fwd"' pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "'"$wrapper_fwd"' post"
          }
        ]
      }
    ]
  }
}' > "$TARGET"

echo "[hook-fix] wrote: $TARGET"
echo "[hook-fix] restart the claude CLI for changes to take effect"
