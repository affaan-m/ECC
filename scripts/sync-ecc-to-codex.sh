#!/usr/bin/env bash
set -euo pipefail

# Sync Everything Claude Code (ECC) assets into a local Codex CLI setup.
# - Backs up ~/.codex config and AGENTS.md
# - Merges ECC AGENTS.md into existing AGENTS.md (marker-based, preserves user content)
# - Generates prompt files from commands/*.md
# - Generates Codex QA wrappers and optional language rule-pack prompts
# - Installs global git safety hooks (pre-commit and pre-push)
# - Runs a post-sync global regression sanity check
# - Merges ECC MCP servers into config.toml (add-only via Node TOML parser)

MODE="apply"
UPDATE_MCP=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)    MODE="dry-run" ;;
    --update-mcp) UPDATE_MCP="--update-mcp" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

CONFIG_FILE="$CODEX_HOME/config.toml"
AGENTS_FILE="$CODEX_HOME/AGENTS.md"
AGENTS_ROOT_SRC="$REPO_ROOT/AGENTS.md"
AGENTS_CODEX_SUPP_SRC="$REPO_ROOT/.codex/AGENTS.md"
CODEX_AGENTS_SRC="$REPO_ROOT/.codex/agents"
CODEX_AGENTS_DEST="$CODEX_HOME/agents"
CODEX_NAV_GUIDE_SRC="$REPO_ROOT/docs/CODEX-NAVIGATION-GUIDE.md"
CODEX_NAV_GUIDE_DEST="$CODEX_HOME/docs/CODEX-NAVIGATION-GUIDE.md"
CODEX_COMMAND_AGENT_MAP_SRC="$REPO_ROOT/docs/COMMAND-AGENT-MAP.md"
CODEX_COMMAND_AGENT_MAP_DEST="$CODEX_HOME/docs/COMMAND-AGENT-MAP.md"
CODEX_COMMANDS_QUICK_REF_SRC="$REPO_ROOT/COMMANDS-QUICK-REF.md"
CODEX_COMMANDS_QUICK_REF_DEST="$CODEX_HOME/COMMANDS-QUICK-REF.md"
CODEX_CONTRIBUTING_SRC="$REPO_ROOT/CONTRIBUTING.md"
CODEX_CONTRIBUTING_DEST="$CODEX_HOME/CONTRIBUTING.md"
CODEX_PR_TEMPLATE_SRC="$REPO_ROOT/.github/PULL_REQUEST_TEMPLATE.md"
CODEX_PR_TEMPLATE_DEST="$CODEX_HOME/.github/PULL_REQUEST_TEMPLATE.md"
PROMPTS_SRC="$REPO_ROOT/commands"
PROMPTS_DEST="$CODEX_HOME/prompts"
BASELINE_MERGE_SCRIPT="$REPO_ROOT/scripts/codex/merge-codex-config.js"
HOOKS_INSTALLER="$REPO_ROOT/scripts/codex/install-global-git-hooks.sh"
SANITY_CHECKER="$REPO_ROOT/scripts/codex/check-codex-global-state.sh"
CURSOR_RULES_DIR="$REPO_ROOT/.cursor/rules"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$CODEX_HOME/backups/ecc-$STAMP"

log() { printf '[ecc-sync] %s\n' "$*"; }

