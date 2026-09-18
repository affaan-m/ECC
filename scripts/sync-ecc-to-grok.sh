#!/usr/bin/env bash
set -Eeuo pipefail

# Sync Everything Claude Code (ECC) assets into a local Grok Build CLI setup.
# - Backs up ~/.grok config and AGENTS.md
# - Merges ECC AGENTS.md into existing AGENTS.md (marker-based, preserves user content)
# - Generates Grok slash commands from commands/*.md into ~/.grok/commands
# - Generates optional QA / language rule-pack commands
# - Installs global git safety hooks (pre-commit and pre-push)
# - Runs a post-sync global regression sanity check
# - Merges ECC MCP servers into config.toml (add-only via Node TOML parser)
#
# Run Grok once first so ~/.grok/config.toml exists, then:
#   bash scripts/sync-ecc-to-grok.sh
#   bash scripts/sync-ecc-to-grok.sh --dry-run
#   bash scripts/sync-ecc-to-grok.sh --update-mcp

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
GROK_HOME="${GROK_HOME:-$HOME/.grok}"
AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"

CONFIG_FILE="$GROK_HOME/config.toml"
AGENTS_FILE="$GROK_HOME/AGENTS.md"
AGENTS_ROOT_SRC="$REPO_ROOT/AGENTS.md"
AGENTS_GROK_SUPP_SRC="$REPO_ROOT/.grok/AGENTS.md"
GROK_AGENTS_SRC="$REPO_ROOT/.grok/agents"
GROK_AGENTS_DEST="$GROK_HOME/agents"
GROK_NAV_GUIDE_SRC="$REPO_ROOT/docs/GROK-NAVIGATION-GUIDE.md"
GROK_NAV_GUIDE_DEST="$GROK_HOME/docs/GROK-NAVIGATION-GUIDE.md"
GROK_COMMAND_AGENT_MAP_SRC="$REPO_ROOT/docs/COMMAND-AGENT-MAP.md"
GROK_COMMAND_AGENT_MAP_DEST="$GROK_HOME/docs/COMMAND-AGENT-MAP.md"
GROK_COMMANDS_QUICK_REF_SRC="$REPO_ROOT/COMMANDS-QUICK-REF.md"
GROK_COMMANDS_QUICK_REF_DEST="$GROK_HOME/COMMANDS-QUICK-REF.md"
GROK_CONTRIBUTING_SRC="$REPO_ROOT/CONTRIBUTING.md"
GROK_CONTRIBUTING_DEST="$GROK_HOME/CONTRIBUTING.md"
GROK_PR_TEMPLATE_SRC="$REPO_ROOT/.github/PULL_REQUEST_TEMPLATE.md"
GROK_PR_TEMPLATE_DEST="$GROK_HOME/.github/PULL_REQUEST_TEMPLATE.md"
COMMANDS_SRC="$REPO_ROOT/commands"
COMMANDS_DEST="$GROK_HOME/commands"
AGENTS_SKILLS_SRC="$REPO_ROOT/.agents/skills"
AGENTS_SKILLS_DEST="$AGENTS_HOME/skills"
HOOKS_INSTALLER="$REPO_ROOT/scripts/codex/install-global-git-hooks.sh"
SANITY_CHECKER="$REPO_ROOT/scripts/grok/check-grok-global-state.sh"
LEGACY_STATE_HELPER="$REPO_ROOT/scripts/codex/legacy-sync-state.js"
SKILLS_INSTALLER="$REPO_ROOT/scripts/grok/install-agents-skills.js"
COMMAND_GENERATOR="$REPO_ROOT/scripts/grok/generate-command-file.js"
COMMANDS_INSTALLER="$REPO_ROOT/scripts/grok/install-grok-commands.js"
CURSOR_RULES_DIR="$REPO_ROOT/.cursor/rules"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$GROK_HOME/backups/ecc-$STAMP"

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

MCP_MERGE_SCRIPT="$REPO_ROOT/scripts/codex/merge-mcp-config.js"

