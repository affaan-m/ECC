#!/usr/bin/env bash
# setup-claude.sh — end-to-end Claude Code setup: CLI + plugin + ECC + Telegram hook.
# Hardcoded modules, always overwrites, user scope only.
# shellcheck shell=bash

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────────
readonly TAG="claude"
readonly CLAUDE_HOME="${HOME}/.claude"
# This script lives inside the ECC tree it installs from (thaint-setup/), so the
# source is simply the repo root — no clone, no fetch, no version pin. Whatever
# ref you checked out is what gets installed; git already did that work.
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly CLAUDE_INSTALL_URL="${CLAUDE_INSTALL_URL:-https://claude.ai/install.sh}"
readonly CLAUDE_PLUGIN="${CLAUDE_PLUGIN:-claude-md-management@claude-plugins-official}"
readonly CLAUDE_MARKETPLACE_SOURCE="${CLAUDE_MARKETPLACE_SOURCE:-anthropics/${CLAUDE_PLUGIN##*@}}"

# Credentials are env-only (settings.json env block, see Claude Code docs).
# Optionally provided at install time to auto-populate settings.json.
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# ── Mutable state ────────────────────────────────────────────────────────────
SOURCE="$REPO_ROOT"
DRY_RUN=0
VERBOSE=0
TMP_FILES=()

# ── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
  (( ${#TMP_FILES[@]} == 0 )) && return 0
  local f
  for f in "${TMP_FILES[@]}"; do
    [[ -n "$f" && -e "$f" ]] && rm -f "$f"
  done
}
trap cleanup EXIT

new_tmp() {
  local f
  f="$(mktemp)"
  TMP_FILES+=("$f")
  printf '%s' "$f"
}

# ── Logging ──────────────────────────────────────────────────────────────────
log()  { printf '[%s] %s\n' "$TAG" "$*"; }
warn() { printf '[%s] warn: %s\n' "$TAG" "$*" >&2; }
die()  { printf '[%s] error: %s\n' "$TAG" "$*" >&2; exit 1; }

# Run a command, honoring DRY_RUN and VERBOSE.
run() {
  if (( DRY_RUN )); then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  if (( VERBOSE )); then
    printf '[%s] $ %s\n' "$TAG" "$*"
  fi
  "$@"
}

require_cmd() {
  local c hint
  for c in "$@"; do
    command -v "$c" >/dev/null && continue
    case "$c" in
      jq)       hint="install via: apt install -y jq  /  brew install jq" ;;
      curl)     hint="install via: apt install -y curl  /  brew install curl" ;;
      git)      hint="install via: apt install -y git  /  brew install git" ;;
      node|npm) hint="install Node.js from https://nodejs.org or via nvm" ;;
      *)        hint="" ;;
    esac
    if [[ -n "$hint" ]]; then
      die "required command missing: $c — $hint"
    else
      die "required command missing: $c"
    fi
  done
}

# ── Usage / args ─────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $0 [--version <ref>] [--source <path>] [--dry-run] [--verbose]

End-to-end Claude Code setup. Installs (always overwrites) into ${CLAUDE_HOME}:
  claude-code CLI (if missing), skip-onboarding flag in ~/.claude.json,
  marketplace + plugin ${CLAUDE_PLUGIN} (if missing),
  agents, commands, hooks-runtime, configure-ecc, strategic-compact, telegram-hook
Shell rc patch (.zshrc or .bashrc):
  alias clauded='claude --dangerously-skip-permissions'
  export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1

Installs from the ECC tree this script lives in (${REPO_ROOT}).
To install a different version, check out that ref and re-run.

Options:
  --dry-run         Print actions without executing
  --verbose, -v     Log every command
  -h, --help        Show this help

Env overrides:
  CLAUDE_INSTALL_URL, CLAUDE_PLUGIN, CLAUDE_MARKETPLACE_SOURCE
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
EOF
}

require_value() {
  [[ -n "${2:-}" && "${2:0:2}" != "--" ]] || die "$1 requires a value (try --help)"
}

parse_args() {
  while (( $# )); do
    case "$1" in
      --dry-run)    DRY_RUN=1; shift ;;
      --verbose|-v) VERBOSE=1; shift ;;
      -h|--help)    usage; exit 0 ;;
      *)            die "unknown arg: $1 (try --help)" ;;
    esac
  done
}

