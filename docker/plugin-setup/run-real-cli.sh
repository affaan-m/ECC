#!/usr/bin/env bash

set -euo pipefail

readonly ECC_ROOT=/ecc
readonly SOURCE_PROJECT=/source-project
readonly MODE="${1:-dry-run}"
readonly requested_project_dir="${ECC_PROJECT_DIR:-/workspace/project}"

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

if [[ ! -f "$ECC_ROOT/package.json" ]]; then
  printf 'ECC checkout is not mounted at %s\n' "$ECC_ROOT" >&2
  exit 2
fi
if [[ ! -d "$SOURCE_PROJECT" ]]; then
  printf 'Source project is not mounted at %s\n' "$SOURCE_PROJECT" >&2
  exit 2
fi
project_dir="$(
  node "$ECC_ROOT/docker/plugin-setup/resolve-project-dir.js" \
    "$requested_project_dir"
)"
readonly project_dir

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

packed_cli=''
if [[ "$MODE" == dry-run || "$MODE" == install ]]; then
  packed_cli="$(
    node "$ECC_ROOT/docker/plugin-setup/prepare-packed-cli.js" \
      "$ECC_ROOT" \
      /tmp/ecc-packed-cli
  )"
fi
readonly packed_cli

run_ecc() {
  if [[ ! -x "$packed_cli" ]]; then
    printf 'Packed ECC public executable is unavailable\n' >&2
    return 1
  fi
  "$packed_cli" "$@"
}

run_install() {
  run_ecc install \
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
    run_ecc list-installed --json
    run_ecc doctor --target claude-project
    ;;
  plugin)
    exec claude --plugin-dir "$ECC_ROOT"
    ;;
  shell)
    exec /bin/bash
    ;;
esac
