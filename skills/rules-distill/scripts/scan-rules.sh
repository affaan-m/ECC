#!/usr/bin/env bash
# scan-rules.sh — enumerate rule files and extract H2 heading index
# Usage: scan-rules.sh [RULES_DIR]
# Output: JSON to stdout
#
# Environment:
#   RULES_DISTILL_DIR  Override ~/.claude/rules (for testing only)

set -euo pipefail

RULES_DIR="${RULES_DISTILL_DIR:-${1:-$HOME/.claude/rules}}"

if [[ ! -d "$RULES_DIR" ]]; then
  jq -n --arg path "$RULES_DIR" '{"error":"rules directory not found","path":$path}' >&2
  exit 1
fi

# Collect all .md files (excluding _archived/)
# Bash globstar instead of `find | sort`: AppLocker-hardened machines shim
# find/sort (silent-empty on GNU flags), and glob expansion is already
# lexicographically sorted with no external processes.
shopt -s globstar nullglob
files=()
for f in "$RULES_DIR"/**/*.md; do
  [[ -f "$f" ]] || continue
  [[ "$f" == */_archived/* ]] && continue
  files+=("$f")
done
shopt -u globstar nullglob

total=${#files[@]}

tmpdir=$(mktemp -d)
_rules_cleanup() { rm -rf "$tmpdir"; }
trap _rules_cleanup EXIT

for i in "${!files[@]}"; do
  file="${files[$i]}"
  rel_path="${file#"$HOME"/}"
  rel_path="~/$rel_path"

  # Extract H2 headings (## Title) into a JSON array via jq
  headings_json=$({ grep -E '^## ' "$file" 2>/dev/null || true; } | sed 's/^## //' | jq -R . | jq -s '.')

  # Get line count
  line_count=$(wc -l < "$file" | tr -d ' ')

  # Zero-pad so the later "$tmpdir"/*.json glob keeps insertion order past 9
  # files (unpadded, 10.json sorts before 2.json lexicographically).
  printf -v fname '%06d.json' "$i"
  jq -n \
    --arg path "$rel_path" \
    --arg file "$(basename "$file")" \
    --argjson lines "$line_count" \
    --argjson headings "$headings_json" \
    '{path:$path,file:$file,lines:$lines,headings:$headings}' \
    > "$tmpdir/$fname"
done

if [[ ${#files[@]} -eq 0 ]]; then
  jq -n --arg dir "$RULES_DIR" '{rules_dir:$dir,total:0,rules:[]}'
else
  jq -n \
    --arg dir "$RULES_DIR" \
    --argjson total "$total" \
    --argjson rules "$(jq -s '.' "$tmpdir"/*.json)" \
    '{rules_dir:$dir,total:$total,rules:$rules}'
fi
