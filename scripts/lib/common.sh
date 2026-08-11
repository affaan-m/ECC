#!/usr/bin/env bash
set -euo pipefail
# Shared helpers for install/uninstall scripts.
# Callers must set REPO_ROOT before sourcing, and FORCE/DRY_RUN before
# calling copy_*/remove_* functions.
CONTENT_ROOT="${REPO_ROOT}/content"

CLAUDE_DIR="${HOME}/.claude"
CODEX_DIR="${CODEX_HOME:-${HOME}/.codex}"
CATEGORIES=(agents skills commands rules)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

copied=0
skipped=0
removed=0
not_found=0

# Discover available languages from directory structure
discover_languages() {
    local -A seen
    for cat in "${CATEGORIES[@]}" hooks; do
        local cat_dir="${CONTENT_ROOT:-$REPO_ROOT}/${cat}"
        [[ -d "$cat_dir" ]] || continue
        for dir in "$cat_dir"/*/; do
            [[ -d "$dir" ]] || continue
            local name
            name=$(basename "$dir")
            [[ "$name" == .* ]] && continue
            seen["$name"]=1
        done
    done
    echo "${!seen[@]}" | tr ' ' '\n' | sort
}

log_copy() { echo -e "  ${GREEN}COPY${NC}  $1 → $2"; }
log_skip() { echo -e "  ${YELLOW}SKIP${NC}  $1 (already exists, use -f to overwrite)"; }
log_dry()  { echo -e "  ${CYAN}DRY${NC}   $1 → $2"; }
log_dry_rm() { echo -e "  ${CYAN}DRY${NC}   $1"; }
log_info() { echo -e "  ${CYAN}INFO${NC}  $1"; }
log_warn() { echo -e "  ${RED}WARN${NC}  $1"; }
log_rm()       { echo -e "  ${RED}RM${NC}    $1"; }
log_not_found() { echo -e "  ${YELLOW}MISS${NC}  $1 (not installed)"; }

codex_agents_label() {
    if [[ -n "${CODEX_HOME:-}" ]]; then
        echo "${CODEX_DIR}/AGENTS.md"
    else
        echo "~/.codex/AGENTS.md"
    fi
}

codex_is_available() {
    [[ -n "${CODEX_HOME:-}" ]] || [[ -d "$CODEX_DIR" ]] || command -v codex &>/dev/null
}

# Copy a single file
copy_file() {
    local src="$1" dest="$2" label_src="$3" label_dest="$4"

    if $DRY_RUN; then
        log_dry "$label_src" "$label_dest"
        copied=$((copied + 1))
        return
    fi

    if [[ -f "$dest" ]] && ! $FORCE; then
        log_skip "$label_dest"
        skipped=$((skipped + 1))
    else
        cp "$src" "$dest"
        log_copy "$label_src" "$label_dest"
        copied=$((copied + 1))
    fi
}

# Copy a single file with ${CLAUDE_PLUGIN_ROOT} substitution
copy_file_subst() {
    local src="$1" dest="$2" label_src="$3" label_dest="$4"

    if $DRY_RUN; then
        log_dry "$label_src" "$label_dest"
        copied=$((copied + 1))
        return
    fi

    if [[ -f "$dest" ]] && ! $FORCE; then
        log_skip "$label_dest"
        skipped=$((skipped + 1))
    else
        local content
        content=$(cat "$src")
        content="${content//\$\{CLAUDE_PLUGIN_ROOT\}/$CLAUDE_DIR}"
        echo "$content" > "$dest"
        log_copy "$label_src" "$label_dest"
        copied=$((copied + 1))
    fi
}

# Copy a directory recursively
copy_dir() {
    local src="$1" dest="$2" label_src="$3" label_dest="$4"

    if $DRY_RUN; then
        log_dry "$label_src" "$label_dest"
        copied=$((copied + 1))
        return
    fi

    if [[ -d "$dest" ]] && ! $FORCE; then
        log_skip "$label_dest"
        skipped=$((skipped + 1))
    else
        # Copy directory *contents* so a force-reinstall overlays the existing
        # destination instead of nesting a copy inside it (cp -r src dest with
        # an existing dest creates dest/src-name/).
        mkdir -p "$dest"
        cp -r "$src"/. "$dest"/
        log_copy "$label_src" "$label_dest"
        copied=$((copied + 1))
    fi
}

# Remove a single file
remove_file() {
    local target="$1" label="$2"

    if $DRY_RUN; then
        if [[ -f "$target" ]]; then
            log_dry_rm "$label"
            removed=$((removed + 1))
        else
            log_not_found "$label"
            not_found=$((not_found + 1))
        fi
        return
    fi

    if [[ -f "$target" ]]; then
        rm "$target"
        log_rm "$label"
        removed=$((removed + 1))
    else
        log_not_found "$label"
        not_found=$((not_found + 1))
    fi
}

# Remove a directory recursively
remove_dir() {
    local target="$1" label="$2"

    if $DRY_RUN; then
        if [[ -d "$target" ]]; then
            log_dry_rm "$label"
            removed=$((removed + 1))
        else
            log_not_found "$label"
            not_found=$((not_found + 1))
        fi
        return
    fi

    if [[ -d "$target" ]]; then
        rm -r "$target"
        log_rm "$label"
        removed=$((removed + 1))
    else
        log_not_found "$label"
        not_found=$((not_found + 1))
    fi
}

# Remove empty directory if it exists
cleanup_empty_dir() {
    local dir="$1" label="$2"
    if ! $DRY_RUN && [[ -d "$dir" ]]; then
        if [[ -z "$(ls -A "$dir" 2>/dev/null)" ]]; then
            rmdir "$dir"
            echo -e "  ${YELLOW}RMDIR${NC} ${label} (empty)"
        fi
    fi
}
