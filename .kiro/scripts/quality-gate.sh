#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Quality Gate — full project quality check
# Runs: build, type check, lint, tests
# Used by: .kiro/hooks/quality-gate.json (userTriggered)
# ─────────────────────────────────────────────────────────────

set -o pipefail

PASS="✓"
FAIL="✗"
SKIP="○"
PASSED=0
FAILED=0
SKIPPED=0

# ── Package manager detection ────────────────────────────────
detect_pm() {
  if [ -f "pnpm-lock.yaml" ]; then
    echo "pnpm"
  elif [ -f "yarn.lock" ]; then
    echo "yarn"
  elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    echo "bun"
  elif [ -f "package-lock.json" ]; then
    echo "npm"
  elif command -v pnpm &>/dev/null; then
    echo "pnpm"
  elif command -v yarn &>/dev/null; then
    echo "yarn"
  elif command -v bun &>/dev/null; then
    echo "bun"
  else
    echo "npm"
  fi
}

PM=$(detect_pm)
echo "Package manager: $PM"
echo ""

# ── Helper: run a check ─────────────────────────────────────
run_check() {
  local label="$1"
  shift

  if output=$("$@" 2>&1); then
    echo "$PASS $label"
    PASSED=$((PASSED + 1))
  else
    echo "$FAIL $label"
    echo "$output" | head -20
    FAILED=$((FAILED + 1))
  fi
}

# ── 1. Build ─────────────────────────────────────────────────
if [ -f "package.json" ] && grep -q '"build"' package.json 2>/dev/null; then
  run_check "Build" $PM run build
else
  echo "$SKIP Build (no build script found)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── 2. Type check ───────────────────────────────────────────
if command -v npx &>/dev/null && [ -f "tsconfig.json" ]; then
  run_check "Type check" npx tsc --noEmit
elif [ -f "pyrightconfig.json" ] || [ -f "mypy.ini" ]; then
  if command -v pyright &>/dev/null; then
    run_check "Type check" pyright
  elif command -v mypy &>/dev/null; then
    run_check "Type check" mypy .
  else
    echo "$SKIP Type check (pyright/mypy not installed)"
    SKIPPED=$((SKIPPED + 1))
  fi
else
  echo "$SKIP Type check (no TypeScript or Python type config found)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── 3. Lint ──────────────────────────────────────────────────
if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
  run_check "Lint (Biome)" npx biome check .
elif [ -f ".eslintrc" ] || [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f ".eslintrc.yml" ] || [ -f "eslint.config.js" ] || [ -f "eslint.config.mjs" ]; then
  run_check "Lint (ESLint)" npx eslint .
elif command -v ruff &>/dev/null && [ -f "pyproject.toml" ]; then
  run_check "Lint (Ruff)" ruff check .
elif command -v golangci-lint &>/dev/null && [ -f "go.mod" ]; then
  run_check "Lint (golangci-lint)" golangci-lint run
else
  echo "$SKIP Lint (no linter config found)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── 4. Tests ─────────────────────────────────────────────────
if [ -f "package.json" ] && grep -q '"test"' package.json 2>/dev/null; then
  run_check "Tests" $PM run test
elif [ -f "pyproject.toml" ] && command -v pytest &>/dev/null; then
  run_check "Tests" pytest
elif [ -f "go.mod" ] && command -v go &>/dev/null; then
  run_check "Tests" go test ./...
else
  echo "$SKIP Tests (no test runner found)"
  SKIPPED=$((SKIPPED + 1))
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────"
TOTAL=$((PASSED + FAILED + SKIPPED))
echo "Results: $PASSED passed, $FAILED failed, $SKIPPED skipped ($TOTAL total)"

if [ "$FAILED" -gt 0 ]; then
  echo "Quality gate: FAILED"
  exit 1
else
  echo "Quality gate: PASSED"
  exit 0
fi
