#!/usr/bin/env bash

set -euo pipefail

readonly ECC_ROOT=/ecc
readonly SOURCE_PROJECT=/source-project
readonly MODE="${1:-dry-run}"

usage() {
  printf '%s\n' \
    'Usage: docker compose run --rm real-cli <mode>' \
    '' \
    'Modes:' \
    '  dry-run  Inspect a fresh local-scope setup without mutation (default).' \
    '  install  Install ECC at local scope inside the ephemeral project copy.' \
    '  migrate  Install at local scope, then migrate to project scope.' \
    '  plugin   Launch Claude with the local ECC checkout via --plugin-dir.' \
    '  shell    Open a shell in the ephemeral project copy.'
}

case "$MODE" in
  dry-run|install|migrate|plugin|shell)
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

mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"

project_dir="$(mktemp -d /workspace/ecc-project.XXXXXX)"
readonly project_dir
cp -a "$SOURCE_PROJECT/." "$project_dir/"
cd "$project_dir"

if [[ ! -d .git ]]; then
  git init --quiet
fi

run_setup() {
  node "$ECC_ROOT/scripts/ecc.js" setup \
    --mode claude-plugin \
    "$@"
}

claude --version
printf 'Ephemeral project: %s\n' "$project_dir"

case "$MODE" in
  dry-run)
    run_setup \
      --scope local \
      --hooks minimal \
      --dry-run \
      --json
    ;;
  install)
    run_setup \
      --scope local \
      --hooks minimal \
      --yes \
      --json
    claude plugin list --json
    ;;
  migrate)
    run_setup \
      --scope local \
      --hooks minimal \
      --yes \
      --json
    run_setup \
      --scope project \
      --move-scope \
      --dry-run \
      --json
    run_setup \
      --scope project \
      --move-scope \
      --yes \
      --json
    claude plugin list --json
    ;;
  plugin)
    exec claude --plugin-dir "$ECC_ROOT"
    ;;
  shell)
    exec /bin/bash
    ;;
esac