require_path "$REPO_ROOT/AGENTS.md" "ECC AGENTS.md"
require_path "$AGENTS_GROK_SUPP_SRC" "ECC Grok AGENTS supplement"
require_path "$GROK_AGENTS_SRC" "ECC Grok agent roles"
require_path "$GROK_NAV_GUIDE_SRC" "ECC Grok navigation guide"
require_path "$GROK_COMMAND_AGENT_MAP_SRC" "ECC command-agent map"
require_path "$GROK_COMMANDS_QUICK_REF_SRC" "ECC commands quick reference"
require_path "$GROK_CONTRIBUTING_SRC" "ECC contributing guide"
require_path "$GROK_PR_TEMPLATE_SRC" "ECC PR template"
require_path "$COMMANDS_SRC" "ECC commands directory"
require_path "$AGENTS_SKILLS_SRC" "ECC repo .agents/skills"
require_path "$SKILLS_INSTALLER" "ECC Grok skills installer"
require_path "$COMMAND_GENERATOR" "ECC Grok command generator"
require_path "$COMMANDS_INSTALLER" "ECC Grok commands installer"
require_path "$HOOKS_INSTALLER" "ECC global git hooks installer"
require_path "$SANITY_CHECKER" "ECC Grok sanity checker"
require_path "$LEGACY_STATE_HELPER" "ECC legacy sync state helper"
require_path "$CURSOR_RULES_DIR" "ECC Cursor rules directory"
require_path "$CONFIG_FILE" "Grok config.toml"
require_path "$MCP_MERGE_SCRIPT" "ECC MCP merge script"

if ! command -v node >/dev/null 2>&1; then
  log "ERROR: node is required for MCP config merging but was not found"
  exit 1
fi

log "Mode: $MODE"
log "Repo root: $REPO_ROOT"
log "Grok home: $GROK_HOME"

log "Creating backup folder: $BACKUP_DIR"
run_or_echo mkdir -p "$BACKUP_DIR"
run_or_echo cp "$CONFIG_FILE" "$BACKUP_DIR/config.toml"
if [[ -f "$AGENTS_FILE" ]]; then
  run_or_echo cp "$AGENTS_FILE" "$BACKUP_DIR/AGENTS.md"
fi

LEGACY_STATE_PATH=""
record_managed_path() {
  local managed_path="$1"
  if [[ "$MODE" == "apply" ]]; then
    node "$LEGACY_STATE_HELPER" record --state "$LEGACY_STATE_PATH" --path "$managed_path"
  fi
}

if [[ "$MODE" == "apply" ]]; then
  previous_hooks_path="$(git config --global core.hooksPath || true)"
  LEGACY_STATE_PATH="$(
    node "$LEGACY_STATE_HELPER" begin \
      --grok-home "$GROK_HOME" \
      --backup-dir "$BACKUP_DIR" \
      --previous-hooks-path "$previous_hooks_path" \
      --installed-hooks-path "${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}" \
      --trusted-root "$AGENTS_HOME"
  )"
  rollback_legacy_sync() {
    local exit_status="${1:-1}"
    trap - ERR INT TERM
    log "Install interrupted; restoring the pre-sync Grok state"
    if ! node "$LEGACY_STATE_HELPER" rollback --state "$LEGACY_STATE_PATH"; then
      log "ERROR: Automatic rollback was partial. Review: $LEGACY_STATE_PATH"
    fi
    exit "$exit_status"
  }
  trap 'rollback_legacy_sync $?' ERR
  trap 'rollback_legacy_sync 130' INT
  trap 'rollback_legacy_sync 143' TERM

  record_managed_path "$CONFIG_FILE"
  record_managed_path "$AGENTS_FILE"
fi

ECC_BEGIN_MARKER="<!-- BEGIN ECC -->"
ECC_END_MARKER="<!-- END ECC -->"

compose_ecc_block() {
  printf '%s\n' "$ECC_BEGIN_MARKER"
  cat "$AGENTS_ROOT_SRC"
  printf '\n\n---\n\n'
  printf '# Grok Supplement (From ECC .grok/AGENTS.md)\n\n'
  cat "$AGENTS_GROK_SUPP_SRC"
  printf '\n%s\n' "$ECC_END_MARKER"
}

