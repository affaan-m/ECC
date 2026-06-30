#!/usr/bin/env bash
# One-time setup: build a local venv with the openai-codex SDK for the
# heterogeneous-review node. The skill calls check_codex.py and ask_codex.py
# from this venv. The .venv is gitignored, not committed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$HERE/.venv"
PY="${PYTHON:-python3}"
if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet openai-codex
echo "council-multi-model: venv ready at $VENV"
echo "Next: \"$VENV/bin/python\" \"$HERE/scripts/check_codex.py\" --probe"
