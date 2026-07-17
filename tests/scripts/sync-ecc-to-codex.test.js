/**
 * Source-level tests for scripts/sync-ecc-to-codex.sh
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'sync-ecc-to-codex.sh');
const source = fs.readFileSync(scriptPath, 'utf8');
const normalizedSource = source.replace(/\r\n/g, '\n');
const runOrEchoSource = (() => {
  const start = normalizedSource.indexOf('run_or_echo() {');
  if (start < 0) {
    return '';
  }

  let depth = 0;
  let bodyStart = normalizedSource.indexOf('{', start);
  if (bodyStart < 0) {
    return '';
  }

  for (let i = bodyStart; i < normalizedSource.length; i++) {
    const char = normalizedSource[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return normalizedSource.slice(start, i + 1);
      }
    }
  }

  return '';
})();

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing sync-ecc-to-codex.sh ===\n');

  let passed = 0;
  let failed = 0;

  if (test('run_or_echo does not use eval', () => {
    assert.ok(runOrEchoSource, 'Expected to locate run_or_echo function body');
    assert.ok(!runOrEchoSource.includes('eval "$@"'), 'run_or_echo should not execute through eval');
  })) passed++; else failed++;

  if (test('run_or_echo executes argv directly', () => {
    assert.ok(runOrEchoSource.includes('    "$@"'), 'run_or_echo should execute the argv vector directly');
  })) passed++; else failed++;

  if (test('dry-run output shell-escapes argv', () => {
    assert.ok(runOrEchoSource.includes(`printf ' %q' "$@"`), 'Dry-run mode should print shell-escaped argv');
  })) passed++; else failed++;

  if (test('filesystem-changing calls use argv-form run_or_echo invocations', () => {
    assert.ok(source.includes('run_or_echo mkdir -p "$BACKUP_DIR"'), 'mkdir should use argv form');
    assert.ok(source.includes('run_or_echo mkdir -p "$(dirname "$CODEX_NAV_GUIDE_DEST")"'), 'Codex guide destination directory should use argv form');
    assert.ok(source.includes('run_or_echo cp "$CODEX_NAV_GUIDE_SRC" "$CODEX_NAV_GUIDE_DEST"'), 'Codex guide copy should use argv form');
    assert.ok(source.includes('run_or_echo cp "$CODEX_COMMAND_AGENT_MAP_SRC" "$CODEX_COMMAND_AGENT_MAP_DEST"'), 'Command-agent map copy should use argv form');
    assert.ok(source.includes('run_or_echo cp "$CODEX_COMMANDS_QUICK_REF_SRC" "$CODEX_COMMANDS_QUICK_REF_DEST"'), 'Commands quick reference copy should use argv form');
    assert.ok(source.includes('run_or_echo cp "$CODEX_CONTRIBUTING_SRC" "$CODEX_CONTRIBUTING_DEST"'), 'Contributing guide copy should use argv form');
    assert.ok(source.includes('run_or_echo mkdir -p "$(dirname "$CODEX_PR_TEMPLATE_DEST")"'), 'PR template destination directory should use argv form');
    assert.ok(source.includes('run_or_echo cp "$CODEX_PR_TEMPLATE_SRC" "$CODEX_PR_TEMPLATE_DEST"'), 'PR template copy should use argv form');
    // Skills sync rm/cp calls were removed — Codex reads from ~/.agents/skills/ natively
    assert.ok(!source.includes('run_or_echo rm -rf "$dest"'), 'skill sync rm should be removed');
    assert.ok(!source.includes('run_or_echo cp -R "$skill_dir" "$dest"'), 'skill sync cp should be removed');
  })) passed++; else failed++;

  if (test('sync script carries the Codex navigation guide referenced by AGENTS', () => {
    assert.ok(source.includes('CODEX_NAV_GUIDE_SRC="$REPO_ROOT/docs/CODEX-NAVIGATION-GUIDE.md"'), 'Expected source path for Codex navigation guide');
    assert.ok(source.includes('CODEX_NAV_GUIDE_DEST="$CODEX_HOME/docs/CODEX-NAVIGATION-GUIDE.md"'), 'Expected destination path for Codex navigation guide');
    assert.ok(source.includes('require_path "$CODEX_NAV_GUIDE_SRC" "ECC Codex navigation guide"'), 'Expected sync preflight for Codex navigation guide');
    for (const required of [
      'CODEX_COMMAND_AGENT_MAP_SRC="$REPO_ROOT/docs/COMMAND-AGENT-MAP.md"',
      'CODEX_COMMANDS_QUICK_REF_SRC="$REPO_ROOT/COMMANDS-QUICK-REF.md"',
      'CODEX_CONTRIBUTING_SRC="$REPO_ROOT/CONTRIBUTING.md"',
      'CODEX_PR_TEMPLATE_SRC="$REPO_ROOT/.github/PULL_REQUEST_TEMPLATE.md"'
    ]) {
      assert.ok(source.includes(required), `Expected synced reference source ${required}`);
    }
  })) passed++; else failed++;

  if (test('sync script avoids GNU-only grep -P parsing', () => {
    assert.ok(!source.includes('grep -oP'), 'sync-ecc-to-codex.sh should remain portable across BSD and GNU environments');
  })) passed++; else failed++;

  if (test('extract_context7_key uses a portable parser', () => {
    assert.ok(source.includes('extract_context7_key() {'), 'Expected extract_context7_key helper');
    assert.ok(source.includes('node - "$file"'), 'extract_context7_key should use Node-based parsing');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