log "Merging ECC AGENTS into $AGENTS_FILE (preserving user content)"
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] merge ECC block into %s from %s + %s\n' "$AGENTS_FILE" "$AGENTS_ROOT_SRC" "$AGENTS_GROK_SUPP_SRC"
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
    compose_ecc_block > "$AGENTS_FILE"
  elif awk -v b="$ECC_BEGIN_MARKER" -v e="$ECC_END_MARKER" '
        { gsub(/\r$/, "") }
        $0 == b { bc++; if (!fb) fb = NR }
        $0 == e { ec++; if (!fe) fe = NR }
        END { exit !(bc == 1 && ec == 1 && fb < fe) }
      ' "$AGENTS_FILE"; then
    replace_ecc_section
  elif awk -v b="$ECC_BEGIN_MARKER" -v e="$ECC_END_MARKER" '
        { gsub(/\r$/, "") }
        $0 == b { bc++ } $0 == e { ec++ }
        END { exit !((bc + ec) > 0) }
      ' "$AGENTS_FILE"; then
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
    log "No ECC markers found — appending managed block (backup saved)"
    {
      printf '\n\n'
      compose_ecc_block
    } >> "$AGENTS_FILE"
  fi
fi

log "Skipping Codex-style baseline config merge (Grok schema differs). MCP servers are merged add-only."

log "Syncing Grok navigation guide"
run_or_echo mkdir -p "$(dirname "$GROK_NAV_GUIDE_DEST")"
record_managed_path "$GROK_NAV_GUIDE_DEST"
run_or_echo cp "$GROK_NAV_GUIDE_SRC" "$GROK_NAV_GUIDE_DEST"
record_managed_path "$GROK_COMMAND_AGENT_MAP_DEST"
run_or_echo cp "$GROK_COMMAND_AGENT_MAP_SRC" "$GROK_COMMAND_AGENT_MAP_DEST"
record_managed_path "$GROK_COMMANDS_QUICK_REF_DEST"
run_or_echo cp "$GROK_COMMANDS_QUICK_REF_SRC" "$GROK_COMMANDS_QUICK_REF_DEST"
record_managed_path "$GROK_CONTRIBUTING_DEST"
run_or_echo cp "$GROK_CONTRIBUTING_SRC" "$GROK_CONTRIBUTING_DEST"
run_or_echo mkdir -p "$(dirname "$GROK_PR_TEMPLATE_DEST")"
record_managed_path "$GROK_PR_TEMPLATE_DEST"
run_or_echo cp "$GROK_PR_TEMPLATE_SRC" "$GROK_PR_TEMPLATE_DEST"

