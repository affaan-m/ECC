#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "${REPO_ROOT}/scripts/lib/common.sh"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] <language>...

Install shared configuration into Codex (\$CODEX_HOME or ~/.codex):
  AGENTS.md          Global instructions + rules index (generated)
  instructions/      Rules files, read on demand via the index
  skills/            Skill folders (invoked via \$skill-name)
  config.toml        [mcp_servers.*] entries merged (backup created)

Options:
  -f    Force overwrite existing files / MCP entries
  -n    Dry run
  -l    List available languages and exit
  -h    Show this help
EOF
}

FORCE=false
DRY_RUN=false
while getopts "fnlh" opt; do
    case $opt in
        f) FORCE=true ;;
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
    echo -e "${CYAN}Dry run: showing what would be installed${NC}"
fi
echo -e "Installing: ${GREEN}${LANGUAGES[*]}${NC} → ${DEST_LABEL}/"
echo ""

$DRY_RUN || mkdir -p "$CODEX_DIR/instructions" "$CODEX_DIR/skills"

# 1. Rules → instructions/
echo -e "${CYAN}[instructions]${NC}"
for lang in "${LANGUAGES[@]}"; do
    rules_dir="${CONTENT_ROOT}/rules/${lang}"
    [[ -d "$rules_dir" ]] || continue
    for f in "$rules_dir"/*.md; do
        [[ -f "$f" ]] || continue
        name=$(basename "$f")
        copy_file "$f" "${CODEX_DIR}/instructions/${name}" \
            "content/rules/${lang}/${name}" "instructions/${name}"
    done
done
echo ""

# 2. AGENTS.md (generated: global instructions + rules index)
echo -e "${CYAN}[global]${NC}"
agents_tmp=$(mktemp)
trap 'rm -f "$agents_tmp"' EXIT
"${SCRIPT_DIR}/build-agents-md.sh" "${DEST_LABEL}/instructions" "${LANGUAGES[@]}" > "$agents_tmp"
copy_file "$agents_tmp" "${CODEX_DIR}/AGENTS.md" \
    "content/instructions/global.md (+rules index)" "AGENTS.md"
echo ""

# 3. Skills
echo -e "${CYAN}[skills]${NC}"
for lang in "${LANGUAGES[@]}"; do
    skills_dir="${CONTENT_ROOT}/skills/${lang}"
    [[ -d "$skills_dir" ]] || continue
    for skill_dir in "$skills_dir"/*/; do
        [[ -d "$skill_dir" ]] || continue
        skill_name=$(basename "$skill_dir")
        [[ "$skill_name" == .* ]] && continue
        copy_dir "$skill_dir" "${CODEX_DIR}/skills/${skill_name}" \
            "content/skills/${lang}/${skill_name}/" "skills/${skill_name}/"
    done
done
echo ""

# 4. MCP servers → config.toml (key-scoped merge, backup created)
echo -e "${CYAN}[mcp]${NC}"
if command -v uv &>/dev/null; then
    merge_args=(--config "${CODEX_DIR}/config.toml" --servers "${CONTENT_ROOT}/mcp/servers.json")
    $FORCE && merge_args+=(--force)
    $DRY_RUN && merge_args+=(--dry-run)
    uv run --with tomlkit python3 "${SCRIPT_DIR}/merge-mcp.py" "${merge_args[@]}" \
        | sed 's/^/  /'
else
    log_warn "uv not found; skipping MCP merge into config.toml"
    log_warn "Add servers from content/mcp/servers.json manually"
fi

echo ""
echo "────────────────────────────────"
if $DRY_RUN; then
    echo -e "Would copy: ${GREEN}${copied}${NC} items"
else
    echo -e "Copied: ${GREEN}${copied}${NC}, Skipped: ${YELLOW}${skipped}${NC}"
    echo ""
    echo -e "${CYAN}Restart Codex, then verify skill discovery with \$skill-name.${NC}"
fi
