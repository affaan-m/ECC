#!/usr/bin/env bash

set -euo pipefail

readonly ECC_ROOT=/ecc

fixture_uid="$(id -u)"
readonly fixture_uid
fixture_gid="$(id -g)"
readonly fixture_gid
if [[ "$fixture_uid" != 1000 || "$fixture_gid" != 1000 ]]; then
  printf 'Fixture tests must run as uid/gid 1000:1000 (got %s:%s)\n' \
    "$fixture_uid" "$fixture_gid" >&2
  exit 1
fi

cd "$ECC_ROOT"

exec node docker/plugin-setup/run-platform-tests.js
