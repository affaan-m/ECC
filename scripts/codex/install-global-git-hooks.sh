#!/usr/bin/env bash
set -euo pipefail

# Install ECC git safety hooks globally via core.hooksPath.
# Usage:
#   ./scripts/codex/install-global-git-hooks.sh
#   ./scripts/codex/install-global-git-hooks.sh --dry-run

MODE="apply"
if [[ "${1:-}" == "--dry-run" ]]; then
  MODE="dry-run"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$REPO_ROOT/scripts/codex-git-hooks"
DEST_DIR="${ECC_GLOBAL_HOOKS_DIR:-$HOME/.codex/git-hooks}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/.codex/backups/git-hooks-$STAMP"

log() {
  printf '[ecc-hooks] %s\n' "$*"
}

run_or_echo() {
  if [[ "$MODE" == "dry-run" ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

if [[ ! -d "$SOURCE_DIR" ]]; then
  log "Missing source hooks directory: $SOURCE_DIR"
  exit 1
fi

log "Mode: $MODE"
log "Source hooks: $SOURCE_DIR"
log "Global hooks destination: $DEST_DIR"

if [[ -d "$DEST_DIR" ]]; then
  log "Backing up existing hooks directory to $BACKUP_DIR"
  run_or_echo mkdir -p "$BACKUP_DIR"
  run_or_echo cp -R "$DEST_DIR" "$BACKUP_DIR/hooks"
fi

run_or_echo mkdir -p "$DEST_DIR"
run_or_echo cp "$SOURCE_DIR/pre-commit" "$DEST_DIR/pre-commit"
run_or_echo cp "$SOURCE_DIR/pre-push" "$DEST_DIR/pre-push"
run_or_echo chmod +x "$DEST_DIR/pre-commit" "$DEST_DIR/pre-push"

if [[ "$MODE" == "apply" ]]; then
  prev_hooks_path="$(git config --global core.hooksPath || true)"
  if [[ -n "$prev_hooks_path" ]]; then
    log "Previous global hooksPath: $prev_hooks_path"
  fi
fi
run_or_echo git config --global core.hooksPath "$DEST_DIR"

log "Installed ECC global git hooks."
log "Disable all hooks per repo by creating .ecc-hooks-disable in project root."
log "Disable only pre-push by creating and tracking a regular .ecc-prepush-disable file in project root."
log "One-shot override for .ecc-prepush-disable: ECC_PREPUSH_FULL=1 git push ..."
log "Temporary bypass: ECC_SKIP_PRECOMMIT=1 or ECC_SKIP_PREPUSH=1"
