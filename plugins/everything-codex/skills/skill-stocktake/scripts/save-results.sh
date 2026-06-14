#!/usr/bin/env bash
# save-results.sh — merge evaluated skills into results.json with correct UTC timestamp
# Usage: save-results.sh RESULTS_JSON <<< "$EVAL_JSON"
#
# stdin format:
#   { "skills": {...}, "mode"?: "full"|"quick", "batch_progress"?: {...} }
#
# Always sets evaluated_at to current UTC time via `date -u`.
# Merges stdin .skills into existing results.json (new entries override old).
# Optionally updates .mode and .batch_progress if present in stdin.

set -euo pipefail

RESULTS_JSON="${1:-}"

if [[ -z "$RESULTS_JSON" ]]; then
  echo "Error: RESULTS_JSON argument required" >&2
  echo "Usage: save-results.sh RESULTS_JSON <<< \"\$EVAL_JSON\"" >&2
  exit 1
fi

EVALUATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Read eval results from stdin and validate JSON before touching the results file
input_json=$(cat)
if ! echo "$input_json" | jq empty 2>/dev/null; then
  echo "Error: stdin is not valid JSON" >&2
  exit 1
fi

if [[ ! -f "$RESULTS_JSON" ]]; then
  # Bootstrap: create new results.json from stdin JSON + current UTC timestamp
  echo "$input_json" | jq --arg ea "$EVALUATED_AT" \
    '. + { evaluated_at: $ea }' > "$RESULTS_JSON"
  exit 0
fi

# Merge: new .skills override existing ones; old skills not in input_json are kept.
# Optionally update .mode and .batch_progress if provided.
#
# Use mktemp for a collision-safe temp file (concurrent runs on the same RESULTS_JSON
# would race on a predictable ".tmp" suffix; random suffix prevents silent overwrites).
tmp=$(mktemp "${RESULTS_JSON}.XXXXXX")
trap 'rm -f "$tmp"' EXIT

jq -s \
  --arg ea "$EVALUATED_AT" \
  '.[0] as $existing | .[1] as $new |
   $existing |
   .evaluated_at = $ea |
   .skills = ($existing.skills + ($new.skills // {})) |
   if ($new | has("mode")) then .mode = $new.mode else . end |
   if ($new | has("batch_progress")) then .batch_progress = $new.batch_progress else . end' \
  "$RESULTS_JSON" <(echo "$input_json") > "$tmp"

mv "$tmp" "$RESULTS_JSON"
