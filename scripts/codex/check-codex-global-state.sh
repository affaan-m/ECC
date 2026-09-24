#!/usr/bin/env bash
set -euo pipefail

# ECC Codex global regression sanity check.
# Validates that global ~/.codex state matches expected ECC integration.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

# Use rg if available, otherwise fall back to grep -E.
# All patterns in this script must be POSIX ERE compatible.
if command -v rg >/dev/null 2>&1; then
  search_file() { rg -n "$1" "$2" >/dev/null 2>&1; }
else
  search_file() { grep -En "$1" "$2" >/dev/null 2>&1; }
fi

CONFIG_FILE="$CODEX_HOME/config.toml"
AGENTS_FILE="$CODEX_HOME/AGENTS.md"
PROMPTS_DIR="$CODEX_HOME/prompts"
SKILLS_DIR="${AGENTS_HOME:-$HOME/.agents}/skills"
HOOKS_DIR_EXPECT="${ECC_GLOBAL_HOOKS_DIR:-$CODEX_HOME/git-hooks}"

failures=0
warnings=0
checks=0

ok() {
  checks=$((checks + 1))
  printf '[OK] %s\n' "$*"
}

warn() {
  checks=$((checks + 1))
  warnings=$((warnings + 1))
  printf '[WARN] %s\n' "$*"
}

fail() {
  checks=$((checks + 1))
  failures=$((failures + 1))
  printf '[FAIL] %s\n' "$*"
}

require_file() {
  local file="$1"
  local label="$2"
  if [[ -f "$file" ]]; then
    ok "$label exists ($file)"
  else
    fail "$label missing ($file)"
  fi
}

check_config_pattern() {
  local pattern="$1"
  local label="$2"
  if search_file "$pattern" "$CONFIG_FILE"; then
    ok "$label"
  else
    fail "$label"
  fi
}

check_config_absent() {
  local pattern="$1"
  local label="$2"
  if search_file "$pattern" "$CONFIG_FILE"; then
    fail "$label"
  else
    ok "$label"
  fi
}

printf 'ECC GLOBAL SANITY CHECK\n'
printf 'Repo: %s\n' "$REPO_ROOT"
printf 'Codex home: %s\n\n' "$CODEX_HOME"

require_file "$CONFIG_FILE" "Global config.toml"
require_file "$AGENTS_FILE" "Global AGENTS.md"

if [[ -f "$AGENTS_FILE" ]]; then
  if search_file '^# Everything Claude Code \(ECC\)' "$AGENTS_FILE"; then
    ok "AGENTS contains ECC root instructions"
  else
    fail "AGENTS missing ECC root instructions"
  fi

  if search_file '^# Codex Supplement \(From ECC \.codex/AGENTS\.md\)' "$AGENTS_FILE"; then
    ok "AGENTS contains ECC Codex supplement"
  else
    fail "AGENTS missing ECC Codex supplement"
  fi
fi

if [[ -f "$CONFIG_FILE" ]]; then
  check_config_pattern '^multi_agent[[:space:]]*=[[:space:]]*true' "multi_agent is enabled"
  check_config_absent '^[[:space:]]*collab[[:space:]]*=' "deprecated collab flag is absent"
  # persistent_instructions is recommended but optional; warn instead of fail
  # so users who rely on AGENTS.md alone are not blocked (#967).
  if search_file '^[[:space:]]*persistent_instructions[[:space:]]*=' "$CONFIG_FILE"; then
    ok "persistent_instructions is configured"
  else
    warn "persistent_instructions is not set (recommended but optional)"
  fi
  check_config_pattern '^\[profiles\.strict\]' "profiles.strict exists"
  check_config_pattern '^\[profiles\.yolo\]' "profiles.yolo exists"

  # Current default connector set (docs/MCP-CONNECTOR-POLICY.md): exactly
  # one connector. Former defaults (github, memory, sequential-thinking,
  # context7, exa, ...) are opt-in user choices, so they are not required.
  for section in \
    'mcp_servers.chrome-devtools'
  do
    if search_file "^\[$section\]" "$CONFIG_FILE"; then
      ok "MCP section [$section] exists"
    else
      fail "MCP section [$section] missing"
    fi
  done

  # ECC <= 2.0.0 emitted a url-only exa entry that Codex's stdio-only
  # schema rejects, breaking the whole config (#2224). Flag it so users
  # re-run the sync (which repairs it) or remove it manually.
  if search_file '^\[mcp_servers\.exa\]' "$CONFIG_FILE"; then
    exa_block="$(awk '/^\[mcp_servers\.exa\]/{flag=1;next}/^\[/{flag=0}flag' "$CONFIG_FILE")"
    if printf '%s\n' "$exa_block" | grep -Eq '^[[:space:]]*url[[:space:]]*=' \
      && ! printf '%s\n' "$exa_block" | grep -Eq '^[[:space:]]*command[[:space:]]*='; then
      fail "MCP section [mcp_servers.exa] uses a url key, which Codex rejects for stdio servers — re-run ecc-sync-codex to repair (#2224)"
    else
      ok "MCP section [mcp_servers.exa] uses the stdio form"
    fi
  fi
