#!/usr/bin/env bash
# scan-skills.sh — enumerate skill files, extract frontmatter and UTC mtime
# Usage: scan-skills.sh [CWD_SKILLS_DIR]
# Output: JSON to stdout
#
# When CWD_SKILLS_DIR is omitted, defaults to $PWD/.claude/skills so the
# script always picks up project-level skills without relying on the caller.
#
# Environment:
#   RULES_DISTILL_GLOBAL_DIR   Override ~/.claude/skills (for testing only;
#                              do not set in production — intended for bats tests)
#   RULES_DISTILL_PROJECT_DIR  Override project dir detection (for testing only)

set -euo pipefail

GLOBAL_DIR="${RULES_DISTILL_GLOBAL_DIR:-$HOME/.claude/skills}"
CWD_SKILLS_DIR="${RULES_DISTILL_PROJECT_DIR:-${1:-$PWD/.claude/skills}}"
# Validate CWD_SKILLS_DIR looks like a .claude/skills path (defense-in-depth).
# Only warn when the path exists — a nonexistent path poses no traversal risk.
if [[ -n "$CWD_SKILLS_DIR" && -d "$CWD_SKILLS_DIR" && "$CWD_SKILLS_DIR" != */.claude/skills* ]]; then
  echo "Warning: CWD_SKILLS_DIR does not look like a .claude/skills path: $CWD_SKILLS_DIR" >&2
fi

# Extract a frontmatter field (handles both quoted and unquoted single-line values).
# Does NOT support multi-line YAML blocks (| or >) or nested YAML keys.
extract_field() {
  local file="$1" field="$2"
  awk -v f="$field" '
    BEGIN { fm=0 }
    /^---$/ { fm++; next }
    fm==1 {
      n = length(f) + 2
      if (substr($0, 1, n) == f ": ") {
        val = substr($0, n+1)
        gsub(/^"/, "", val)
        gsub(/"$/, "", val)
        print val
        exit
      }
    }
    fm>=2 { exit }
  ' "$file"
}

# Get file mtime in UTC ISO8601 (portable: GNU and BSD)
get_mtime() {
  local file="$1"
  local secs
  secs=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null) || return 1
  date -u -d "@$secs" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
  date -u -r "$secs" +%Y-%m-%dT%H:%M:%SZ
}

# Bash-3.2-compatible recursive discovery. Avoids `find | sort` on
# AppLocker-hardened Windows and avoids Bash 4's globstar on stock macOS.
discovered_files=()
collect_skill_files() {
  local dir="$1"
  local entry
  for entry in "$dir"/..?* "$dir"/.[!.]* "$dir"/*; do
    [[ -e "$entry" || -L "$entry" ]] || continue
    if [[ -d "$entry" && ! -L "$entry" ]]; then
      collect_skill_files "$entry"
    elif [[ -f "$entry" && "${entry##*/}" == "SKILL.md" ]]; then
      discovered_files+=("$entry")
    fi
  done
}

sort_discovered_files() {
  local sort_index sort_cursor sort_value
  for ((sort_index = 1; sort_index < ${#discovered_files[@]}; sort_index += 1)); do
    sort_value="${discovered_files[$sort_index]}"
    sort_cursor=$((sort_index - 1))
    while ((sort_cursor >= 0)) && [[ "${discovered_files[$sort_cursor]}" > "$sort_value" ]]; do
      discovered_files[$((sort_cursor + 1))]="${discovered_files[$sort_cursor]}"
      sort_cursor=$((sort_cursor - 1))
    done
    discovered_files[$((sort_cursor + 1))]="$sort_value"
  done
}

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

# Scan a directory and produce a JSON array of skill objects
scan_dir_to_json() {
  local dir="$1"

  local tmpdir
  tmpdir=$(mktemp -d)
  local _scan_tmpdir="$tmpdir"
  _scan_cleanup() { rm -rf "$_scan_tmpdir"; }
  trap _scan_cleanup RETURN

  discovered_files=()
  collect_skill_files "$dir"
  sort_discovered_files

  local i=0
  local file
  local file_index
  for ((file_index = 0; file_index < ${#discovered_files[@]}; file_index += 1)); do
    file="${discovered_files[$file_index]}"
    local name desc mtime dp fname
    name=$(extract_field "$file" "name")
    desc=$(extract_field "$file" "description")
    mtime=$(get_mtime "$file")
    dp="${file/#$HOME/~}"

    # Zero-pad so the later "$tmpdir"/*.json glob keeps insertion order past 9
    # files (unpadded, 10.json sorts before 2.json lexicographically).
    printf -v fname '%06d.json' "$i"
    jq -n \
      --arg path "$dp" \
      --arg name "$name" \
      --arg description "$desc" \
      --arg mtime "$mtime" \
      '{path:$path,name:$name,description:$description,mtime:$mtime}' \
      > "$tmpdir/$fname"
    i=$((i+1))
  done
  stream_json_files "$tmpdir" | jq -s '.'
}

# --- Main ---

global_found="false"
global_count=0
global_skills="[]"

if [[ -d "$GLOBAL_DIR" ]]; then
  global_found="true"
  global_skills=$(scan_dir_to_json "$GLOBAL_DIR")
  global_count=$(echo "$global_skills" | jq 'length')
fi

project_found="false"
project_path=""
project_count=0
project_skills="[]"

if [[ -n "$CWD_SKILLS_DIR" && -d "$CWD_SKILLS_DIR" ]]; then
  project_found="true"
  project_path="$CWD_SKILLS_DIR"
  project_skills=$(scan_dir_to_json "$CWD_SKILLS_DIR")
  project_count=$(echo "$project_skills" | jq 'length')
fi

# Stream arrays on stdin: this works with native Windows jq and cannot exceed
# the operating system's command-line argument limit.
printf '%s\n%s\n' "$global_skills" "$project_skills" | jq -s \
  --arg global_found "$global_found" \
  --argjson global_count "$global_count" \
  --arg project_found "$project_found" \
  --arg project_path "$project_path" \
  --argjson project_count "$project_count" \
  '{
    scan_summary: {
      global: { found: ($global_found == "true"), count: $global_count },
      project: { found: ($project_found == "true"), path: $project_path, count: $project_count }
    },
    skills: (.[0] + .[1])
  }'