# ── Prerequisites: Claude Code CLI + plugin ──────────────────────────────────
ensure_claude_code() {
  if command -v claude >/dev/null 2>&1; then
    log "claude CLI present: $(claude --version 2>/dev/null || echo unknown)"
    return
  fi
  log "installing claude CLI from $CLAUDE_INSTALL_URL"
  require_cmd curl
  if (( DRY_RUN )); then
    printf '[dry-run] curl -fsSL %s | bash\n' "$CLAUDE_INSTALL_URL"
    return
  fi
  curl -fsSL "$CLAUDE_INSTALL_URL" | bash \
    || die "claude CLI install failed"
  command -v claude >/dev/null 2>&1 \
    || die "claude CLI not on PATH after install — open a new shell or check ~/.local/bin"
}

ensure_onboarding() {
  local config="${HOME}/.claude.json"
  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (hasCompletedOnboarding=true)\n' "$config"
    return
  fi

  if [[ -f "$config" ]] && [[ "$(jq -r '.hasCompletedOnboarding // false' "$config")" == "true" ]]; then
    log "onboarding already marked complete: $config"
    return
  fi

  [[ -f "$config" ]] || printf '{}\n' > "$config"
  local tmp
  tmp="$(new_tmp)"
  jq '.hasCompletedOnboarding = true' "$config" > "$tmp" \
    || die "jq failed to patch $config"
  mv "$tmp" "$config"
  log "marked onboarding complete: $config"
}

require_claude_cli() {
  command -v claude >/dev/null 2>&1 && return 0
  if (( DRY_RUN )); then
    printf '[dry-run] (skip — claude CLI not present)\n'
    return 1
  fi
  die "claude CLI missing — cannot proceed"
}

ensure_marketplace() {
  local marketplace="${CLAUDE_PLUGIN##*@}"
  require_claude_cli || return 0
  if claude plugin marketplace list 2>/dev/null | grep -Fq "$marketplace"; then
    log "marketplace already added: $marketplace"
    return
  fi
  log "adding marketplace $marketplace ($CLAUDE_MARKETPLACE_SOURCE)"
  run claude plugin marketplace add "$CLAUDE_MARKETPLACE_SOURCE"
}

ensure_plugin() {
  local plugin="$CLAUDE_PLUGIN"
  local plugin_name="${plugin%@*}"
  require_claude_cli || return 0
  if claude plugin list 2>/dev/null | grep -Fq "$plugin_name"; then
    log "plugin already installed: $plugin"
    return
  fi
  log "installing plugin $plugin"
  run claude plugin install "$plugin"
}

# ── Source description ───────────────────────────────────────────────────────
# Reports the checked-out ref for the log line. Purely informational: the tree
# is installed as-is whether or not git can name it.
describe_source() {
  git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null \
    || printf '%s' 'unknown ref'
}

# ── Filesystem helpers ───────────────────────────────────────────────────────
copy_dir() {
  local src="$1" dst="$2"
  [[ -d "$src" ]] || { warn "missing $src — skipped"; return; }
  run mkdir -p "$dst"
  run cp -rf "$src/." "$dst/"
}

# ── Installers ───────────────────────────────────────────────────────────────
# Installable directories.  Each entry is a label; the source/dest path is
# derived automatically (labels map 1:1 to directory names under $SOURCE and
# $CLAUDE_HOME, with an optional "skills/" prefix for skill entries).
readonly INSTALL_ITEMS=(
  agents
  commands
  skills/configure-ecc
  skills/strategic-compact
)

install_all_dirs() {
  local rel_path label
  for rel_path in "${INSTALL_ITEMS[@]}"; do
    label="${rel_path##*/}"       # e.g. "configure-ecc" from "skills/configure-ecc"
    log "$label"
    copy_dir "$SOURCE/$rel_path" "$CLAUDE_HOME/$rel_path"
  done
}

install_hooks_runtime() {
  log "hooks-runtime"
  [[ -f "$SOURCE/install.sh" ]] || die "hooks-runtime: $SOURCE/install.sh missing"
  require_cmd node npm
  [[ -x "$SOURCE/install.sh" ]] || run chmod +x "$SOURCE/install.sh"
  if (( DRY_RUN )); then
    printf '[dry-run] (cd %s && ./install.sh --target claude --modules hooks-runtime)\n' "$SOURCE"
  else
    ( cd "$SOURCE" && ./install.sh --target claude --modules hooks-runtime )
  fi
}

