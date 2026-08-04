/**
 * Tests for shebang consistency across continuous-learning-v2 shell scripts
 *
 * Every `*.sh` script under skills/continuous-learning-v2/ must use the
 * portable `#!/usr/bin/env bash` shebang rather than the hardcoded
 * `#!/bin/bash`. The hardcoded interpreter path fails on systems where bash
 * is not installed at /bin/bash (NixOS, some Homebrew layouts, FreeBSD), and
 * observe.sh runs on every hook invocation. This guards against the
 * inconsistency (#2303) reappearing.
 *
 * Run with: node tests/hooks/continuous-learning-shebang-consistency.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  ✓ ${name}\n`);
    passed++;
  } catch (err) {
    process.stderr.write(`  ✗ ${name}\n`);
    process.stderr.write(`    ${err && err.stack ? err.stack : String(err)}\n`);
    failed++;
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const skillDir = path.join(repoRoot, 'skills', 'continuous-learning-v2');
const PORTABLE_SHEBANG = '#!/usr/bin/env bash';
const HARDCODED_SHEBANG = '#!/bin/bash';

function collectShellScripts(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden/runtime directories (e.g. the observer's `.observer-tmp`)
      // so an untracked local artifact cannot trigger a false failure; only
      // committed skill scripts are checked.
      if (entry.name.startsWith('.')) {
        continue;
      }
      collectShellScripts(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.sh')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function firstLine(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0];
}

console.log('\n=== continuous-learning-v2 shebang consistency ===\n');

const scripts = collectShellScripts(skillDir);

test('skill directory contains shell scripts to check', () => {
  assert.ok(scripts.length > 0, `expected at least one .sh under ${skillDir}`);
});

for (const scriptPath of scripts) {
  const rel = path.relative(repoRoot, scriptPath).split(path.sep).join('/');
  test(`${rel} uses portable '#!/usr/bin/env bash'`, () => {
    assert.strictEqual(
      firstLine(scriptPath),
      PORTABLE_SHEBANG,
      `${rel} should start with '${PORTABLE_SHEBANG}'`
    );
  });
}

test('no continuous-learning-v2 script uses hardcoded #!/bin/bash', () => {
  const offenders = scripts
    .filter(scriptPath => firstLine(scriptPath) === HARDCODED_SHEBANG)
    .map(scriptPath => path.relative(repoRoot, scriptPath).split(path.sep).join('/'));
  assert.strictEqual(
    offenders.length,
    0,
    `hardcoded #!/bin/bash found in: ${offenders.join(', ')}`
  );
});

// ──────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
