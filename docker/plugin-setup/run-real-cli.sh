#!/usr/bin/env bash

set -euo pipefail

readonly ECC_ROOT=/ecc
readonly SOURCE_PROJECT=/source-project
readonly MODE="${1:-dry-run}"
readonly project_dir="${ECC_PROJECT_DIR:-/workspace/project}"

NPM_CONFIG_CACHE=/tmp/npm-cache
export NPM_CONFIG_CACHE
readonly NPM_CONFIG_CACHE

usage() {
  printf '%s\n' \
    'Usage: docker compose run --rm real-cli <mode>' \
    '' \
    'Modes:' \
    '  dry-run  Inspect a project-local ECC install without mutation (default).' \
    '  install  Install ECC into the isolated project copy.' \
    '  plugin   Launch Claude with the local ECC checkout via --plugin-dir.' \
    '  shell    Open a shell in the isolated project copy.'
}

case "$MODE" in
  dry-run|install|plugin|shell)
    ;;
  help|--help|-h)
    usage
    exit 0
    ;;
  *)
    printf 'Unknown mode: %s\n\n' "$MODE" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ ! -f "$ECC_ROOT/scripts/ecc.js" ]]; then
  printf 'ECC checkout is not mounted at %s\n' "$ECC_ROOT" >&2
  exit 2
fi
if [[ ! -d "$SOURCE_PROJECT" ]]; then
  printf 'Source project is not mounted at %s\n' "$SOURCE_PROJECT" >&2
  exit 2
fi
if [[ "$project_dir" != /workspace/* ]]; then
  printf 'ECC_PROJECT_DIR must be an absolute child of /workspace\n' >&2
  exit 2
fi

mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$NPM_CONFIG_CACHE"
chmod 0700 "$HOME" "$CLAUDE_CONFIG_DIR" "$NPM_CONFIG_CACHE"

if [[ ! -e "$project_dir" ]]; then
  mkdir -m 0700 "$project_dir"
  cp -a "$SOURCE_PROJECT/." "$project_dir/"
elif [[ ! -d "$project_dir" ]]; then
  printf 'ECC project path is not a directory: %s\n' "$project_dir" >&2
  exit 2
fi
cd "$project_dir"

if [[ ! -d .git ]]; then
  git init --quiet
fi

run_install() {
  node "$ECC_ROOT/scripts/ecc.js" install \
    --profile core \
    --target claude-project \
    "$@"
}

claude --version
printf 'Isolated project: %s\n' "$project_dir"

case "$MODE" in
  dry-run)
    plan_file="$(mktemp /tmp/ecc-install-plan.XXXXXX.json)"
    run_install \
      --dry-run \
      --json > "$plan_file"
    if [[ -e "$project_dir/.claude" ]]; then
      printf 'Dry run unexpectedly mutated %s/.claude\n' "$project_dir" >&2
      exit 1
    fi
    node "$ECC_ROOT/docker/plugin-setup/verify-install-plan.js" "$project_dir" --dry-run < "$plan_file"
    cat "$plan_file"
    ;;
  install)
    run_install --json
    if [[ ! -f "$project_dir/.claude/ecc/install-state.json" ]]; then
      printf 'Install did not create confined install state\n' >&2
      exit 1
    fi
    run_install --json
    node "$ECC_ROOT/scripts/ecc.js" list-installed --json
    node "$ECC_ROOT/scripts/ecc.js" doctor --target claude-project
    ;;
  plugin)
    exec claude --plugin-dir "$ECC_ROOT"
    ;;
  shell)
    exec /bin/bash
    ;;
esac