# ── ECC session-id env var fix ──────────────────────────────────────────────
# Upstream ECC (every release through v2.1.0) reads CLAUDE_SESSION_ID, but
# Claude Code exports CLAUDE_CODE_SESSION_ID into hook subprocesses — so every
# hook that keys state by session id collapses onto 'default' and shares one
# bucket across all sessions. Patches the installed copies under $CLAUDE_HOME
# only, leaving this repo's tracked files untouched so the tree stays clean for
# `git merge upstream/main`. (Superseded once the fix lands as a commit here.)
# A failure is warned, not fatal: the patcher exits non-zero on any file it
# could not rewrite, and one unhandled hook must not skip install_telegram_hook
# and patch_shell_rc, which both run after this.
patch_ecc_session_id() {
  log "ecc-session-id-fix"
  local script_dir patcher
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  patcher="${script_dir}/patch-ecc-session-id.sh"
  if [[ ! -f "$patcher" ]]; then
    warn "ACTION NEEDED: patch-ecc-session-id.sh not found at $patcher"
    warn "  the ECC hooks will keep reading the unset CLAUDE_SESSION_ID and share one"
    warn "  'default' state bucket across every session — fetch the file and re-run"
    return 0
  fi

  local args=() rc=0
  (( DRY_RUN )) && args+=(--dry-run)
  (( VERBOSE )) && args+=(--verbose)
  # Invoked directly, not through run(): run() short-circuits under DRY_RUN, so
  # the patcher would never execute and --dry-run would say nothing about whether
  # its substitutions still match. Given --dry-run the patcher writes nothing.
  if (( ${#args[@]} )); then
    bash "$patcher" "${args[@]}" || rc=$?
  else
    bash "$patcher" || rc=$?
  fi
  if (( rc != 0 )); then
    warn "ACTION NEEDED: the session-id fix did not complete (exit $rc)"
    warn "  (see the warnings above — some hooks may still read CLAUDE_SESSION_ID)"
  fi
}

# ── ECC suggest-compact delegation nudge ────────────────────────────────────
# install_hooks_runtime copies suggest-compact.js with a bare fs.copyFileSync
# (ECC's apply.js only merge-treats settings.json), so it wipes the local
# "[Delegation]" nudge on every run. Re-apply it here, after that copy.
# A failure is warned, not fatal: the anchor is tied to ECC v1.10.0's shape and
# WILL stop matching when ECC rewrites the hook — a lost comment must not stop
# the rest of the install.
patch_ecc_suggest_compact() {
  log "ecc-delegation-nudge"
  local script_dir patcher
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  patcher="${script_dir}/patch-ecc-suggest-compact.sh"
  if [[ ! -f "$patcher" ]]; then
    warn "ACTION NEEDED: patch-ecc-suggest-compact.sh not found at $patcher"
    warn "  the [Delegation] nudge will be absent from suggest-compact.js — fetch it and re-run"
    return 0
  fi

  local args=() rc=0
  (( DRY_RUN )) && args+=(--dry-run)
  (( VERBOSE )) && args+=(--verbose)
  # Invoked directly, not through run(): see patch_ecc_session_id above.
  if (( ${#args[@]} )); then
    bash "$patcher" "${args[@]}" || rc=$?
  else
    bash "$patcher" || rc=$?
  fi
  if (( rc != 0 )); then
    warn "ACTION NEEDED: the [Delegation] nudge was not re-applied to suggest-compact.js"
    warn "  (see the warnings above; re-author it by hand and fix the patcher's anchor)"
  fi
}

install_telegram_hook() {
  log "telegram-hook"
  require_cmd node

  local hook_dir="${CLAUDE_HOME}/scripts/hooks"
  local hook_js="${hook_dir}/telegram-notify.js"
  local settings="${CLAUDE_HOME}/settings.json"

  if (( DRY_RUN )); then
    printf '[dry-run] mkdir -p %s\n' "$hook_dir"
    printf '[dry-run] write %s (chmod 700)\n' "$hook_js"
  else
    run mkdir -p "$hook_dir"
    telegram_js_source > "$hook_js"
    chmod 700 "$hook_js"
  fi

  patch_settings_telegram "$settings" "$hook_js"
  ensure_telegram_env "$settings"
}

ensure_telegram_env() {
  local settings="$1"

  if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
    patch_settings_env "$settings" "$TELEGRAM_BOT_TOKEN" "$TELEGRAM_CHAT_ID"
    log "telegram credentials written to settings.json env block"
    return
  fi

  if [[ -f "$settings" ]]; then
    local has_token has_chat
    has_token="$(jq -r '.env.TELEGRAM_BOT_TOKEN // empty' "$settings")"
    has_chat="$(jq -r '.env.TELEGRAM_CHAT_ID // empty'  "$settings")"
    if [[ -n "$has_token" && -n "$has_chat" ]]; then
      log "telegram credentials already present in settings.json env"
      return
    fi
  fi

  warn "telegram credentials NOT configured — hook will be a no-op until you set them."
  cat >&2 <<EOF
[$TAG] Either re-run with env vars:
[$TAG]   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=123 bash $0
[$TAG] Or paste into ${settings}:
[$TAG]   {
[$TAG]     "env": {
[$TAG]       "TELEGRAM_BOT_TOKEN": "<your-bot-token>",
[$TAG]       "TELEGRAM_CHAT_ID":   "<your-chat-id>"
[$TAG]     }
[$TAG]   }
[$TAG] Docs: https://code.claude.com/docs/en/env-vars#in-settings-files
EOF
}

patch_settings_env() {
  local settings="$1" token="$2" chat="$3"

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)\n' "$settings"
    return
  fi

  [[ -f "$settings" ]] || printf '{}\n' > "$settings"
  local tmp
  tmp="$(new_tmp)"
  jq \
    --arg token "$token" \
    --arg chat  "$chat" \
    '.env //= {} | .env.TELEGRAM_BOT_TOKEN = $token | .env.TELEGRAM_CHAT_ID = $chat' \
    "$settings" > "$tmp" \
    || die "jq failed to patch env block in $settings"
  mv "$tmp" "$settings"
}

patch_settings_telegram() {
  local settings="$1" hook_js="$2"

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (clean Stop, set Notification)\n' "$settings"
    return
  fi

  [[ -f "$settings" ]] || printf '{}\n' > "$settings"

  local tmp
  tmp="$(new_tmp)"
  jq \
    --arg cmd "node $hook_js" \
    --arg marker "telegram-notify.js" \
    '
    .hooks //= {} |
    .hooks.Stop //= [] |
    .hooks.Notification //= [] |
    .hooks.Stop = [
      .hooks.Stop[] | select(.hooks[0].command // "" | contains($marker) | not)
    ] |
    .hooks.Notification = (
      [.hooks.Notification[] | select(.hooks[0].command // "" | contains($marker) | not)]
      + [{ matcher: "", hooks: [ { type: "command", command: $cmd, timeout: 10, async: true } ] }]
    )
    ' "$settings" > "$tmp" \
    || die "jq failed to patch $settings"
  mv "$tmp" "$settings"
  log "patched settings.json (telegram entry in Notification)"
}

# Idempotent jq patch: always overwrites .statusLine so config matches exactly.
patch_settings_statusline() {
  local settings="${CLAUDE_HOME}/settings.json"
  local tmp

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (.statusLine)\n' "$settings"
    return
  fi

  # Build the command from a heredoc to avoid quoting hell with nested single quotes.
  # shellcheck disable=SC2016
  local statusline_cmd
  statusline_cmd="$(cat <<'CMD'
input=$(cat); model=$(echo "$input" | jq -r '.model.display_name // empty'); [ -z "$model" ] && exit 0; used=$(echo "$input" | jq -r '.context_window.used_percentage // empty'); bar_total=30; bar_out=""; if [ -n "$used" ] && [ "$used" != "null" ]; then used_int=$(printf "%.0f" "$used"); [ "$used_int" -lt 0 ] && used_int=0; [ "$used_int" -gt 100 ] && used_int=100; filled=$(( used_int * bar_total / 100 )); empty=$(( bar_total - filled )); if [ "$used_int" -lt 60 ]; then color_fill="\033[32m"; color_empty="\033[90m"; elif [ "$used_int" -lt 80 ]; then color_fill="\033[33m"; color_empty="\033[90m"; else color_fill="\033[31m"; color_empty="\033[90m"; fi; bar_filled=$(printf '%0.s#' $(seq 1 "$filled" 2>/dev/null)); bar_empty=$(printf '%0.s-' $(seq 1 "$empty" 2>/dev/null)); bar_out=$(printf "${color_fill}%s${color_empty}%s\033[0m" "$bar_filled" "$bar_empty"); bar_out="$bar_out $(printf '%3d%%' "$used_int")"; fi; printf "%s  \033[1m%s\033[0m" "$bar_out" "$model"
CMD
)"

  [[ -f "$settings" ]] || printf '{}\n' > "$settings"

  tmp="$(new_tmp)"
  jq --arg cmd "$statusline_cmd" \
    '.statusLine = { "type": "command", "command": $cmd }' \
    "$settings" > "$tmp" \
    || die "jq failed to patch statusLine in $settings"
  mv "$tmp" "$settings"
  log "patched settings.json (.statusLine)"
}

# ── MCP catalog patch ───────────────────────────────────────────────────────
# Reads ECC's mcp-servers.json catalog and installs all servers into
# ~/.claude.json (user scope) with ${VAR} placeholders. Servers without
# required env vars will fail to parse (effectively disabled); set the env
# var to auto-enable. Always overwrites .mcpServers so config matches exactly.
patch_mcp_catalog() {
  local config="${HOME}/.claude.json"
  local mcp_src="${SOURCE}/mcp-configs/mcp-servers.json"
  local tmp

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (.mcpServers)\n' "$config"
    return
  fi

  [[ -f "$mcp_src" ]] || { warn "ECC mcp-servers.json not found at $mcp_src — skipped"; return; }

  # 1. Replace all YOUR_*_HERE placeholders with ${VAR_NAME} syntax.
  #    Claude Code expands ${VAR} in command/args/env/url/headers fields.
  #    If the env var is unset, parsing fails and the server stays disabled.
  # 2. Replace filesystem path placeholder with a safe default.
  # 3. Strip description fields and _comments (not valid in .claude.json).
  local mcp_processed
  mcp_processed="$(new_tmp)"
  sed \
    -e 's|/path/to/your/projects|${MCP_FILESYSTEM_PATH:-$HOME}|g' \
    "$mcp_src" \
    | jq '
      def fix_placeholders:
        if type == "object" then
          to_entries
          | map(
            if .value == null then .
            elif (.key == "description") then empty
            else .value = (.value | fix_placeholders) | .
            end
          )
          | from_entries
        elif type == "array" then
          map(fix_placeholders)
        elif type == "string" then
          gsub(
            "YOUR_JIRA_URL_HERE";           "${JIRA_URL}"
          ) | gsub(
            "YOUR_JIRA_EMAIL_HERE";         "${JIRA_EMAIL}"
          ) | gsub(
            "YOUR_JIRA_API_TOKEN_HERE";     "${JIRA_API_TOKEN}"
          ) | gsub(
            "YOUR_GITHUB_PAT_HERE";         "${GITHUB_PERSONAL_ACCESS_TOKEN}"
          ) | gsub(
            "YOUR_FIRECRAWL_KEY_HERE";      "${FIRECRAWL_API_KEY}"
          ) | gsub(
            "YOUR_PROJECT_REF";             "${SUPABASE_PROJECT_REF}"
          ) | gsub(
            "YOUR_EXA_API_KEY_HERE";        "${EXA_API_KEY}"
          ) | gsub(
            "YOUR_FAL_KEY_HERE";            "${FAL_KEY}"
          ) | gsub(
            "YOUR_BROWSERBASE_KEY_HERE";    "${BROWSERBASE_API_KEY}"
          ) | gsub(
            "YOUR_BROWSER_USE_KEY_HERE";    "${BROWSER_USE_API_KEY}"
          ) | gsub(
            "YOUR_CONFLUENCE_URL_HERE";     "${CONFLUENCE_BASE_URL}"
          ) | gsub(
            "YOUR_EMAIL_HERE";              "${CONFLUENCE_EMAIL}"
          ) | gsub(
            "YOUR_CONFLUENCE_TOKEN_HERE";   "${CONFLUENCE_API_TOKEN}"
          ) | gsub(
            "YOUR_OPENAI_API_KEY_HERE";     "${OPENAI_API_KEY}"
          )
        else .
        end;

      del(._comments)
      | .mcpServers |= map_values(fix_placeholders)
    ' > "$mcp_processed" \
    || die "jq failed to process MCP catalog from $mcp_src"

  [[ -f "$config" ]] || printf '{}\n' > "$config"

  tmp="$(new_tmp)"
  jq --slurpfile mcp "$mcp_processed" \
    '.mcpServers = $mcp[0].mcpServers' \
    "$config" > "$tmp" \
    || die "jq failed to merge MCP servers into $config"
  local count
  count="$(jq '.mcpServers | length' "$tmp")"
  mv "$tmp" "$config"
  log "patched .claude.json ($count MCP servers cataloged)"
}

# ── Embedded Telegram hook source ────────────────────────────────────────────
telegram_js_source() {
  cat <<'JSEOF'
#!/usr/bin/env node
/**
 * Telegram Notification Hook.
 *
 * Credentials: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID via env only.
 * Set them in ~/.claude/settings.json `env` block (Claude Code injects them
 * into hook subprocesses). See: code.claude.com/docs/en/env-vars
 *
 * Summary resolution order:
 *   1. input.last_assistant_message            (Stop event)
 *   2. transcript_path -> last assistant text  (Notification, idle case)
 *   3. input.message                           (Notification, tool-block case)
 *   4. default fallback string
 */
'use strict';

const https = require('https');
const fs = require('fs');

const MAX_BODY_LENGTH = 100;
const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const CONFIG = loadConfig();

function loadConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) return { token, chatId };
  return null;
}

function readTranscriptTail(transcriptPath) {
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size <= MAX_TRANSCRIPT_BYTES) {
      return fs.readFileSync(transcriptPath, 'utf8');
    }
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const buf = Buffer.alloc(MAX_TRANSCRIPT_BYTES);
      fs.readSync(fd, buf, 0, MAX_TRANSCRIPT_BYTES, stat.size - MAX_TRANSCRIPT_BYTES);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function readLastAssistantText(transcriptPath) {
  if (!transcriptPath) return null;
  const content = readTranscriptTail(transcriptPath);
  if (!content) return null;

  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'user' &&
        entry.message && typeof entry.message.content === 'string') {
      return null;
    }
    if (entry.type !== 'assistant') continue;
    if (!entry.message || !Array.isArray(entry.message.content)) continue;

    const blocks = entry.message.content;
    if (blocks.some(c => c && c.type === 'tool_use')) return null;

    const texts = blocks
      .filter(c => c && c.type === 'text' && typeof c.text === 'string' && c.text.trim())
      .map(c => c.text.trim());
    if (texts.length) return texts.join('\n');
  }
  return null;
}

function extractSummary(message) {
  if (!message || typeof message !== 'string') return 'Done';
  const firstLine = message.split('\n').map(l => l.trim()).find(l => l.length > 0);
  if (!firstLine) return 'Done';
  return firstLine.length > MAX_BODY_LENGTH
    ? `${firstLine.slice(0, MAX_BODY_LENGTH)}...`
    : firstLine;
}

function sendTelegram(text) {
  if (!CONFIG) return;
  const payload = JSON.stringify({
    chat_id: CONFIG.chatId,
    text,
    disable_web_page_preview: true,
  });
  const req = https.request(
    {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${CONFIG.token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
    res => {
      res.on('data', () => {});
      res.on('end', () => {});
    },
  );
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.write(payload);
  req.end();
  if (typeof req.unref === 'function') req.unref();
}

function resolveSummary(input) {
  return (
    input.last_assistant_message ||
    readLastAssistantText(input.transcript_path) ||
    input.message ||
    'Claude Code needs your attention'
  );
}

function run(raw) {
  try {
    const input = raw && raw.trim() ? JSON.parse(raw) : {};
    sendTelegram(extractSummary(resolveSummary(input)));
  } catch {}
  return raw;
}

module.exports = { run };

if (require.main === module) {
  const MAX_STDIN = 1024 * 1024;
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      data += chunk.substring(0, MAX_STDIN - data.length);
    }
  });
  process.stdin.on('end', () => {
    const out = run(data);
    if (out) process.stdout.write(out);
  });
}
JSEOF
}

# ── Shell RC patch ───────────────────────────────────────────────────────────
# Patches the user's login shell rc with convenience alias + env.
# Priority: $SHELL (login shell) → existing file → skip.
patch_shell_rc() {
  local alias_line="alias clauded='claude --dangerously-skip-permissions'"
  local env_line="export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1"

  local shell_rc=""
  # $SHELL is the login shell, not the current process — works even when script
  # runs under bash (#!/usr/bin/env bash) but user's login shell is zsh.
  case "${SHELL:-}" in
    */zsh) shell_rc="${HOME}/.zshrc" ;;
    */bash) shell_rc="${HOME}/.bashrc" ;;
  esac

  # Fallback: if $SHELL didn't help, pick whichever file actually exists.
  if [[ -z "$shell_rc" ]]; then
    if [[ -f "${HOME}/.zshrc" ]]; then
      shell_rc="${HOME}/.zshrc"
    elif [[ -f "${HOME}/.bashrc" ]]; then
      shell_rc="${HOME}/.bashrc"
    else
      warn "no .zshrc or .bashrc found — skipping shell rc patch"
      return
    fi
  fi

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (alias + env)\n' "$shell_rc"
    return
  fi

  # Skip touch when nothing needs to be appended — avoids unnecessary mtime change.
  local needs_append=0
  if ! grep -qF "$alias_line" "$shell_rc"; then needs_append=1; fi
  if ! grep -qF "$env_line" "$shell_rc"; then needs_append=1; fi
  if (( needs_append )); then
    touch "$shell_rc"
  fi

  if ! grep -qF "$alias_line" "$shell_rc"; then
    printf '\n%s\n' "$alias_line" >> "$shell_rc"
    log "added alias to $shell_rc"
  else
    log "alias already present in $shell_rc"
  fi

  if ! grep -qF "$env_line" "$shell_rc"; then
    printf '%s\n' "$env_line" >> "$shell_rc"
    log "added env to $shell_rc"
  else
    log "env already present in $shell_rc"
  fi
}

