#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="${HOME}/.claude"
CATEGORIES=(agents skills commands rules)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

removed=0
not_found=0

# Discover available languages from directory structure
discover_languages() {
    local -A seen
    for cat in "${CATEGORIES[@]}" hooks; do
        local cat_dir="${REPO_ROOT}/${cat}"
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

usage() {
    local available
    available=$(discover_languages | tr '\n' ' ')

    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <language>...

Uninstall Claude Code configuration files from ~/.claude/

Available languages: ${available}

Categories removed:
  agents/    Agent definitions (.md)
  skills/    Skill knowledge bases (directories)
  commands/  Slash commands (.md)
  rules/     Rules and guidelines (.md)
  hooks/     Global hooks (settings.json) and project hook templates

Options:
  -n    Dry run (show what would be removed without removing)
  -l    List available languages and exit
  -h    Show this help

Examples:
  $(basename "$0") python common        # Remove Python and common configs
  $(basename "$0") node                  # Remove Node.js configs
  $(basename "$0") -n python node       # Preview what would be removed
EOF
}

log_rm()       { echo -e "  ${RED}RM${NC}    $1"; }
log_dry()      { echo -e "  ${CYAN}DRY${NC}   $1"; }
log_not_found() { echo -e "  ${YELLOW}MISS${NC}  $1 (not installed)"; }

# Remove a single file
remove_file() {
    local target="$1" label="$2"

    if $DRY_RUN; then
        if [[ -f "$target" ]]; then
            log_dry "$label"
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
            log_dry "$label"
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

# Parse options
DRY_RUN=false

while getopts "nlh" opt; do
    case $opt in
        n) DRY_RUN=true ;;
        l)
            echo "Available languages:"
            discover_languages | while read -r lang; do
                cats=""
                for cat in "${CATEGORIES[@]}" hooks; do
                    if [[ -d "${REPO_ROOT}/${cat}/${lang}" ]]; then
                        cats="${cats} ${cat}"
                    fi
                done
                printf "  %-10s →%s\n" "$lang" "$cats"
            done
            exit 0
            ;;
        h) usage; exit 0 ;;
        *) usage; exit 1 ;;
    esac
done
shift $((OPTIND - 1))

