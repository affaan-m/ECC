#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/common.sh"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <language>...

Uninstall shared configuration from Codex (\$CODEX_HOME or ~/.codex):
  AGENTS.md          Global instructions + rules index (generated)
  instructions/      Rules files, read on demand via the index
  skills/            Skill folders (invoked via \$skill-name)
  config.toml        Left untouched (user state); manual-removal hints printed

Options:
  -n    Dry run (show what would be removed without removing)
  -l    List available languages and exit
  -h    Show this help
EOF
}

DRY_RUN=false
while getopts "nlh" opt; do
    case $opt in
        n) DRY_RUN=true ;;
        l) discover_languages; exit 0 ;;
        h) usage; exit 0 ;;
        *) usage; exit 1 ;;
    esac
done
shift $((OPTIND - 1))

if [[ $# -eq 0 ]]; then
    echo -e "${RED}Error: At least one language must be specified${NC}"
    usage
    exit 1
fi
LANGUAGES=("$@")

AVAILABLE_LANGS=$(discover_languages)
for lang in "${LANGUAGES[@]}"; do
    if ! echo "$AVAILABLE_LANGS" | grep -qx "$lang"; then
        echo -e "${RED}Error: Unknown language '${lang}'${NC}"
        exit 1
    fi
done

if ! codex_is_available; then
    echo -e "${RED}Error: Codex not detected (set CODEX_HOME, create ~/.codex, or install codex)${NC}"
    exit 1
fi

if [[ -n "${CODEX_HOME:-}" ]]; then
    DEST_LABEL="$CODEX_DIR"
else
    DEST_LABEL="~/.codex"
fi

if $DRY_RUN; then
    echo -e "${CYAN}Dry run: showing what would be removed${NC}"
fi
echo -e "Uninstalling: ${RED}${LANGUAGES[*]}${NC} from ${DEST_LABEL}/"
echo ""

echo -e "${CYAN}[instructions]${NC}"
for lang in "${LANGUAGES[@]}"; do
    rules_dir="${CONTENT_ROOT}/rules/${lang}"
    [[ -d "$rules_dir" ]] || continue
    for f in "$rules_dir"/*.md; do
        [[ -f "$f" ]] || continue
        name=$(basename "$f")
        remove_file "${CODEX_DIR}/instructions/${name}" "instructions/${name}"
    done
done
cleanup_empty_dir "${CODEX_DIR}/instructions" "instructions/"
echo ""

echo -e "${CYAN}[global]${NC}"
remove_file "${CODEX_DIR}/AGENTS.md" "AGENTS.md"
echo ""

echo -e "${CYAN}[skills]${NC}"
for lang in "${LANGUAGES[@]}"; do
    skills_dir="${CONTENT_ROOT}/skills/${lang}"
    [[ -d "$skills_dir" ]] || continue
    for skill_dir in "$skills_dir"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_name=$(basename "$skill_dir")
        [[ "$skill_name" == .* ]] && continue
        remove_dir "${CODEX_DIR}/skills/${skill_name}" "skills/${skill_name}/"
    done
done
cleanup_empty_dir "${CODEX_DIR}/skills" "skills/"
echo ""

echo -e "${CYAN}[mcp]${NC}"
log_info "config.toml is user state and is left untouched."
if command -v jq &>/dev/null; then
    while IFS= read -r name; do
        log_info "remove [mcp_servers.${name}] from ${DEST_LABEL}/config.toml manually if unwanted"
    done < <(jq -r '.mcpServers | keys[]' "${CONTENT_ROOT}/mcp/servers.json")
fi

echo ""
echo "────────────────────────────────"
if $DRY_RUN; then
    echo -e "Would remove: ${RED}${removed}${NC} items"
else
    echo -e "Removed: ${RED}${removed}${NC}, Not found: ${YELLOW}${not_found}${NC}"
fi
