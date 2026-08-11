#!/usr/bin/env bash
# Generate Codex AGENTS.md on stdout: the global instructions followed by an
# index of rules files installed under <dest-label>.
# Usage: build-agents-md.sh <dest-label> <lang>...
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTENT_ROOT="${REPO_ROOT}/content"

DEST_LABEL="${1:?usage: build-agents-md.sh <dest-label> <lang>...}"
shift

cat "${CONTENT_ROOT}/instructions/global.md"

echo ""
echo "## Rules Index"
echo ""
echo "Detailed rules are installed alongside this file."
echo "Read the matching file before working in that area:"
echo ""

for lang in "$@"; do
    rules_dir="${CONTENT_ROOT}/rules/${lang}"
    [[ -d "$rules_dir" ]] || continue
    for f in "$rules_dir"/*.md; do
        [[ -f "$f" ]] || continue
        name=$(basename "$f")
        title=$(grep -m1 '^# ' "$f" | sed 's/^# //' || true)
        echo "- \`${DEST_LABEL}/${name}\` — ${title:-$name} (${lang})"
    done
done