run_or_echo() {
  if [[ "$MODE" == "dry-run" ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

require_path() {
  local p="$1"
  local label="$2"
  if [[ ! -e "$p" ]]; then
    log "Missing $label: $p"
    exit 1
  fi
}

toml_escape() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '%s' "$v"
}

remove_section_inplace() {
  local file="$1"
  local section="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v section="$section" '
    BEGIN { skip = 0 }
    {
      if ($0 == "[" section "]") {
        skip = 1
        next
      }
      if (skip && $0 ~ /^\[/) {
        skip = 0
      }
      if (!skip) {
        print
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

extract_toml_value() {
  local file="$1"
  local section="$2"
  local key="$3"
  awk -v section="$section" -v key="$key" '
    $0 == "[" section "]" { in_section = 1; next }
    in_section && /^\[/ { in_section = 0 }
    in_section && $1 == key {
      line = $0
      sub(/^[^=]*=[[:space:]]*"/, "", line)
      sub(/".*$/, "", line)
      print line
      exit
    }
  ' "$file"
}

extract_context7_key() {
  local file="$1"
  node - "$file" <<'EOF'
const fs = require('fs');

const filePath = process.argv[2];
let source = '';

try {
  source = fs.readFileSync(filePath, 'utf8');
} catch {
  process.exit(0);
}

const match = source.match(/--key",\s*"([^"]+)"/);
if (match && match[1]) {
  process.stdout.write(`${match[1]}\n`);
}
EOF
}

generate_prompt_file() {
  local src="$1"
  local out="$2"
  local cmd_name="$3"
  {
    printf '# ECC Command Prompt: /%s\n\n' "$cmd_name"
    printf 'Source: %s\n\n' "$src"
    printf 'Use this prompt to run the ECC `%s` workflow.\n\n' "$cmd_name"
    awk '
      NR == 1 && $0 == "---" { fm = 1; next }
      fm == 1 && $0 == "---" { fm = 0; next }
      fm == 1 { next }
      { print }
    ' "$src"
  } > "$out"
}

MCP_MERGE_SCRIPT="$REPO_ROOT/scripts/codex/merge-mcp-config.js"

require_path "$REPO_ROOT/AGENTS.md" "ECC AGENTS.md"
require_path "$AGENTS_CODEX_SUPP_SRC" "ECC Codex AGENTS supplement"
require_path "$CODEX_AGENTS_SRC" "ECC Codex agent roles"
require_path "$CODEX_NAV_GUIDE_SRC" "ECC Codex navigation guide"
require_path "$CODEX_COMMAND_AGENT_MAP_SRC" "ECC command-agent map"
require_path "$CODEX_COMMANDS_QUICK_REF_SRC" "ECC commands quick reference"
require_path "$CODEX_CONTRIBUTING_SRC" "ECC contributing guide"
require_path "$CODEX_PR_TEMPLATE_SRC" "ECC PR template"
require_path "$PROMPTS_SRC" "ECC commands directory"
require_path "$BASELINE_MERGE_SCRIPT" "ECC Codex baseline merge script"
require_path "$HOOKS_INSTALLER" "ECC global git hooks installer"
require_path "$SANITY_CHECKER" "ECC global sanity checker"
require_path "$CURSOR_RULES_DIR" "ECC Cursor rules directory"
require_path "$CONFIG_FILE" "Codex config.toml"
require_path "$MCP_MERGE_SCRIPT" "ECC MCP merge script"

if ! command -v node >/dev/null 2>&1; then
  log "ERROR: node is required for MCP config merging but was not found"
  exit 1
fi

log "Mode: $MODE"
log "Repo root: $REPO_ROOT"
log "Codex home: $CODEX_HOME"

log "Creating backup folder: $BACKUP_DIR"
run_or_echo mkdir -p "$BACKUP_DIR"
run_or_echo cp "$CONFIG_FILE" "$BACKUP_DIR/config.toml"
if [[ -f "$AGENTS_FILE" ]]; then
  run_or_echo cp "$AGENTS_FILE" "$BACKUP_DIR/AGENTS.md"
fi

ECC_BEGIN_MARKER="<!-- BEGIN ECC -->"
ECC_END_MARKER="<!-- END ECC -->"

compose_ecc_block() {
  printf '%s\n' "$ECC_BEGIN_MARKER"
  cat "$AGENTS_ROOT_SRC"
  printf '\n\n---\n\n'
  printf '# Codex Supplement (From ECC .codex/AGENTS.md)\n\n'
  cat "$AGENTS_CODEX_SUPP_SRC"
  printf '\n%s\n' "$ECC_END_MARKER"
}

log "Merging ECC AGENTS into $AGENTS_FILE (preserving user content)"
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] merge ECC block into %s from %s + %s\n' "$AGENTS_FILE" "$AGENTS_ROOT_SRC" "$AGENTS_CODEX_SUPP_SRC"
else
  replace_ecc_section() {
    # Replace the ECC block between markers in $AGENTS_FILE with fresh content.
    # Uses awk to correctly handle all positions including line 1.
    local tmp
    tmp="$(mktemp)"
    local ecc_tmp
    ecc_tmp="$(mktemp)"
    compose_ecc_block > "$ecc_tmp"
    awk -v begin="$ECC_BEGIN_MARKER" -v end="$ECC_END_MARKER" -v ecc="$ecc_tmp" '
      { gsub(/\r$/, "") }
      $0 == begin { skip = 1; while ((getline line < ecc) > 0) print line; close(ecc); next }
      $0 == end   { skip = 0; next }
      !skip        { print }
    ' "$AGENTS_FILE" > "$tmp"
    # Write through the path (preserves symlinks) instead of mv
    cat "$tmp" > "$AGENTS_FILE"
    rm -f "$tmp" "$ecc_tmp"
  }

  if [[ ! -f "$AGENTS_FILE" ]]; then
    # No existing file — create fresh with markers
    compose_ecc_block > "$AGENTS_FILE"
  elif awk -v b="$ECC_BEGIN_MARKER" -v e="$ECC_END_MARKER" '
        { gsub(/\r$/, "") }
        $0 == b { bc++; if (!fb) fb = NR }
        $0 == e { ec++; if (!fe) fe = NR }
        END { exit !(bc == 1 && ec == 1 && fb < fe) }
      ' "$AGENTS_FILE"; then
    # Exactly one BEGIN/END pair in correct order — replace only the ECC section
    replace_ecc_section
  elif awk -v b="$ECC_BEGIN_MARKER" -v e="$ECC_END_MARKER" '
        { gsub(/\r$/, "") }
        $0 == b { bc++ } $0 == e { ec++ }
        END { exit !((bc + ec) > 0) }
      ' "$AGENTS_FILE"; then
    # Markers present but not exactly one valid BEGIN/END pair (missing END,
    # duplicates, or out-of-order). Strip all marker lines, then append a
    # fresh marked block. This preserves user content outside markers.
    log "WARNING: ECC markers found but not a clean pair — stripping markers and re-appending"
    _fix_tmp="$(mktemp)"
    awk -v b="$ECC_BEGIN_MARKER" -v e="$ECC_END_MARKER" '
      { gsub(/\r$/, "") }
      $0 == b { skip = 1; next }
      $0 == e { skip = 0; next }
      !skip   { print }
    ' "$AGENTS_FILE" > "$_fix_tmp"
    cat "$_fix_tmp" > "$AGENTS_FILE"
    rm -f "$_fix_tmp"
    { printf '\n\n'; compose_ecc_block; } >> "$AGENTS_FILE"
  else
    # Existing file without markers — append ECC block, preserving existing content.
    # Legacy ECC-only files will have duplicate content after this first run, but
    # subsequent runs use marker-based replacement so only the marked section updates.
    # A timestamped backup was already saved above for recovery if needed.
    log "No ECC markers found — appending managed block (backup saved)"
    {
      printf '\n\n'
      compose_ecc_block
    } >> "$AGENTS_FILE"
  fi
fi

log "Merging ECC Codex baseline into $CONFIG_FILE (add-only, preserving user config)"
if [[ "$MODE" == "dry-run" ]]; then
  node "$BASELINE_MERGE_SCRIPT" "$CONFIG_FILE" --dry-run
else
  node "$BASELINE_MERGE_SCRIPT" "$CONFIG_FILE"
fi

log "Syncing Codex navigation guide"
run_or_echo mkdir -p "$(dirname "$CODEX_NAV_GUIDE_DEST")"
run_or_echo cp "$CODEX_NAV_GUIDE_SRC" "$CODEX_NAV_GUIDE_DEST"
run_or_echo cp "$CODEX_COMMAND_AGENT_MAP_SRC" "$CODEX_COMMAND_AGENT_MAP_DEST"
run_or_echo cp "$CODEX_COMMANDS_QUICK_REF_SRC" "$CODEX_COMMANDS_QUICK_REF_DEST"
run_or_echo cp "$CODEX_CONTRIBUTING_SRC" "$CODEX_CONTRIBUTING_DEST"
run_or_echo mkdir -p "$(dirname "$CODEX_PR_TEMPLATE_DEST")"
run_or_echo cp "$CODEX_PR_TEMPLATE_SRC" "$CODEX_PR_TEMPLATE_DEST"

log "Syncing sample Codex agent role files"
run_or_echo mkdir -p "$CODEX_AGENTS_DEST"
for agent_file in "$CODEX_AGENTS_SRC"/*.toml; do
  [[ -f "$agent_file" ]] || continue
  agent_name="$(basename "$agent_file")"
  dest="$CODEX_AGENTS_DEST/$agent_name"
  if [[ -e "$dest" ]]; then
    log "Keeping existing Codex agent role file: $dest"
  else
    run_or_echo cp "$agent_file" "$dest"
  fi
done

# Skills are NOT synced here — Codex CLI reads directly from
# ~/.agents/skills/ (installed by ECC installer / npx skills).
# Copying into ~/.codex/skills/ was unnecessary.

log "Generating prompt files from ECC commands"
run_or_echo mkdir -p "$PROMPTS_DEST"
manifest="$PROMPTS_DEST/ecc-prompts-manifest.txt"
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] > %s\n' "$manifest"
else
  : > "$manifest"
fi

prompt_count=0
while IFS= read -r -d '' command_file; do
  name="$(basename "$command_file" .md)"
  out="$PROMPTS_DEST/ecc-$name.md"
  if [[ "$MODE" == "dry-run" ]]; then
    printf '[dry-run] generate %s from %s\n' "$out" "$command_file"
  else
    generate_prompt_file "$command_file" "$out" "$name"
    printf 'ecc-%s.md\n' "$name" >> "$manifest"
  fi
  prompt_count=$((prompt_count + 1))
done < <(find "$PROMPTS_SRC" -maxdepth 1 -type f -name '*.md' -print0 | sort -z)

if [[ "$MODE" == "apply" ]]; then
  sort -u "$manifest" -o "$manifest"
fi

log "Generating Codex tool prompts + optional rule-pack prompts"
extension_manifest="$PROMPTS_DEST/ecc-extension-prompts-manifest.txt"
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] > %s\n' "$extension_manifest"
else
  : > "$extension_manifest"
fi

extension_count=0

write_extension_prompt() {
  local name="$1"
  local file="$PROMPTS_DEST/$name"
  if [[ "$MODE" == "dry-run" ]]; then
    printf '[dry-run] generate %s\n' "$file"
  else
    cat > "$file"
    printf '%s\n' "$name" >> "$extension_manifest"
  fi
  extension_count=$((extension_count + 1))
}

write_extension_prompt "ecc-tool-run-tests.md" <<EOF
# ECC Tool Prompt: run-tests

Run the repository test suite with package-manager autodetection and concise reporting.

## Instructions
1. Detect package manager from lock files in this order: \`pnpm-lock.yaml\`, \`bun.lockb\`, \`yarn.lock\`, \`package-lock.json\`.
2. Detect available scripts or test commands for this repo.
3. Execute tests with the best project-native command.
4. If tests fail, report failing files/tests first, then the smallest likely fix list.
5. Do not change code unless explicitly asked.

## Output Format
\`\`\`
RUN TESTS: [PASS/FAIL]
Command used: <command>
Summary: <x passed / y failed>
Top failures:
- ...
Suggested next step:
- ...
\`\`\`
EOF

write_extension_prompt "ecc-tool-check-coverage.md" <<EOF
# ECC Tool Prompt: check-coverage

Analyze coverage and compare it to an 80% threshold (or a threshold I specify).

## Instructions
1. Find existing coverage artifacts first (\`coverage/coverage-summary.json\`, \`coverage/coverage-final.json\`, \`.nyc_output/coverage.json\`).
2. If missing, run the project's coverage command using the detected package manager.
3. Report total coverage and top under-covered files.
4. Fail the report if coverage is below threshold.

## Output Format
\`\`\`
COVERAGE: [PASS/FAIL]
Threshold: <n>%
Total lines: <n>%
Total branches: <n>% (if available)
Worst files:
- path: xx%
Recommended focus:
- ...
\`\`\`
EOF

write_extension_prompt "ecc-tool-security-audit.md" <<EOF
# ECC Tool Prompt: security-audit

Run a practical security audit: dependency vulnerabilities + secret scan + high-risk code patterns.

## Instructions
1. Run dependency audit command for this repo/package manager.
2. Scan source and staged changes for high-signal secrets (OpenAI keys, GitHub tokens, AWS keys, private keys).
3. Scan for risky patterns (\`eval(\`, \`dangerouslySetInnerHTML\`, unsanitized \`innerHTML\`, obvious SQL string interpolation).
4. Prioritize findings by severity: CRITICAL, HIGH, MEDIUM, LOW.
5. Do not auto-fix unless I explicitly ask.

## Output Format
\`\`\`
SECURITY AUDIT: [PASS/FAIL]
Dependency vulnerabilities: <summary>
Secrets findings: <count>
Code risk findings: <count>
Critical issues:
- ...
Remediation plan:
1. ...
2. ...
\`\`\`
EOF

write_extension_prompt "ecc-rules-pack-common.md" <<EOF
# ECC Rule Pack: common (optional)

Apply ECC common engineering rules for this session. Use these files as the source of truth:

- \`$CURSOR_RULES_DIR/common-agents.md\`
- \`$CURSOR_RULES_DIR/common-coding-style.md\`
- \`$CURSOR_RULES_DIR/common-development-workflow.md\`
- \`$CURSOR_RULES_DIR/common-git-workflow.md\`
- \`$CURSOR_RULES_DIR/common-hooks.md\`
- \`$CURSOR_RULES_DIR/common-patterns.md\`
- \`$CURSOR_RULES_DIR/common-performance.md\`
- \`$CURSOR_RULES_DIR/common-security.md\`
- \`$CURSOR_RULES_DIR/common-testing.md\`

Treat these as strict defaults for planning, implementation, review, and verification in this repo.
EOF

write_extension_prompt "ecc-rules-pack-typescript.md" <<EOF
# ECC Rule Pack: typescript (optional)

Apply ECC common rules plus TypeScript-specific rules for this session.

## Common
Use \`$PROMPTS_DEST/ecc-rules-pack-common.md\`.

## TypeScript Extensions
- \`$CURSOR_RULES_DIR/typescript-coding-style.md\`
- \`$CURSOR_RULES_DIR/typescript-hooks.md\`
- \`$CURSOR_RULES_DIR/typescript-patterns.md\`
- \`$CURSOR_RULES_DIR/typescript-security.md\`
- \`$CURSOR_RULES_DIR/typescript-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

write_extension_prompt "ecc-rules-pack-python.md" <<EOF
# ECC Rule Pack: python (optional)

Apply ECC common rules plus Python-specific rules for this session.

## Common
Use \`$PROMPTS_DEST/ecc-rules-pack-common.md\`.

## Python Extensions
- \`$CURSOR_RULES_DIR/python-coding-style.md\`
- \`$CURSOR_RULES_DIR/python-hooks.md\`
- \`$CURSOR_RULES_DIR/python-patterns.md\`
- \`$CURSOR_RULES_DIR/python-security.md\`
- \`$CURSOR_RULES_DIR/python-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

write_extension_prompt "ecc-rules-pack-golang.md" <<EOF
# ECC Rule Pack: golang (optional)

Apply ECC common rules plus Go-specific rules for this session.

## Common
Use \`$PROMPTS_DEST/ecc-rules-pack-common.md\`.

## Go Extensions
- \`$CURSOR_RULES_DIR/golang-coding-style.md\`
- \`$CURSOR_RULES_DIR/golang-hooks.md\`
- \`$CURSOR_RULES_DIR/golang-patterns.md\`
- \`$CURSOR_RULES_DIR/golang-security.md\`
- \`$CURSOR_RULES_DIR/golang-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

write_extension_prompt "ecc-rules-pack-swift.md" <<EOF
# ECC Rule Pack: swift (optional)

Apply ECC common rules plus Swift-specific rules for this session.

## Common
Use \`$PROMPTS_DEST/ecc-rules-pack-common.md\`.

## Swift Extensions
- \`$CURSOR_RULES_DIR/swift-coding-style.md\`
- \`$CURSOR_RULES_DIR/swift-hooks.md\`
- \`$CURSOR_RULES_DIR/swift-patterns.md\`
- \`$CURSOR_RULES_DIR/swift-security.md\`
- \`$CURSOR_RULES_DIR/swift-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

if [[ "$MODE" == "apply" ]]; then
  sort -u "$extension_manifest" -o "$extension_manifest"
fi

log "Merging ECC MCP servers into $CONFIG_FILE (add-only, preserving user config)"
if [[ "$MODE" == "dry-run" ]]; then
  node "$MCP_MERGE_SCRIPT" "$CONFIG_FILE" --dry-run $UPDATE_MCP
else
  node "$MCP_MERGE_SCRIPT" "$CONFIG_FILE" $UPDATE_MCP
fi

log "Installing global git safety hooks"
if [[ "$MODE" == "dry-run" ]]; then
  HOME="$HOME" \
  CODEX_HOME="$CODEX_HOME" \
  AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}" \
  ECC_GLOBAL_HOOKS_DIR="${ECC_GLOBAL_HOOKS_DIR:-$CODEX_HOME/git-hooks}" \
    "$HOOKS_INSTALLER" --dry-run
else
  HOME="$HOME" \
  CODEX_HOME="$CODEX_HOME" \
  AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}" \
  ECC_GLOBAL_HOOKS_DIR="${ECC_GLOBAL_HOOKS_DIR:-$CODEX_HOME/git-hooks}" \
    "$HOOKS_INSTALLER"
fi

log "Running global regression sanity check"
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] %s\n' "$SANITY_CHECKER"
else
  HOME="$HOME" \
  CODEX_HOME="$CODEX_HOME" \
  AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}" \
  ECC_GLOBAL_HOOKS_DIR="${ECC_GLOBAL_HOOKS_DIR:-$CODEX_HOME/git-hooks}" \
    "$SANITY_CHECKER"
fi

log "Sync complete"
log "Backup saved at: $BACKUP_DIR"
log "Prompts generated: $((prompt_count + extension_count)) (commands: $prompt_count, extensions: $extension_count)"

if [[ "$MODE" == "apply" ]]; then
  log "Done. Restart Codex CLI to reload AGENTS, prompts, and MCP servers."
fi
