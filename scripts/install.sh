#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "${REPO_ROOT}/scripts/lib/common.sh"

TARGET="all"
TARGET_EXPLICIT=false
PASS_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)   TARGET="${2:?--target requires a value}"; TARGET_EXPLICIT=true; shift 2 ;;
        --target=*) TARGET="${1#--target=}"; TARGET_EXPLICIT=true; shift ;;
        *)          PASS_ARGS+=("$1"); shift ;;
    esac
done

usage_dispatcher() {
    cat <<EOF
Usage: $(basename "$0") [--target claude|codex|all] [OPTIONS] <language>...

Targets:
  claude   Install to ~/.claude (default components)
  codex    Install shared content to ~/.codex (AGENTS.md, instructions, skills, MCP)
  all      Both (default; codex skipped when not detected)

Target-specific options follow below.
EOF
}

# When no explicit --target was given and -h is requested, surface the
# dispatcher's own usage (which documents --target) before falling through
# to the claude target's usage, instead of silently defaulting to "all" and
# potentially printing two concatenated usage blocks (claude + codex).
if ! $TARGET_EXPLICIT; then
    for arg in "${PASS_ARGS[@]:-}"; do
        if [[ "$arg" == "-h" ]]; then
            usage_dispatcher
            echo ""
            exec "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}"
        fi
    done
fi

case "$TARGET" in
    claude) exec "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}" ;;
    codex) exec "${REPO_ROOT}/targets/codex/install.sh" "${PASS_ARGS[@]:-}" ;;
    all)
        "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}"
        if codex_is_available; then
            "${REPO_ROOT}/targets/codex/install.sh" "${PASS_ARGS[@]:-}"
        else
            log_info "Codex not detected; skipping codex target"
        fi
        ;;
    *)
        echo -e "${RED}Error: Unknown target '${TARGET}' (expected claude, codex, or all)${NC}"
        exit 1
        ;;
esac