if [[ $# -eq 0 ]]; then
    echo -e "${RED}Error: At least one language must be specified${NC}"
    echo ""
    usage
    exit 1
fi

LANGUAGES=("$@")

# Validate languages
AVAILABLE_LANGS=$(discover_languages)
for lang in "${LANGUAGES[@]}"; do
    if ! echo "$AVAILABLE_LANGS" | grep -qx "$lang"; then
        echo -e "${RED}Error: Unknown language '${lang}'${NC}"
        echo "Available languages: $(echo "$AVAILABLE_LANGS" | tr '\n' ' ')"
        exit 1
    fi
done

# Header
if $DRY_RUN; then
    echo -e "${CYAN}Dry run: showing what would be removed${NC}"
fi
echo -e "Uninstalling: ${RED}${LANGUAGES[*]}${NC} from ${CLAUDE_DIR}/"
echo ""

# Remove global CLAUDE.md
global_claude="${REPO_ROOT}/global/CLAUDE.md"
if [[ -f "$global_claude" ]]; then
    echo -e "${CYAN}[global]${NC}"
    remove_file "${CLAUDE_DIR}/CLAUDE.md" "CLAUDE.md"

    # Also remove Codex AGENTS.md (~/.codex/AGENTS.md)
    CODEX_DIR="${CODEX_HOME:-${HOME}/.codex}"
    remove_file "${CODEX_DIR}/AGENTS.md" "~/.codex/AGENTS.md"
    cleanup_empty_dir "$CODEX_DIR" "~/.codex/"
    echo ""
fi

# Remove categories (agents, skills, commands, rules)
for category in "${CATEGORIES[@]}"; do
    has_files=false

    for lang in "${LANGUAGES[@]}"; do
        src_dir="${REPO_ROOT}/${category}/${lang}"
        [[ -d "$src_dir" ]] || continue

        dest_dir="${CLAUDE_DIR}/${category}"

        if [[ "$category" == "skills" ]]; then
            for skill_dir in "$src_dir"/*/; do
                [[ -d "$skill_dir" ]] || continue
                local_name=$(basename "$skill_dir")
                [[ "$local_name" == .* ]] && continue

                if ! $has_files; then
                    echo -e "${CYAN}[${category}]${NC}"
                    has_files=true
                fi

                remove_dir "${dest_dir}/${local_name}" "${category}/${local_name}/"
            done
        else
            for file in "$src_dir"/*.md; do
                [[ -f "$file" ]] || continue
                filename=$(basename "$file")

                if ! $has_files; then
                    echo -e "${CYAN}[${category}]${NC}"
                    has_files=true
                fi

                remove_file "${dest_dir}/${filename}" "${category}/${filename}"
            done
        fi
    done

    # Clean up empty category directory
    cleanup_empty_dir "${CLAUDE_DIR}/${category}" "${category}/"

    if $has_files; then
        echo ""
    fi
done

# Remove hook scripts (scripts/{lang}/hooks/ → ~/.claude/scripts/hooks/)
has_hook_scripts=false
for lang in "${LANGUAGES[@]}"; do
    scripts_dir="${REPO_ROOT}/scripts/${lang}/hooks"
    [[ -d "$scripts_dir" ]] || continue

    for script in "$scripts_dir"/*; do
        [[ -f "$script" ]] || continue
        filename=$(basename "$script")

        if ! $has_hook_scripts; then
            echo -e "${CYAN}[hook scripts]${NC}"
            has_hook_scripts=true
        fi

        remove_file "${CLAUDE_DIR}/scripts/hooks/${filename}" "scripts/hooks/${filename}"
    done
done

# Clean up empty scripts/hooks directory
cleanup_empty_dir "${CLAUDE_DIR}/scripts/hooks" "scripts/hooks/"

if $has_hook_scripts; then
    echo ""
fi

# Remove hook libraries (scripts/{lang}/lib/ → ~/.claude/scripts/lib/)
has_lib_files=false
for lang in "${LANGUAGES[@]}"; do
    lib_dir="${REPO_ROOT}/scripts/${lang}/lib"
    [[ -d "$lib_dir" ]] || continue

    for lib_file in "$lib_dir"/*; do
        [[ -f "$lib_file" ]] || continue
        filename=$(basename "$lib_file")

        if ! $has_lib_files; then
            echo -e "${CYAN}[hook libraries]${NC}"
            has_lib_files=true
        fi

        remove_file "${CLAUDE_DIR}/scripts/lib/${filename}" "scripts/lib/${filename}"
    done
done

# Clean up empty scripts/lib and scripts directories
cleanup_empty_dir "${CLAUDE_DIR}/scripts/lib" "scripts/lib/"
cleanup_empty_dir "${CLAUDE_DIR}/scripts" "scripts/"

if $has_lib_files; then
    echo ""
fi

# Remove global hooks (settings.json)
has_hooks=false
for lang in "${LANGUAGES[@]}"; do
    if [[ -f "${REPO_ROOT}/hooks/${lang}/hooks.json" ]] || \
       [[ -f "${REPO_ROOT}/hooks/${lang}/global-hooks.json" ]]; then
        has_hooks=true
        break
    fi
done

if $has_hooks; then
    echo -e "${CYAN}[global hooks]${NC}"
    remove_file "${CLAUDE_DIR}/settings.json" "settings.json"
    echo ""
fi

# Remove project hook templates (project-hooks/{lang}.json)
has_project_hooks=false
for lang in "${LANGUAGES[@]}"; do
    if [[ -f "${REPO_ROOT}/hooks/${lang}/project-hooks.json" ]]; then
        if ! $has_project_hooks; then
            echo -e "${CYAN}[project hooks]${NC}"
            has_project_hooks=true
        fi

        remove_file "${CLAUDE_DIR}/project-hooks/${lang}.json" "project-hooks/${lang}.json"
    fi
done

# Clean up empty project-hooks directory
cleanup_empty_dir "${CLAUDE_DIR}/project-hooks" "project-hooks/"

if $has_project_hooks; then
    echo ""
fi

# Summary
echo "────────────────────────────────"
if $DRY_RUN; then
    echo -e "Would remove: ${RED}${removed}${NC} items"
else
    echo -e "Removed: ${RED}${removed}${NC}, Not found: ${YELLOW}${not_found}${NC}"
fi

echo ""
echo -e "${CYAN}Note:${NC} To add Anthropic's official skills again later, run:"
echo "  /plugin marketplace add anthropics/skills"
