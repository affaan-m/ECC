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

# Collect markdown files recursively without `find`, `sort`, or Bash 4's
# globstar. A small in-process insertion sort preserves the full-path ordering
# that the previous external `sort` supplied.
files=()
collect_rule_files() {
  local dir="$1"
  local entry
  for entry in "$dir"/..?* "$dir"/.[!.]* "$dir"/*; do
    [[ -e "$entry" || -L "$entry" ]] || continue
    if [[ -d "$entry" && ! -L "$entry" ]]; then
      [[ "${entry##*/}" == "_archived" ]] && continue
      collect_rule_files "$entry"
    elif [[ -f "$entry" && "$entry" == *.md ]]; then
      files+=("$entry")
    fi
  done
}
collect_rule_files "$RULES_DIR"
for ((sort_index = 1; sort_index < ${#files[@]}; sort_index += 1)); do
  sort_value="${files[$sort_index]}"
  sort_cursor=$((sort_index - 1))
  while ((sort_cursor >= 0)) && [[ "${files[$sort_cursor]}" > "$sort_value" ]]; do
    files[$((sort_cursor + 1))]="${files[$sort_cursor]}"
    sort_cursor=$((sort_cursor - 1))
  done
  files[$((sort_cursor + 1))]="$sort_value"
done

tmpdir=$(mktemp -d)
_rules_cleanup() { rm -rf "$tmpdir"; }
trap _rules_cleanup EXIT

for ((i = 0; i < ${#files[@]}; i += 1)); do
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

stream_json_files() {
  local dir="$1"
  local json_file line
  for json_file in "$dir"/*.json; do
    [[ -f "$json_file" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      printf '%s\n' "$line"
    done < "$json_file"
  done
}

stream_json_files "$tmpdir" |
  jq -s --arg dir "$RULES_DIR" '{rules_dir:$dir,total:length,rules:.}'
