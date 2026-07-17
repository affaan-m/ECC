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
echo "Installing openai-codex==0.1.0b3 from PyPI (network access required)"
"$VENV/bin/python" -m pip install --disable-pip-version-check --quiet \
  "openai-codex==0.1.0b3"
echo "council-multi-model: venv ready at $VENV"
echo "Next: \"$VENV/bin/python\" \"$HERE/scripts/check_codex.py\" --probe"