# ── Settings: backup then patch ─────────────────────────────────────────────
# Snapshot settings.json once, before any mutation. Patches run after.
backup_settings() {
  local settings="${CLAUDE_HOME}/settings.json"
  [[ -f "$settings" ]] || return 0
  local dir="${CLAUDE_HOME}/backups"
  local out
  out="${dir}/settings.json.bak-$(date +%Y%m%d-%H%M%S)-$$"
  run mkdir -p "$dir"
  run cp "$settings" "$out"
  log "backup: ${out#${CLAUDE_HOME}/}"
}

# ── Global CLAUDE.md ────────────────────────────────────────────────────────
# Copies CLAUDE.base.md to ~/.claude/CLAUDE.md (global rules).
# This applies across all projects as behavioral guidelines.
install_global_claude_md() {
  local dest="${CLAUDE_HOME}/CLAUDE.md"
  # Resolve the script's own directory to find CLAUDE.base.md.
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local src="${script_dir}/CLAUDE.base.md"

  if (( DRY_RUN )); then
    printf '[dry-run] copy %s -> %s (global CLAUDE.md)\n' "$src" "$dest"
    return
  fi

  [[ -f "$src" ]] || { warn "CLAUDE.base.md not found at $src — skipped"; return; }

  run cp "$src" "$dest"
  log "installed global CLAUDE.md at $dest"
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"
  require_cmd jq
  run mkdir -p "$CLAUDE_HOME"

  ensure_claude_code
  ensure_onboarding
  ensure_marketplace
  ensure_plugin

  log "destination: $CLAUDE_HOME"
  log "source: $SOURCE ($(describe_source))"
  if (( DRY_RUN )); then
    log "DRY RUN — no changes will be made"
  fi

  backup_settings
  patch_settings_statusline
  patch_mcp_catalog
  install_global_claude_md
  install_all_dirs
  install_hooks_runtime
  patch_ecc_session_id
  patch_ecc_suggest_compact
  install_telegram_hook
  patch_shell_rc

  log "done"
}

main "$@"
