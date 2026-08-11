#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

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

    # Also remove Codex AGENTS.md when Codex is installed/configured.
    if codex_is_available; then
        remove_file "${CODEX_DIR}/AGENTS.md" "$(codex_agents_label)"
        cleanup_empty_dir "$CODEX_DIR" "$(dirname "$(codex_agents_label)")/"
    else
        log_info "Codex not detected; skipping Codex AGENTS.md"
    fi
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

# Remove hook scripts (scripts/{lang}/hooks/ → ~/.claude/scripts/{lang}/hooks/)
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

        remove_file "${CLAUDE_DIR}/scripts/${lang}/hooks/${filename}" "scripts/${lang}/hooks/${filename}"
    done
done

# Clean up empty per-language scripts/hooks directories
for lang in "${LANGUAGES[@]}"; do
    cleanup_empty_dir "${CLAUDE_DIR}/scripts/${lang}/hooks" "scripts/${lang}/hooks/"
done

if $has_hook_scripts; then
    echo ""
fi

# Remove hook libraries (scripts/{lang}/lib/ → ~/.claude/scripts/{lang}/lib/)
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

        remove_file "${CLAUDE_DIR}/scripts/${lang}/lib/${filename}" "scripts/${lang}/lib/${filename}"
    done
done

# Clean up empty per-language lib/, language, and top-level scripts directories
for lang in "${LANGUAGES[@]}"; do
    cleanup_empty_dir "${CLAUDE_DIR}/scripts/${lang}/lib" "scripts/${lang}/lib/"
    cleanup_empty_dir "${CLAUDE_DIR}/scripts/${lang}" "scripts/${lang}/"
done
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
    settings_file="${CLAUDE_DIR}/settings.json"
    # settings.json holds user state beyond hooks (enabledPlugins, permissions,
    # model, tui, ...) — remove only the hooks key instead of the whole file.
    if [[ ! -f "$settings_file" ]]; then
        log_not_found "settings.json"
        not_found=$((not_found + 1))
    elif $DRY_RUN; then
        log_dry_rm "settings.json (hooks key only)"
        removed=$((removed + 1))
    elif command -v jq &>/dev/null; then
        settings_content=$(jq 'del(.hooks)' "$settings_file")
        echo "$settings_content" > "$settings_file"
        log_rm "settings.json (hooks key only; other settings preserved)"
        removed=$((removed + 1))
    else
        log_info "jq not found: leaving settings.json untouched — remove the hooks key manually"
    fi
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
