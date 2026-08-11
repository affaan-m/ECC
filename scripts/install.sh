#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "${REPO_ROOT}/scripts/lib/common.sh"

TARGET="all"
PASS_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target)   TARGET="${2:?--target requires a value}"; shift 2 ;;
        --target=*) TARGET="${1#--target=}"; shift ;;
        *)          PASS_ARGS+=("$1"); shift ;;
    esac
done

# TODO(task-6): remove the `-x targets/codex/install.sh` guards once
# targets/codex/install.sh lands; until then keep the dispatcher functional.
case "$TARGET" in
    claude) exec "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}" ;;
    codex)
        if [[ -x "${REPO_ROOT}/targets/codex/install.sh" ]]; then
            exec "${REPO_ROOT}/targets/codex/install.sh" "${PASS_ARGS[@]:-}"
        else
            log_info "codex target not yet implemented"
        fi
        ;;
    all)
        "${REPO_ROOT}/targets/claude/install.sh" "${PASS_ARGS[@]:-}"
        if codex_is_available; then
            if [[ -x "${REPO_ROOT}/targets/codex/install.sh" ]]; then
                "${REPO_ROOT}/targets/codex/install.sh" "${PASS_ARGS[@]:-}"
            else
                log_info "codex target not yet implemented"
            fi
        else
            log_info "Codex not detected; skipping codex target"
        fi
        ;;
    *)
        echo -e "${RED}Error: Unknown target '${TARGET}' (expected claude, codex, or all)${NC}"
        exit 1
        ;;
esac
