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
PRUNE=0

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
Usage: $0 [--dry-run] [--verbose] [-h]

End-to-end Claude Code setup. Installs (always overwrites) into ${CLAUDE_HOME}:
  claude-code CLI (if missing), skip-onboarding flag in ~/.claude.json,
  marketplace + plugin ${CLAUDE_PLUGIN} (if missing),
  agents, commands, hooks-runtime, configure-ecc, strategic-compact, telegram-hook,
  ECC statusline (.statusLine; a hand-edited value is kept as-is)
Shell rc patch (.zshrc or .bashrc):
  alias clauded='claude --dangerously-skip-permissions'
  export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1

Installs from the ECC tree this script lives in (${REPO_ROOT}).
To install a different version, check out that ref and re-run.

Options:
  --dry-run         Print actions without executing
  --prune           Delete files in the destination that no longer exist in the
                    source (off by default: agents/ and commands/ also hold your
                    own files). Without it, such files are only listed.
  --verbose, -v     Log every command
  -h, --help        Show this help

Env overrides:
  CLAUDE_INSTALL_URL, CLAUDE_PLUGIN, CLAUDE_MARKETPLACE_SOURCE
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
EOF
}

parse_args() {
  while (( $# )); do
    case "$1" in
      --dry-run)    DRY_RUN=1; shift ;;
      --prune)      PRUNE=1; shift ;;
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
  tmp="$(mktemp)"
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
  report_foreign "$src" "$dst"
}

