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
  if [[ -n "$prev_hooks_path" && "$prev_hooks_path" != "$DEST_DIR" ]]; then
    # SECURITY: never silently displace another tool's global hooks — that
    # turns every commit/push in every repo into ECC code execution and breaks
    # the user's existing security controls. Require explicit opt-in to replace.
    if [[ "${ECC_FORCE_GLOBAL_HOOKS:-0}" != "1" ]]; then
      log "ERROR: global core.hooksPath already set to: $prev_hooks_path"
      log "Refusing to overwrite. Options:"
      log "  1) Per-repo install (recommended): git config core.hooksPath \"$DEST_DIR\""
      log "  2) Force replace: ECC_FORCE_GLOBAL_HOOKS=1 $0"
      log "  3) Restore afterwards: git config --global core.hooksPath \"$prev_hooks_path\""
      exit 1
    fi
    log "WARNING: replacing previous global hooksPath: $prev_hooks_path (ECC_FORCE_GLOBAL_HOOKS=1)"
    log "Restore with: git config --global core.hooksPath \"$prev_hooks_path\""
  fi
fi
run_or_echo git config --global core.hooksPath "$DEST_DIR"

log "Installed ECC global git hooks."
log "Per-repo alternative (recommended): git config core.hooksPath \"$DEST_DIR\""
log "Temporary bypass (audible): ECC_SKIP_GIT_HOOKS=1 (logs a warning to stderr)"
