#!/usr/bin/env bash

set -euo pipefail

readonly ECC_ROOT=/ecc

cd "$ECC_ROOT"

exec node docker/plugin-setup/run-platform-tests.js
