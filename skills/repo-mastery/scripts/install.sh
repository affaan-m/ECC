#!/usr/bin/env bash
# install.sh — install repo-mastery as a native skill across AI CLI tools.
#
# By default installs to:
#   Claude Code : ~/.claude/skills/repo-mastery
#   Codex       : ~/.codex/skills/repo-mastery      (Agent Skills standard)
#   Gemini CLI  : ${GEMINI_SKILLS_DIR:-~/.gemini/skills}/repo-mastery
#
# Options:
#   --only <tool>    install only one tool (claude|codex|gemini)
#   --skip <tool>    skip one tool (repeatable)
#   --dry-run        print what would happen, don't copy
#   --help           show this help
#
# Examples:
#   ./scripts/install.sh                    # install everywhere
#   ./scripts/install.sh --only codex       # Codex only
#   GEMINI_SKILLS_DIR=$HOME/.config/gemini/skills ./scripts/install.sh

set -euo pipefail

# Resolve the skill source. When run via `curl ... | bash` there is no local
# checkout, so fetch the latest tarball from GitHub.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd)"
if [ ! -f "$SRC/SKILL.md" ]; then
  echo "No local checkout — fetching repo-mastery from GitHub…"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL https://github.com/DieselZhang/repo-mastery/archive/refs/heads/main.tar.gz \
    | tar -xz -C "$TMP"
  SRC="$TMP/repo-mastery-main"
fi

CLAUDE_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
CODEX_DIR="${CODEX_SKILLS_DIR:-$HOME/.codex/skills}"
GEMINI_DIR="${GEMINI_SKILLS_DIR:-$HOME/.gemini/skills}"

copy_skill() {
  local dest="$1"
  mkdir -p "$dest"
  # copy the skill root, excluding .git
  cp -R "$SRC" "$dest/repo-mastery" 2>/dev/null && rm -rf "$dest/repo-mastery/.git"
}

dry_run=0
only=""
skip=()
for arg in "$@"; do
  case "$arg" in
    --only) only="__MISSING__" ;;
    --only=*) only="${arg#--only=}" ;;
    --skip) skip+=("__MISSING__") ;;
    --skip=*) skip+=("${arg#--skip=}") ;;
    --dry-run) dry_run=1 ;;
    --help|-h) sed -n '1,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) [ "$only" = "__MISSING__" ] && only="$arg" || skip+=("$arg") ;;
  esac
done

want() { # want <tool> -> 0 if should install
  [ -n "$only" ] && [ "$only" != "$1" ] && return 1
  for s in ${skip[@]+"${skip[@]}"}; do [ "$s" = "$1" ] && return 1; done
  return 0
}

installed=()
if want claude; then
  echo "→ Claude Code : $CLAUDE_DIR/repo-mastery"
  [ "$dry_run" -eq 0 ] && copy_skill "$CLAUDE_DIR" && installed+=("claude")
fi
if want codex; then
  echo "→ Codex       : $CODEX_DIR/repo-mastery"
  [ "$dry_run" -eq 0 ] && copy_skill "$CODEX_DIR" && installed+=("codex")
fi
if want gemini; then
  echo "→ Gemini CLI  : $GEMINI_DIR/repo-mastery"
  [ "$dry_run" -eq 0 ] && copy_skill "$GEMINI_DIR" && installed+=("gemini")
fi

if [ "$dry_run" -eq 0 ]; then
  echo ""
  echo "✅ Installed repo-mastery to: ${installed[*]:-none}"
  echo "   Restart your CLI, then try:"
  echo "     Claude Code : /repo-mastery start <repo>"
  echo "     Codex       : mention 'repo-mastery' or ask to master a repo"
  echo "     Gemini      : activate_skill(repo-mastery)"
else
  echo ""
  echo "（dry-run）No files were copied."
fi
