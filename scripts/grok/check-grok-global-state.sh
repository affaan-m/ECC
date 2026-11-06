#!/usr/bin/env bash
set -euo pipefail

# ECC Grok global regression sanity check.
# Validates that global ~/.grok state matches expected ECC integration.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GROK_HOME="${GROK_HOME:-$HOME/.grok}"

# Use rg if available, otherwise fall back to grep -E.
# All patterns in this script must be POSIX ERE compatible.
if command -v rg >/dev/null 2>&1; then
  search_file() { rg -n "$1" "$2" >/dev/null 2>&1; }
else
  search_file() { grep -En "$1" "$2" >/dev/null 2>&1; }
fi

CONFIG_FILE="$GROK_HOME/config.toml"
AGENTS_FILE="$GROK_HOME/AGENTS.md"
COMMANDS_DIR="$GROK_HOME/commands"
SKILLS_DIR="${AGENTS_HOME:-$HOME/.agents}/skills"
HOOKS_DIR_EXPECT="${ECC_GLOBAL_HOOKS_DIR:-$GROK_HOME/git-hooks}"

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

printf 'ECC GLOBAL SANITY CHECK\n'
printf 'Repo: %s\n' "$REPO_ROOT"
printf 'Grok home: %s\n\n' "$GROK_HOME"

require_file "$CONFIG_FILE" "Global config.toml"
require_file "$AGENTS_FILE" "Global AGENTS.md"

if [[ -f "$AGENTS_FILE" ]]; then
  if search_file '^# Everything Claude Code \(ECC\)' "$AGENTS_FILE"; then
    ok "AGENTS contains ECC root instructions"
  else
    fail "AGENTS missing ECC root instructions"
  fi

  if search_file '^# Grok Supplement \(From ECC \.grok/AGENTS\.md\)' "$AGENTS_FILE"; then
    ok "AGENTS contains ECC Grok supplement"
  else
    fail "AGENTS missing ECC Grok supplement"
  fi
fi

if [[ -f "$CONFIG_FILE" ]]; then
  for section in \
    'mcp_servers.chrome-devtools'
  do
    if search_file "^\[$section\]" "$CONFIG_FILE"; then
      ok "MCP section [$section] exists"
    else
      fail "MCP section [$section] missing"
    fi
  done
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
    warn "$missing_skills ECC skills missing from $SKILLS_DIR (sync copies from repo .agents/skills)"
  fi
else
  warn "Skills directory missing ($SKILLS_DIR) — sync copies from repo .agents/skills"
fi

if [[ -f "$COMMANDS_DIR/ecc-commands-manifest.txt" ]]; then
  ok "Command manifest exists"
else
  fail "Command manifest missing"
fi

if [[ -f "$COMMANDS_DIR/ecc-extension-commands-manifest.txt" ]]; then
  ok "Extension command manifest exists"
else
  fail "Extension command manifest missing"
fi

command_count="$(find "$COMMANDS_DIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$command_count" -ge 43 ]]; then
  ok "ECC Grok commands count is $command_count (expected >= 43)"
else
  fail "ECC Grok commands count is $command_count (expected >= 43)"
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

printf '\nSummary: checks=%d, warnings=%d, failures=%d\n' "$checks" "$warnings" "$failures"
if [[ "$failures" -eq 0 ]]; then
  printf 'ECC GLOBAL SANITY: PASS\n'
else
  printf 'ECC GLOBAL SANITY: FAIL\n'
  exit 1
fi
