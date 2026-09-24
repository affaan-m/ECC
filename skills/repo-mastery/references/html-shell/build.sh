#!/usr/bin/env bash
# Assemble the course into a single index.html.
# Usage: run from the course directory →  bash build.sh
set -euo pipefail
cat _base.html modules/*.html _footer.html > index.html
echo "Built index.html ($(wc -c < index.html) bytes) — open it in a browser."