log "Syncing sample Grok agent definition files"
run_or_echo mkdir -p "$GROK_AGENTS_DEST"
for agent_file in "$GROK_AGENTS_SRC"/*.md; do
  [[ -f "$agent_file" ]] || continue
  agent_name="$(basename "$agent_file")"
  dest="$GROK_AGENTS_DEST/$agent_name"
  if [[ -e "$dest" ]]; then
    log "Keeping existing Grok agent definition: $dest"
  else
    record_managed_path "$dest"
    run_or_echo cp "$agent_file" "$dest"
  fi
done

log "Installing ECC skills from $AGENTS_SKILLS_SRC into $AGENTS_SKILLS_DEST"
if [[ "$MODE" == "dry-run" ]]; then
  node "$SKILLS_INSTALLER" "$AGENTS_SKILLS_SRC" "$AGENTS_SKILLS_DEST" --dry-run
else
  run_or_echo mkdir -p "$AGENTS_SKILLS_DEST"
  _skills_copied="$(mktemp)"
  node "$SKILLS_INSTALLER" "$AGENTS_SKILLS_SRC" "$AGENTS_SKILLS_DEST" --dry-run > "$_skills_copied"
  while IFS= read -r copied; do
    [[ -n "$copied" ]] || continue
    record_managed_path "$copied"
  done < "$_skills_copied"
  rm -f "$_skills_copied"
  node "$SKILLS_INSTALLER" "$AGENTS_SKILLS_SRC" "$AGENTS_SKILLS_DEST" >/dev/null
fi

log "Generating Grok slash commands from ECC commands"
run_or_echo mkdir -p "$COMMANDS_DEST"
manifest="$COMMANDS_DEST/ecc-commands-manifest.txt"
record_managed_path "$manifest"
command_count=0
COMMAND_INSTALL_ARGS=(
  --src "$COMMANDS_SRC"
  --dest "$COMMANDS_DEST"
  --manifest "$manifest"
  --skill-root "$AGENTS_HOME/skills"
  --skill-root "$GROK_HOME/skills"
  --skill-root "$GROK_HOME/bundled/skills"
  --skill-root "$HOME/.claude/skills"
  --skill-root "$HOME/.claude/skills/ecc"
  --skill-root "$HOME/.cursor/skills"
)
if [[ "$MODE" == "dry-run" ]]; then
  node "$COMMANDS_INSTALLER" "${COMMAND_INSTALL_ARGS[@]}" --dry-run >/dev/null
  command_count="$(find "$COMMANDS_SRC" -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')"
else
  _commands_copied="$(mktemp)"
  node "$COMMANDS_INSTALLER" "${COMMAND_INSTALL_ARGS[@]}" --dry-run > "$_commands_copied"
  while IFS= read -r copied; do
    [[ -n "$copied" ]] || continue
    record_managed_path "$copied"
  done < "$_commands_copied"
  rm -f "$_commands_copied"
  node "$COMMANDS_INSTALLER" "${COMMAND_INSTALL_ARGS[@]}" >/dev/null
  command_count="$(find "$COMMANDS_SRC" -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')"
fi

log "Generating Grok tool commands + optional rule-pack commands"
extension_manifest="$COMMANDS_DEST/ecc-extension-commands-manifest.txt"
record_managed_path "$extension_manifest"
previous_extension_files=()
if [[ -f "$extension_manifest" ]]; then
  while IFS= read -r previous_extension; do
    [[ -n "$previous_extension" ]] || continue
    previous_extension_files+=("$previous_extension")
  done < "$extension_manifest"
fi
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] > %s\n' "$extension_manifest"
else
  : > "$extension_manifest"
fi

extension_count=0

write_extension_command() {
  local name="$1"
  local description="$2"
  local file="$COMMANDS_DEST/$name"
  if [[ "$MODE" == "dry-run" ]]; then
    printf '[dry-run] generate %s\n' "$file"
    cat >/dev/null
  else
    record_managed_path "$file"
    node "$COMMAND_GENERATOR" \
      --out "$file" \
      --name "${name%.md}" \
      --description "$description" \
      --body-file -
    printf '%s\n' "$name" >> "$extension_manifest"
  fi
  extension_count=$((extension_count + 1))
}

write_extension_command "tool-run-tests.md" "Run the repository test suite with package-manager autodetection and concise reporting." <<EOF
# ECC Tool Command: run-tests

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

write_extension_command "tool-check-coverage.md" "Analyze coverage and compare it to an 80% threshold." <<EOF
# ECC Tool Command: check-coverage

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

write_extension_command "tool-security-audit.md" "Run a practical security audit: dependencies, secrets, and high-risk code patterns." <<EOF
# ECC Tool Command: security-audit

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

write_extension_command "rules-pack-common.md" "Apply ECC common engineering rules for this session." <<EOF
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

write_extension_command "rules-pack-typescript.md" "Apply ECC common rules plus TypeScript-specific rules for this session." <<EOF
# ECC Rule Pack: typescript (optional)

Apply ECC common rules plus TypeScript-specific rules for this session.

## Common
Use \`$COMMANDS_DEST/rules-pack-common.md\`.

## TypeScript Extensions
- \`$CURSOR_RULES_DIR/typescript-coding-style.md\`
- \`$CURSOR_RULES_DIR/typescript-hooks.md\`
- \`$CURSOR_RULES_DIR/typescript-patterns.md\`
- \`$CURSOR_RULES_DIR/typescript-security.md\`
- \`$CURSOR_RULES_DIR/typescript-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

write_extension_command "rules-pack-python.md" "Apply ECC common rules plus Python-specific rules for this session." <<EOF
# ECC Rule Pack: python (optional)

Apply ECC common rules plus Python-specific rules for this session.

## Common
Use \`$COMMANDS_DEST/rules-pack-common.md\`.

## Python Extensions
- \`$CURSOR_RULES_DIR/python-coding-style.md\`
- \`$CURSOR_RULES_DIR/python-hooks.md\`
- \`$CURSOR_RULES_DIR/python-patterns.md\`
- \`$CURSOR_RULES_DIR/python-security.md\`
- \`$CURSOR_RULES_DIR/python-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

write_extension_command "rules-pack-golang.md" "Apply ECC common rules plus Go-specific rules for this session." <<EOF
# ECC Rule Pack: golang (optional)

Apply ECC common rules plus Go-specific rules for this session.

## Common
Use \`$COMMANDS_DEST/rules-pack-common.md\`.

## Go Extensions
- \`$CURSOR_RULES_DIR/golang-coding-style.md\`
- \`$CURSOR_RULES_DIR/golang-hooks.md\`
- \`$CURSOR_RULES_DIR/golang-patterns.md\`
- \`$CURSOR_RULES_DIR/golang-security.md\`
- \`$CURSOR_RULES_DIR/golang-testing.md\`

Language-specific guidance overrides common rules when they conflict.
EOF

write_extension_command "rules-pack-swift.md" "Apply ECC common rules plus Swift-specific rules for this session." <<EOF
# ECC Rule Pack: swift (optional)

Apply ECC common rules plus Swift-specific rules for this session.

## Common
Use \`$COMMANDS_DEST/rules-pack-common.md\`.

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
  if [[ ${#previous_extension_files[@]} -gt 0 ]]; then
    for previous_extension in "${previous_extension_files[@]}"; do
      local_name="$(basename "$previous_extension")"
      if [[ "$local_name" != "$previous_extension" || "$local_name" == "." || "$local_name" == ".." ]]; then
        log "WARNING: ignoring unsafe extension manifest entry: $previous_extension"
        continue
      fi
      if ! grep -Fxq "$local_name" "$extension_manifest"; then
        stale="$COMMANDS_DEST/$local_name"
        if [[ -f "$stale" && ! -L "$stale" ]]; then
          rm -f "$stale"
        fi
      fi
    done
  fi
fi

log "Merging ECC MCP servers into $CONFIG_FILE (add-only, preserving user config)"
if [[ "$MODE" == "dry-run" ]]; then
  node "$MCP_MERGE_SCRIPT" "$CONFIG_FILE" --harness grok --dry-run $UPDATE_MCP
else
  node "$MCP_MERGE_SCRIPT" "$CONFIG_FILE" --harness grok $UPDATE_MCP
fi

log "Installing global git safety hooks"
if [[ "$MODE" == "dry-run" ]]; then
  HOME="$HOME" \
  GROK_HOME="$GROK_HOME" \
  AGENTS_HOME="$AGENTS_HOME" \
  ECC_GLOBAL_HOOKS_DIR="${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}" \
    "$HOOKS_INSTALLER" --dry-run
else
  record_managed_path "${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}/pre-commit"
  record_managed_path "${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}/pre-push"
  HOME="$HOME" \
  GROK_HOME="$GROK_HOME" \
  AGENTS_HOME="$AGENTS_HOME" \
  ECC_GLOBAL_HOOKS_DIR="${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}" \
    "$HOOKS_INSTALLER"
fi

log "Running global regression sanity check"
if [[ "$MODE" == "dry-run" ]]; then
  printf '[dry-run] %s\n' "$SANITY_CHECKER"
else
  HOME="$HOME" \
  GROK_HOME="$GROK_HOME" \
  AGENTS_HOME="$AGENTS_HOME" \
  ECC_GLOBAL_HOOKS_DIR="${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}" \
    "$SANITY_CHECKER"
fi

log "Sync complete"
log "Backup saved at: $BACKUP_DIR"
log "Commands generated: $((command_count + extension_count)) (commands: $command_count, extensions: $extension_count)"

if [[ "$MODE" == "apply" ]]; then
  node "$LEGACY_STATE_HELPER" finalize --state "$LEGACY_STATE_PATH"
  trap - ERR INT TERM
  log "Done. Restart Grok CLI to reload AGENTS, commands, and MCP servers."
fi
