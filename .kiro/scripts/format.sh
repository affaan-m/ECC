#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Format — auto-format a file using detected formatter
# Detects: biome or prettier
# Used by: .kiro/hooks/auto-format.json (fileEdited)
# ─────────────────────────────────────────────────────────────

set -o pipefail

# ── Validate input ───────────────────────────────────────────
if [ -z "$1" ]; then
  echo "Usage: format.sh <file>"
  echo "Example: format.sh src/index.ts"
  exit 1
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
  echo "Error: File not found: $FILE"
  exit 1
fi

# ── Detect formatter ─────────────────────────────────────────
detect_formatter() {
  if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
    echo "biome"
  elif [ -f ".prettierrc" ] || [ -f ".prettierrc.js" ] || [ -f ".prettierrc.json" ] || [ -f ".prettierrc.yml" ] || [ -f "prettier.config.js" ] || [ -f "prettier.config.mjs" ]; then
    echo "prettier"
  elif command -v biome &>/dev/null; then
    echo "biome"
  elif command -v prettier &>/dev/null; then
    echo "prettier"
  else
    echo "none"
  fi
}

FORMATTER=$(detect_formatter)

# ── Format file ──────────────────────────────────────────────
case "$FORMATTER" in
  biome)
    if command -v npx &>/dev/null; then
      echo "Formatting $FILE with Biome..."
      npx biome format --write "$FILE"
      exit $?
    else
      echo "Error: npx not found (required for Biome)"
      exit 1
    fi
    ;;
  
  prettier)
    if command -v npx &>/dev/null; then
      echo "Formatting $FILE with Prettier..."
      npx prettier --write "$FILE"
      exit $?
    else
      echo "Error: npx not found (required for Prettier)"
      exit 1
    fi
    ;;
  
  none)
    echo "No formatter detected (biome.json, .prettierrc, or installed formatter)"
    echo "Skipping format for: $FILE"
    exit 0
    ;;
esac
