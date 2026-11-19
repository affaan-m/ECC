#!/usr/bin/env bash
# install-continue.sh — install ECC into the Continue CLI (`cn`).
#
#   ./install-continue.sh                         # global install, core skills
#   ./install-continue.sh --langs python,typescript --skills developer
#   ./install-continue.sh --help
#
# See CONTINUE-CLI.md. All options are passed to scripts/install-continue.js.

if ! (eval '[[ 1 == 1 ]]' >/dev/null 2>&1); then
    exec bash "$0" "$@"
fi

set -euo pipefail

SCRIPT_PATH="$0"
while [ -L "$SCRIPT_PATH" ]; do
    link_dir="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
    SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
    [[ "$SCRIPT_PATH" != /* ]] && SCRIPT_PATH="$link_dir/$SCRIPT_PATH"
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "[ECC] Node.js 18+ is required (https://nodejs.org)." >&2
    exit 1
fi

# SECURITY: --ignore-scripts blocks install-time scripts from dependencies.
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[ECC] Installing dependencies..."
    (cd "$SCRIPT_DIR" && npm install --ignore-scripts --no-audit --no-fund --loglevel=error)
fi

if ! command -v cn >/dev/null 2>&1; then
    echo "[ECC] Note: the Continue CLI is not on PATH yet. Install it with: npm i -g @continuedev/cli"
fi

if command -v cygpath >/dev/null 2>&1; then
    NODE_SCRIPT="$(cygpath -w "$SCRIPT_DIR/scripts/install-continue.js")"
else
    NODE_SCRIPT="$SCRIPT_DIR/scripts/install-continue.js"
fi

exec node "$NODE_SCRIPT" "$@"
