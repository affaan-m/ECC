#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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
  hooks/     Global hooks (merged into settings.json)
             Project hooks (copied to project-hooks/ as templates)

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
log_info() { echo -e "  ${CYAN}INFO${NC}  $1"; }
log_warn() { echo -e "  ${RED}WARN${NC}  $1"; }

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

# jq filter for merging hooks (single line to avoid multiline quoting issues)
JQ_MERGE_HOOKS='{ "$schema": ([.[]."$schema" // empty] | first // null), "hooks": (reduce .[] as $item ({}; reduce ($item.hooks | keys[]) as $key (.; .[$key] = ((.[$key] // []) + $item.hooks[$key])))) } | if ."$schema" == null then del(."$schema") else . end'

# Merge multiple hooks files into settings.json using jq
merge_hooks() {
    local -a hooks_files=("$@")
    local dest="${CLAUDE_DIR}/settings.json"

    if [[ ${#hooks_files[@]} -eq 0 ]]; then
        return
    fi

    echo ""
    echo -e "${CYAN}[global hooks]${NC}"

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

    local content
    if [[ ${#hooks_files[@]} -eq 1 ]]; then
        content=$(cat "${hooks_files[0]}")
        local rel
        rel=$(realpath --relative-to="$REPO_ROOT" "${hooks_files[0]}")
        log_copy "$rel" "settings.json"
        copied=$((copied + 1))
    else
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
        content=$(jq -s "$JQ_MERGE_HOOKS" "${hooks_files[@]}")

        log_copy "${#hooks_files[@]} global hooks files (merged)" "settings.json"
        copied=$((copied + 1))
    fi

    # Replace ${CLAUDE_PLUGIN_ROOT} with actual ~/.claude path
    content="${content//\$\{CLAUDE_PLUGIN_ROOT\}/$CLAUDE_DIR}"

    # settings.json holds more than hooks (enabledPlugins, permissions, model,
    # tui, ...). When overwriting an existing file, replace only the hooks key
    # (and $schema) and preserve everything else.
    if [[ -f "$dest" ]] && command -v jq &>/dev/null; then
        content=$(jq -s '.[0] * {hooks: .[1].hooks}
            * (if .[1]."$schema" != null then {"$schema": .[1]."$schema"} else {} end)' \
            "$dest" <(echo "$content"))
    elif [[ -f "$dest" ]]; then
        log_warn "jq not found: overwriting settings.json wholesale (non-hook keys will be lost)"
    fi

    echo "$content" > "$dest"
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

$DRY_RUN || mkdir -p "$CLAUDE_DIR"

# Install global CLAUDE.md
global_claude="${REPO_ROOT}/global/CLAUDE.md"
if [[ -f "$global_claude" ]]; then
    echo -e "${CYAN}[global]${NC}"
    copy_file "$global_claude" "${CLAUDE_DIR}/CLAUDE.md" \
        "global/CLAUDE.md" "CLAUDE.md"

    # Also install as Codex AGENTS.md when Codex is installed/configured.
    if codex_is_available; then
        if ! $DRY_RUN; then
            mkdir -p "$CODEX_DIR"
        fi
        copy_file "$global_claude" "${CODEX_DIR}/AGENTS.md" \
            "global/CLAUDE.md" "$(codex_agents_label)"
    else
        log_info "Codex not detected; skipping Codex AGENTS.md"
    fi
    echo ""
fi

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

# Copy hook scripts (scripts/{lang}/hooks/ → ~/.claude/scripts/{lang}/hooks/)
# The per-language layout must be preserved: hook configs reference
# ${CLAUDE_PLUGIN_ROOT}/scripts/{lang}/hooks/*.js, which install substitutes
# to ~/.claude/scripts/{lang}/hooks/*.js.
has_hook_scripts=false
for lang in "${LANGUAGES[@]}"; do
    scripts_dir="${REPO_ROOT}/scripts/${lang}/hooks"
    [[ -d "$scripts_dir" ]] || continue

    dest_scripts="${CLAUDE_DIR}/scripts/${lang}/hooks"
    mkdir -p "$dest_scripts"

    for script in "$scripts_dir"/*; do
        [[ -f "$script" ]] || continue
        filename=$(basename "$script")

        if ! $has_hook_scripts; then
            echo -e "${CYAN}[hook scripts]${NC}"
            has_hook_scripts=true
        fi

        copy_file "$script" "${dest_scripts}/${filename}" \
            "scripts/${lang}/hooks/${filename}" "scripts/${lang}/hooks/${filename}"
    done
done

if $has_hook_scripts; then
    echo ""
fi

# Copy hook libraries (scripts/{lang}/lib/ → ~/.claude/scripts/{lang}/lib/)
# Hook scripts resolve their libs relatively (../lib), so the per-language
# layout must match the hooks layout above.
has_lib_files=false
for lang in "${LANGUAGES[@]}"; do
    lib_dir="${REPO_ROOT}/scripts/${lang}/lib"
    [[ -d "$lib_dir" ]] || continue

    dest_lib="${CLAUDE_DIR}/scripts/${lang}/lib"
    mkdir -p "$dest_lib"

    for lib_file in "$lib_dir"/*; do
        [[ -f "$lib_file" ]] || continue
        filename=$(basename "$lib_file")

        if ! $has_lib_files; then
            echo -e "${CYAN}[hook libraries]${NC}"
            has_lib_files=true
        fi

        copy_file "$lib_file" "${dest_lib}/${filename}" \
            "scripts/${lang}/lib/${filename}" "scripts/${lang}/lib/${filename}"
    done
done

if $has_lib_files; then
    echo ""
fi

# Collect global hooks: hooks/common/hooks.json + hooks/*/global-hooks.json
hooks_to_merge=()
for lang in "${LANGUAGES[@]}"; do
    # hooks.json (used by common/)
    hooks_file="${REPO_ROOT}/hooks/${lang}/hooks.json"
    if [[ -f "$hooks_file" ]]; then
        hooks_to_merge+=("$hooks_file")
    fi
    # global-hooks.json (used by language-specific dirs)
    global_hooks_file="${REPO_ROOT}/hooks/${lang}/global-hooks.json"
    if [[ -f "$global_hooks_file" ]]; then
        hooks_to_merge+=("$global_hooks_file")
    fi
done
merge_hooks "${hooks_to_merge[@]}"

# Smoke test: every script path referenced by hook commands in settings.json
# must exist, otherwise those hooks are silent no-ops at runtime.
verify_hook_paths() {
    local dest="${CLAUDE_DIR}/settings.json"
    $DRY_RUN && return 0
    [[ -f "$dest" ]] || return 0
    command -v jq &>/dev/null || return 0

    local missing=0 script_path
    while IFS= read -r script_path; do
        if [[ ! -f "$script_path" ]]; then
            log_warn "hook references missing script: $script_path"
            missing=$((missing + 1))
        fi
    done < <(jq -r '.. | .command? // empty' "$dest" 2>/dev/null \
        | grep -oE "${CLAUDE_DIR}[^\" ]*\.(js|sh|py)" | sort -u)

    if [[ $missing -gt 0 ]]; then
        log_warn "${missing} hook script path(s) missing — affected hooks will be no-ops"
    fi
}
verify_hook_paths

# Copy project hooks templates (hooks/*/project-hooks.json → ~/.claude/project-hooks/{lang}.json)
has_project_hooks=false
for lang in "${LANGUAGES[@]}"; do
    project_hooks_file="${REPO_ROOT}/hooks/${lang}/project-hooks.json"
    [[ -f "$project_hooks_file" ]] || continue

    dest_project_hooks="${CLAUDE_DIR}/project-hooks"
    mkdir -p "$dest_project_hooks"

    if ! $has_project_hooks; then
        echo ""
        echo -e "${CYAN}[project hooks]${NC}"
        has_project_hooks=true
    fi

    copy_file_subst "$project_hooks_file" "${dest_project_hooks}/${lang}.json" \
        "hooks/${lang}/project-hooks.json" "project-hooks/${lang}.json"
done

if $has_project_hooks; then
    echo ""
fi

# Summary
echo ""
echo "────────────────────────────────"
if $DRY_RUN; then
    echo -e "Would copy: ${GREEN}${copied}${NC} items"
else
    echo -e "Copied: ${GREEN}${copied}${NC}, Skipped: ${YELLOW}${skipped}${NC}"
fi

if $has_project_hooks && ! $DRY_RUN; then
    echo ""
    echo -e "${CYAN}Project hooks installed as templates.${NC}"
    echo -e "To initialize a project, run:"
    echo -e "  ${GREEN}$(dirname "$0")/init-project.sh${NC} [language]"
fi
