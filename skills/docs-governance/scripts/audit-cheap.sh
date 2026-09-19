#!/usr/bin/env bash
# Cheap governance layer: fail fast on deterministic integrity errors; leave semantic judgment to docs-auditor.
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${DOCS_GOVERNANCE_ROOT:-$PWD}"
SCOPE="${1:-full}"

case "$SCOPE" in
  spine|context|adr|artifacts|full) ;;
  *)
    echo "Usage: bash audit-cheap.sh [spine|context|adr|artifacts|full]"
    exit 2
    ;;
esac

python3 "$PLUGIN_ROOT/scripts/audit-docs.py" --root "$TARGET_ROOT" --scope "$SCOPE"
