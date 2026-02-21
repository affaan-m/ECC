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

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [language]

Initialize project-level Claude Code hooks in the current directory.

Copies language-specific hook templates from ~/.claude/project-hooks/
into .claude/settings.json for the current project.

If no language is specified, auto-detects from project files:
  - pyproject.toml → python
  - package.json   → node

Options:
  -f    Force overwrite existing .claude/settings.json
  -n    Dry run (show what would be done without doing it)
  -h    Show this help

Examples:
  $(basename "$0")              # Auto-detect language
  $(basename "$0") python       # Initialize Python hooks
  $(basename "$0") node         # Initialize Node.js hooks
  $(basename "$0") -f python    # Force overwrite existing config
  $(basename "$0") -n node      # Preview what would be done
EOF
}

# Auto-detect language from project files
detect_language() {
    local has_python=false
    local has_node=false

    [[ -f "pyproject.toml" ]] && has_python=true
    [[ -f "package.json" ]] && has_node=true

    if $has_python && $has_node; then
        echo -e "${RED}Error: Both pyproject.toml and package.json found${NC}" >&2
        echo -e "Please specify the language explicitly:" >&2
        echo -e "  $(basename "$0") python" >&2
        echo -e "  $(basename "$0") node" >&2
        return 1
    elif $has_python; then
        echo "python"
    elif $has_node; then
        echo "node"
    else
        echo -e "${RED}Error: Cannot detect project language${NC}" >&2
        echo -e "No pyproject.toml or package.json found in current directory." >&2
        echo -e "Please specify the language explicitly." >&2
        return 1
    fi
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

# Determine language
if [[ $# -ge 1 ]]; then
    LANG="$1"
else
    LANG=$(detect_language) || exit 1
fi

# Validate template exists
TEMPLATE="${PROJECT_HOOKS_DIR}/${LANG}.json"
if [[ ! -f "$TEMPLATE" ]]; then
    echo -e "${RED}Error: No project hooks template for '${LANG}'${NC}"
    available=$(list_available)
    if [[ -n "$available" ]]; then
        echo "Available templates: $available"
    else
        echo "No templates installed. Run install.sh first."
    fi
    exit 1
fi

# Target
DEST=".claude/settings.json"

echo -e "Initializing ${GREEN}${LANG}${NC} hooks for project: ${CYAN}$(pwd)${NC}"

if $DRY_RUN; then
    echo -e "  ${CYAN}DRY${NC}   ${TEMPLATE} → ${DEST}"
    echo ""
    echo -e "${CYAN}Would create:${NC} ${DEST}"
    exit 0
fi

if [[ -f "$DEST" ]] && ! $FORCE; then
    echo -e "  ${YELLOW}SKIP${NC}  ${DEST} (already exists, use -f to overwrite)"
    exit 0
fi

# Create .claude directory and copy template
mkdir -p .claude
cp "$TEMPLATE" "$DEST"
echo -e "  ${GREEN}COPY${NC}  project-hooks/${LANG}.json → ${DEST}"

echo ""
echo -e "${GREEN}Done.${NC} Project hooks initialized for ${LANG}."
echo -e "File created: ${DEST}"
echo ""
echo -e "${YELLOW}Note:${NC} Add .claude/settings.json to .gitignore if hooks"
echo -e "contain machine-specific paths, or commit it to share with team."
