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

copied=0
skipped=0

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

Install Claude Code configuration files to ~/.claude/

Available languages: ${available}

Categories installed:
  agents/    Agent definitions (.md)
  skills/    Skill knowledge bases (directories with SKILL.md)
  commands/  Slash commands (.md)
  rules/     Rules and guidelines (.md)
  hooks/     Hook configurations (merged into settings.json)

Options:
  -f    Force overwrite existing files
  -n    Dry run (show what would be copied without copying)
  -l    List available languages and exit
  -h    Show this help

Examples:
  $(basename "$0") python common        # Install Python and common configs
  $(basename "$0") node                  # Install Node.js configs
  $(basename "$0") -f python node go    # Force install multiple languages
  $(basename "$0") -n python node       # Preview what would be installed
EOF
}

log_copy() { echo -e "  ${GREEN}COPY${NC}  $1 → $2"; }
log_skip() { echo -e "  ${YELLOW}SKIP${NC}  $1 (already exists, use -f to overwrite)"; }
log_dry()  { echo -e "  ${CYAN}DRY${NC}   $1 → $2"; }
log_warn() { echo -e "  ${RED}WARN${NC}  $1"; }

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
        cp -r "$src" "$dest"
        log_copy "$label_src" "$label_dest"
        copied=$((copied + 1))
    fi
}

# jq filter for merging hooks (single line to avoid multiline quoting issues)
JQ_MERGE_HOOKS='{ "$schema": .[0]["$schema"], "hooks": (reduce .[] as $item ({}; reduce ($item.hooks | keys[]) as $key (.; .[$key] = ((.[$key] // []) + $item.hooks[$key])))) }'

# Merge multiple hooks.json files into settings.json using jq
merge_hooks() {
    local -a hooks_files=("$@")
    local dest="${CLAUDE_DIR}/settings.json"

    if [[ ${#hooks_files[@]} -eq 0 ]]; then
        return
    fi

    echo ""
    echo -e "${CYAN}[hooks]${NC}"

    if $DRY_RUN; then
        for f in "${hooks_files[@]}"; do
            local rel
            rel=$(realpath --relative-to="$REPO_ROOT" "$f")
            log_dry "$rel" "settings.json"
        done
        return
    fi

    if [[ -f "$dest" ]] && ! $FORCE; then
        log_skip "settings.json"
        skipped=$((skipped + 1))
        return
    fi

    if [[ ${#hooks_files[@]} -eq 1 ]]; then
        cp "${hooks_files[0]}" "$dest"
        local rel
        rel=$(realpath --relative-to="$REPO_ROOT" "${hooks_files[0]}")
        log_copy "$rel" "settings.json"
        copied=$((copied + 1))
        return
    fi

    # Multiple hooks files: merge with jq
    if ! command -v jq &>/dev/null; then
        log_warn "jq not found. Cannot merge multiple hooks files."
        log_warn "Install jq or specify only one language with hooks."
        log_warn "Hooks files to merge:"
        for f in "${hooks_files[@]}"; do
            log_warn "  - $(realpath --relative-to="$REPO_ROOT" "$f")"
        done
        return
    fi

    # Build jq merge: for each hook event, concatenate arrays
    local merged
    merged=$(jq -s "$JQ_MERGE_HOOKS" "${hooks_files[@]}")

    echo "$merged" > "$dest"

    log_copy "${#hooks_files[@]} hooks files (merged)" "settings.json"
    copied=$((copied + 1))
}

# Parse options
FORCE=false
DRY_RUN=false

while getopts "fnlh" opt; do
    case $opt in
        f) FORCE=true ;;
        n) DRY_RUN=true ;;
        l)
            echo "Available languages:"
            discover_languages | while read -r lang; do
                # Show which categories exist for each language
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
    echo -e "${CYAN}Dry run: showing what would be installed${NC}"
fi
echo -e "Installing: ${GREEN}${LANGUAGES[*]}${NC} → ${CLAUDE_DIR}/"
echo ""

# Install categories (agents, skills, commands, rules)
for category in "${CATEGORIES[@]}"; do
    has_files=false

    for lang in "${LANGUAGES[@]}"; do
        src_dir="${REPO_ROOT}/${category}/${lang}"
        [[ -d "$src_dir" ]] || continue

        dest_dir="${CLAUDE_DIR}/${category}"
        mkdir -p "$dest_dir"

        if [[ "$category" == "skills" ]]; then
            # Skills have subdirectories (e.g., skills/node/backend-patterns/SKILL.md)
            for skill_dir in "$src_dir"/*/; do
                [[ -d "$skill_dir" ]] || continue
                local_name=$(basename "$skill_dir")
                [[ "$local_name" == .* ]] && continue

                if ! $has_files; then
                    echo -e "${CYAN}[${category}]${NC}"
                    has_files=true
                fi

                copy_dir "$skill_dir" "${dest_dir}/${local_name}" \
                    "${category}/${lang}/${local_name}/" "${category}/${local_name}/"
            done
        else
            # Agents, commands, rules: flat .md files
            for file in "$src_dir"/*.md; do
                [[ -f "$file" ]] || continue
                filename=$(basename "$file")

                if ! $has_files; then
                    echo -e "${CYAN}[${category}]${NC}"
                    has_files=true
                fi

                copy_file "$file" "${dest_dir}/${filename}" \
                    "${category}/${lang}/${filename}" "${category}/${filename}"
            done
        fi
    done

    if $has_files; then
        echo ""
    fi
done

# Collect and merge hooks
hooks_to_merge=()
for lang in "${LANGUAGES[@]}"; do
    hooks_file="${REPO_ROOT}/hooks/${lang}/hooks.json"
    if [[ -f "$hooks_file" ]]; then
        hooks_to_merge+=("$hooks_file")
    fi
done
merge_hooks "${hooks_to_merge[@]}"

# Summary
echo ""
echo "────────────────────────────────"
if $DRY_RUN; then
    echo -e "Would copy: ${GREEN}${copied}${NC} items"
else
    echo -e "Copied: ${GREEN}${copied}${NC}, Skipped: ${YELLOW}${skipped}${NC}"
fi
