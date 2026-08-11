#!/usr/bin/env bash
# 治理审计便宜层：确定性断链先判，失败短路；语义问题留给 docs-auditor。
set -uo pipefail

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${DOCS_GOVERNANCE_ROOT:-$PWD}"
SCOPE="${1:-full}"

case "$SCOPE" in
  spine|context|adr|artifacts|full) ;;
  *)
    echo "用法：bash audit-cheap.sh [spine|context|adr|artifacts|full]"
    exit 2
    ;;
esac

python3 "$PLUGIN_ROOT/scripts/audit-docs.py" --root "$TARGET_ROOT" --scope "$SCOPE"
