#!/usr/bin/env bash
# save-results.sh — merge evaluated skills into results.json with correct UTC timestamp
# Usage: save-results.sh RESULTS_JSON [--replace] <<< "$EVAL_JSON"
#
# stdin format:
#   { "skills": {...}, "mode"?: "full"|"quick", "batch_progress"?: {...} }
#
# Always sets evaluated_at to current UTC time via `date -u`.
# By default, merges stdin .skills into results.json (new entries override old).
# Optionally updates .mode and .batch_progress if present in stdin.
# --replace starts a new full evaluation; subsequent chunks must use merge mode.

set -euo pipefail

RESULTS_JSON="${1:-}"
SAVE_MODE="${2:-}"

if [[ -z "$RESULTS_JSON" ]]; then
  echo "Error: RESULTS_JSON argument required" >&2
  echo "Usage: save-results.sh RESULTS_JSON [--replace] <<< \"\$EVAL_JSON\"" >&2
  exit 1
fi

if [[ $# -gt 2 || ( -n "$SAVE_MODE" && "$SAVE_MODE" != "--replace" ) ]]; then
  echo "Error: expected RESULTS_JSON [--replace]" >&2
  exit 1
fi

EVALUATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Read eval results from stdin and validate JSON before touching the results file
input_json=$(cat)
if ! echo "$input_json" | jq empty 2>/dev/null; then
  echo "Error: stdin is not valid JSON" >&2
  exit 1
fi

# A replacement must be one complete object, not empty input or a JSON stream.
# Validate before creating a temp file or changing the existing cache.
if [[ "$SAVE_MODE" == "--replace" ]] && ! echo "$input_json" | jq -e -s \
  'length == 1 and (.[0] | type == "object" and (.skills | type == "object"))' >/dev/null 2>&1; then
  echo "Error: --replace requires one JSON object with a skills object" >&2
  exit 1
fi

if [[ ! -f "$RESULTS_JSON" && "$SAVE_MODE" != "--replace" ]]; then
  # Bootstrap: create new results.json from stdin JSON + current UTC timestamp
  echo "$input_json" | jq --arg ea "$EVALUATED_AT" \
    '. + { evaluated_at: $ea }' > "$RESULTS_JSON"
  exit 0
fi

# Use mktemp for a collision-safe temp file (concurrent runs on the same RESULTS_JSON
# would race on a predictable ".tmp" suffix; random suffix prevents silent overwrites).
tmp=$(mktemp "${RESULTS_JSON}.XXXXXX")
trap 'rm -f "$tmp"' EXIT

if [[ "$SAVE_MODE" == "--replace" ]]; then
  echo "$input_json" | jq --arg ea "$EVALUATED_AT" \
    '. + { evaluated_at: $ea }' > "$tmp"
else
  # Keep previously evaluated skills during quick scans and full-run chunks.
  jq -s \
    --arg ea "$EVALUATED_AT" \
    '.[0] as $existing | .[1] as $new |
     $existing |
     .evaluated_at = $ea |
     .skills = ($existing.skills + ($new.skills // {})) |
     if ($new | has("mode")) then .mode = $new.mode else . end |
     if ($new | has("batch_progress")) then .batch_progress = $new.batch_progress else . end' \
    "$RESULTS_JSON" <(echo "$input_json") > "$tmp"
fi

mv "$tmp" "$RESULTS_JSON"