fi

declare -a required_skills=(
  api-design
  article-writing
  backend-patterns
  coding-standards
  content-engine
  e2e-testing
  eval-harness
  frontend-patterns
  frontend-slides
  investor-materials
  investor-outreach
  market-research
  security-review
  strategic-compact
  tdd-workflow
  verification-loop
)

if [[ -d "$SKILLS_DIR" ]]; then
  missing_skills=0
  for skill in "${required_skills[@]}"; do
    if [[ -d "$SKILLS_DIR/$skill" ]]; then
      :
    else
      printf '  - missing skill: %s\n' "$skill"
      missing_skills=$((missing_skills + 1))
    fi
  done

  if [[ "$missing_skills" -eq 0 ]]; then
    ok "All 16 ECC skills are present in $SKILLS_DIR"
  else
    warn "$missing_skills ECC skills missing from $SKILLS_DIR (install via ECC installer or npx skills)"
  fi
else
  warn "Skills directory missing ($SKILLS_DIR) — install via ECC installer or npx skills"
fi

if [[ -f "$PROMPTS_DIR/ecc-prompts-manifest.txt" ]]; then
  ok "Command prompts manifest exists"
else
  fail "Command prompts manifest missing"
fi

if [[ -f "$PROMPTS_DIR/ecc-extension-prompts-manifest.txt" ]]; then
  ok "Extension prompts manifest exists"
else
  fail "Extension prompts manifest missing"
fi

command_prompts_count="$(find "$PROMPTS_DIR" -maxdepth 1 -type f -name 'ecc-*.md' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$command_prompts_count" -ge 43 ]]; then
  ok "ECC prompts count is $command_prompts_count (expected >= 43)"
else
  fail "ECC prompts count is $command_prompts_count (expected >= 43)"
fi

hooks_path="$(git config --global --get core.hooksPath || true)"
if [[ -n "$hooks_path" ]]; then
  if [[ "$hooks_path" == "$HOOKS_DIR_EXPECT" ]]; then
    ok "Global hooksPath is set to $HOOKS_DIR_EXPECT"
  else
    warn "Global hooksPath is $hooks_path (expected $HOOKS_DIR_EXPECT)"
  fi
else
  fail "Global hooksPath is not configured"
fi

if [[ -x "$HOOKS_DIR_EXPECT/pre-commit" ]]; then
  ok "Global pre-commit hook is installed and executable"
else
  fail "Global pre-commit hook missing or not executable"
fi

if [[ -x "$HOOKS_DIR_EXPECT/pre-push" ]]; then
  ok "Global pre-push hook is installed and executable"
else
  fail "Global pre-push hook missing or not executable"
fi

if command -v ecc-sync-codex >/dev/null 2>&1; then
  ok "ecc-sync-codex command is in PATH"
else
  warn "ecc-sync-codex is not in PATH"
fi

if command -v ecc-install-git-hooks >/dev/null 2>&1; then
  ok "ecc-install-git-hooks command is in PATH"
else
  warn "ecc-install-git-hooks is not in PATH"
fi

if command -v ecc-check-codex >/dev/null 2>&1; then
  ok "ecc-check-codex command is in PATH"
else
  warn "ecc-check-codex is not in PATH (this is expected before alias setup)"
fi

printf '\nSummary: checks=%d, warnings=%d, failures=%d\n' "$checks" "$warnings" "$failures"
if [[ "$failures" -eq 0 ]]; then
  printf 'ECC GLOBAL SANITY: PASS\n'
else
  printf 'ECC GLOBAL SANITY: FAIL\n'
  exit 1
fi