# cp -rf overwrites but never deletes, so a file upstream removed keeps working
# forever from a stale install. These directories are a shared namespace though —
# your own agents and commands live there too — so deletion stays opt-in.
report_foreign() {
  local src="$1" dst="$2" rel
  local -a foreign=()

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    [[ -e "$src/$rel" ]] || foreign+=("$rel")
  done < <(cd "$dst" && find . -type f -printf '%P\n' 2>/dev/null | sort)

  (( ${#foreign[@]} )) || return 0

  if (( PRUNE )); then
    for rel in "${foreign[@]}"; do
      if (( DRY_RUN )); then
        printf '[dry-run] rm %s\n' "$dst/$rel"
      else
        run rm -f "$dst/$rel"
      fi
    done
    log "pruned ${#foreign[@]} file(s) absent from $src"
  else
    warn "${#foreign[@]} file(s) in $dst are absent from the source — pass --prune to delete:"
    for rel in "${foreign[@]}"; do
      warn "  $rel"
    done
  fi
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
  tmp="$(mktemp)"
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
  tmp="$(mktemp)"
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

# ECC hooks the shipped graph deliberately leaves out. Kept if already wired,
# never added: insaits-security is opt-in, telegram-notify belongs to
# install_telegram_hook.
readonly GRAPH_EXEMPT='["insaits-security","telegram-notify"]'

# Wires hooks/hooks.json into settings.json, the only place Claude Code reads
# hooks from. The ECC installer copies the hook scripts and writes the same graph
# to ~/.claude/hooks/hooks.json, but deliberately leaves settings.json alone
# (README, "Install hooks") — and Claude Code never reads that file, verified by
# putting a hook there and nowhere else: it never fired. Without this step a
# --target claude install ships 50 hook scripts that no event ever triggers.
#
# Skipped when ECC is loaded as a plugin: Claude Code v2.1+ auto-loads a plugin's
# hooks/hooks.json, so wiring the same graph here would run every hook twice.
install_hook_graph() {
  local settings="${CLAUDE_HOME}/settings.json"
  local graph="${SOURCE}/hooks/hooks.json"
  local tmp names filter line

  [[ -f "$graph" ]] || { warn "hook graph missing at $graph — skipped"; return; }

  if command -v claude >/dev/null 2>&1 \
    && claude plugin list 2>/dev/null | grep -Fq "everything-claude-code"; then
    warn "ECC is installed as a plugin — Claude Code auto-loads its hooks; leaving .hooks alone so they do not run twice"
    return
  fi

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (.hooks from %s)\n' "$settings" "$graph"
    return
  fi

  [[ -f "$settings" ]] || printf '{}\n' > "$settings"

  # Every ECC hook basename, so an existing entry is classified by what it
  # invokes rather than by how it was written: the old install wired hooks
  # individually and through npx, the graph routes most of them through
  # dispatchers, and matching on names catches both spellings.
  names="$(find "$SOURCE/scripts/hooks" -maxdepth 1 -name '*.js' -printf '%f\n' \
    | sed 's/\.js$//' | jq -R . | jq -sc .)"

  # An entry naming an ECC hook is the graph's to define — replaced, and logged
  # so nothing disappears quietly. An entry naming none is yours, and survives.
  filter='
    def cmds: [.. | strings] | join(" ");
    def ecc_owned($names; $exempt):
      cmds as $c
      | any($names[];  . as $n | $c | contains($n))
        and (any($exempt[]; . as $n | $c | contains($n)) | not);
  '

  # Only entries that actually disappear are worth a line: on a re-run every
  # graph entry is "replaced" by its identical self, which is not news.
  while IFS= read -r line; do
    [[ -n "$line" ]] && log "dropping hook entry the graph supersedes — $line"
  done < <(jq -r --slurpfile g "$graph" --argjson names "$names" --argjson exempt "$GRAPH_EXEMPT" \
    "${filter}"' (.hooks // {}) | to_entries[] | .key as $ev | .value[]
     | select(ecc_owned($names; $exempt))
     | select(. as $e | ($g[0].hooks[$ev] // []) | index($e) | not)
     | ([cmds | scan("scripts/hooks/[A-Za-z0-9._-]+")] | last) as $s
     | $ev + ": " + ($s // ((.hooks[0].command // "") | .[0:60]))' "$settings")

  tmp="$(mktemp)"
  jq --slurpfile g "$graph" --argjson names "$names" --argjson exempt "$GRAPH_EXEMPT" \
    "${filter}"'
    ($g[0].hooks) as $new
    | (.hooks // {}) as $old
    | .hooks = (
        reduce ((($new | keys_unsorted) + ($old | keys_unsorted)) | unique)[] as $ev
          ({};
            .[$ev] = (
              ($new[$ev] // [])
              + (($old[$ev] // []) | map(select(ecc_owned($names; $exempt) | not)))
            )
          )
      )
  ' "$settings" > "$tmp" \
    || die "jq failed to wire the hook graph into $settings"
  mv "$tmp" "$settings"
  log "wired hook graph ($(jq '[.hooks[][].hooks[]] | length' "$settings") entries in settings.json)"
}

# Installs ECC's statusline, which shows more than the inline bash bar it
# replaced: model, the in-progress task, session cost/tool/file counts (once
# ecc-metrics-bridge runs), the working directory, and the context bar.
# Overwrites only a value this script wrote — see the ownership check below.
patch_settings_statusline() {
  local settings="${CLAUDE_HOME}/settings.json"
  local tmp existing
  local statusline_cmd="node \"${CLAUDE_HOME}/scripts/hooks/ecc-statusline.js\""

  if (( DRY_RUN )); then
    printf '[dry-run] patch %s (.statusLine)\n' "$settings"
    return
  fi

  [[ -f "$settings" ]] || printf '{}\n' > "$settings"

  # `ecc-statusline.js` is what this script writes now; `bar_total=30` is the
  # inline bash bar earlier versions wrote. Anything else was chosen by hand, so
  # keep it rather than silently reverting that choice on every run.
  existing="$(jq -r '.statusLine.command // ""' "$settings")"
  if [[ -n "$existing" \
        && "$existing" != *ecc-statusline.js* \
        && "$existing" != *bar_total=30* ]]; then
    warn "statusLine is hand-edited — keeping it (remove .statusLine to hand it back to this script)"
    return
  fi

  tmp="$(mktemp)"
  jq --arg cmd "$statusline_cmd" \
    '.statusLine = { "type": "command", "command": $cmd }' \
    "$settings" > "$tmp" \
    || die "jq failed to patch statusLine in $settings"
  mv "$tmp" "$settings"
  log "patched settings.json (.statusLine -> ecc-statusline.js)"
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
  mcp_processed="$(mktemp)"
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
          ) | gsub(
            "YOUR_CS_ACCESS_TOKEN_HERE";    "${CS_ACCESS_TOKEN}"
          ) | gsub(
            "YOUR_MEMXUS_API_KEY_HERE";     "${MEMXUS_API_KEY}"
          ) | gsub(
            "YOUR_LOWERCASE_HARNESS_SLUG_HERE"; "${ECC_MEMORY_HARNESS}"
          )
        else .
        end;

      del(._comments)
      | .mcpServers |= map_values(fix_placeholders)
    ' > "$mcp_processed" \
    || die "jq failed to process MCP catalog from $mcp_src"

  # Any placeholder still present would be written to ~/.claude.json literally,
  # making the server look configured instead of staying disabled. Fail loudly
  # so a newly added upstream server can't slip through unmapped.
  local unmapped
  # grep exits 1 when it finds nothing — the healthy case — and `set -e` treats
  # that as a failure, aborting the install right before anything is copied.
  unmapped="$(grep -oE 'YOUR_[A-Z0-9_]*_HERE' "$mcp_processed" | sort -u | tr '\n' ' ')" || unmapped=''
  [[ -z "$unmapped" ]] || die "unmapped MCP placeholders (add to fix_placeholders): $unmapped"

  [[ -f "$config" ]] || printf '{}\n' > "$config"

  tmp="$(mktemp)"
  jq --slurpfile mcp "$mcp_processed" \
    '.mcpServers = $mcp[0].mcpServers' \
    "$config" > "$tmp" \
    || die "jq failed to merge MCP servers into $config"
  local count
  count="$(jq '.mcpServers | length' "$tmp")"
  mv "$tmp" "$config"
  rm -f "$mcp_processed"
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
# Snapshot the files we overwrite, before any mutation. Patches run after.
# ~/.claude.json matters as much as settings.json: patch_mcp_catalog replaces
# .mcpServers wholesale, which drops any server the user configured by hand.
backup_one() {
  local src="$1" name="$2"
  [[ -f "$src" ]] || return 0
  local dir="${CLAUDE_HOME}/backups"
  local out
  out="${dir}/${name}.bak-$(date +%Y%m%d-%H%M%S)-$$"
  run mkdir -p "$dir"
  run cp "$src" "$out"
  log "backup: ${out#${CLAUDE_HOME}/}"
}

backup_settings() {
  backup_one "${CLAUDE_HOME}/settings.json" 'settings.json'
  backup_one "${HOME}/.claude.json" 'claude.json'
}

# ── Global CLAUDE.md ────────────────────────────────────────────────────────
# Copies CLAUDE.base.md to ~/.claude/CLAUDE.md (global rules).
# This applies across all projects as behavioral guidelines.
install_global_claude_md() {
  local dest="${CLAUDE_HOME}/CLAUDE.md"
  local src="${SCRIPT_DIR}/CLAUDE.base.md"

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
  patch_mcp_catalog
  install_global_claude_md
  install_all_dirs
  install_hooks_runtime
  # Both need install_hooks_runtime to have copied the scripts they point at.
  install_hook_graph
  patch_settings_statusline
  install_telegram_hook
  patch_shell_rc

  log "done"
}

main "$@"
