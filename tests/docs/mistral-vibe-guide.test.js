/** Contract tests for the Mistral Vibe installation guide. */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const guide = fs.readFileSync(path.join(repoRoot, 'docs', 'MISTRAL-VIBE-GUIDE.md'), 'utf8');
const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Testing Mistral Vibe guide ===\n');

test('documents the native project skill install and lifecycle', () => {
  assert.ok(guide.includes('"$ECC_ROOT/install.sh" --target mistral-vibe --skills tdd-workflow'));
  assert.ok(guide.includes('node "$ECC_ROOT/scripts/doctor.js" --target mistral-vibe'));
  assert.ok(guide.includes('node "$ECC_ROOT/scripts/repair.js" --target mistral-vibe'));
  assert.ok(guide.includes('node "$ECC_ROOT/scripts/uninstall.js" --target mistral-vibe'));
  assert.ok(guide.includes('.vibe/skills/'));
  assert.ok(guide.includes('npm view ecc-universal version'));
  assert.ok(!guide.includes('ecc-universal@2.2.1 install --target mistral-vibe'));
});

test('states the verified compatibility boundary without false parity claims', () => {
  assert.match(guide, /Mistral Vibe v2.25.3/);
  assert.match(guide, /\.vibe\/agents\/.*TOML/i);
  assert.match(guide, /\.vibe\/hooks\.toml/);
  assert.match(guide, /does not\s+configure/i);
  assert.ok(!guide.includes('--profile minimal'));
});

test('links the Vibe target from the primary README', () => {
  assert.ok(readme.includes('--target mistral-vibe --skills tdd-workflow'));
  assert.ok(readme.includes('[Mistral Vibe guide](docs/MISTRAL-VIBE-GUIDE.md)'));
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
