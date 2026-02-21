#!/usr/bin/env bash
set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
PROJECT_HOOKS_DIR="${CLAUDE_DIR}/project-hooks"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# jq filter for merging hooks (same as install.sh)
JQ_MERGE_HOOKS='{ "$schema": .[0]["$schema"], "hooks": (reduce .[] as $item ({}; reduce ($item.hooks | keys[]) as $key (.; .[$key] = ((.[$key] // []) + $item.hooks[$key])))) }'

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [language...]

Initialize project-level Claude Code hooks in the current directory.

Copies language-specific hook templates from ~/.claude/project-hooks/
into .claude/settings.json for the current project. Multiple languages
can be specified to merge hooks for mixed-language projects.

If no language is specified, auto-detects from project files:
  - pyproject.toml → python
  - package.json   → node
  - Cargo.toml     → rust
  Multiple detected → all merged together

Options:
  -f    Force overwrite existing .claude/settings.json
  -n    Dry run (show what would be done without doing it)
  -h    Show this help

Examples:
  $(basename "$0")              # Auto-detect language(s)
  $(basename "$0") python       # Initialize Python hooks
  $(basename "$0") node python  # Merge Node + Python hooks
  $(basename "$0") rust python  # Merge Rust + Python hooks
  $(basename "$0") -f node      # Force overwrite existing config
  $(basename "$0") -n node      # Preview what would be done
EOF
}

# Auto-detect languages from project files
detect_languages() {
    local -a detected=()

    [[ -f "pyproject.toml" ]] && detected+=(python)
    [[ -f "package.json" ]] && detected+=(node)
    [[ -f "Cargo.toml" ]] && detected+=(rust)

    if [[ ${#detected[@]} -eq 0 ]]; then
        echo -e "${RED}Error: Cannot detect project language${NC}" >&2
        echo -e "No pyproject.toml, package.json, or Cargo.toml found." >&2
        echo -e "Please specify the language explicitly." >&2
        return 1
    fi

    echo "${detected[@]}"
}

# List available project hook templates
list_available() {
    if [[ ! -d "$PROJECT_HOOKS_DIR" ]]; then
        return
    fi
    for f in "$PROJECT_HOOKS_DIR"/*.json; do
        [[ -f "$f" ]] || continue
        basename "$f" .json
    done
}

# Parse options
FORCE=false
DRY_RUN=false

while getopts "fnh" opt; do
    case $opt in
        f) FORCE=true ;;
        n) DRY_RUN=true ;;
        h) usage; exit 0 ;;
        *) usage; exit 1 ;;
    esac
done
shift $((OPTIND - 1))

# Determine languages
if [[ $# -ge 1 ]]; then
    LANGUAGES=("$@")
else
    read -ra LANGUAGES <<< "$(detect_languages)" || exit 1
fi

# Validate all templates exist
TEMPLATES=()
for lang in "${LANGUAGES[@]}"; do
    template="${PROJECT_HOOKS_DIR}/${lang}.json"
    if [[ ! -f "$template" ]]; then
        echo -e "${RED}Error: No project hooks template for '${lang}'${NC}"
        available=$(list_available)
        if [[ -n "$available" ]]; then
            echo "Available templates: $available"
        else
            echo "No templates installed. Run install.sh first."
        fi
        exit 1
    fi
    TEMPLATES+=("$template")
done

# Target
DEST=".claude/settings.json"

echo -e "Initializing ${GREEN}${LANGUAGES[*]}${NC} hooks for project: ${CYAN}$(pwd)${NC}"

if $DRY_RUN; then
    for template in "${TEMPLATES[@]}"; do
        echo -e "  ${CYAN}DRY${NC}   $(basename "$template" .json) → ${DEST}"
    done
    if [[ ${#TEMPLATES[@]} -gt 1 ]]; then
        echo -e "  ${CYAN}INFO${NC}  ${#TEMPLATES[@]} templates would be merged with jq"
    fi
    echo ""
    echo -e "${CYAN}Would create:${NC} ${DEST}"
    exit 0
fi

if [[ -f "$DEST" ]] && ! $FORCE; then
    echo -e "  ${YELLOW}SKIP${NC}  ${DEST} (already exists, use -f to overwrite)"
    exit 0
fi

# Create .claude directory
mkdir -p .claude

if [[ ${#TEMPLATES[@]} -eq 1 ]]; then
    # Single language: direct copy
    cp "${TEMPLATES[0]}" "$DEST"
    echo -e "  ${GREEN}COPY${NC}  project-hooks/${LANGUAGES[0]}.json → ${DEST}"
else
    # Multiple languages: merge with jq
    if ! command -v jq &>/dev/null; then
        echo -e "${RED}Error: jq is required to merge multiple hook templates${NC}"
        echo -e "Install jq or specify only one language."
        exit 1
    fi

    jq -s "$JQ_MERGE_HOOKS" "${TEMPLATES[@]}" > "$DEST"
    echo -e "  ${GREEN}MERGE${NC} ${LANGUAGES[*]} → ${DEST}"
fi

echo ""
echo -e "${GREEN}Done.${NC} Project hooks initialized for ${LANGUAGES[*]}."
echo -e "File created: ${DEST}"
echo ""
echo -e "${YELLOW}Note:${NC} Add .claude/settings.json to .gitignore if hooks"
echo -e "contain machine-specific paths, or commit it to share with team."
