/**
 * Regression coverage for supported manual Claude hook installation guidance.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const README = path.join(__dirname, '..', '..', 'README.md');
const HOOKS_README = path.join(__dirname, '..', '..', 'hooks', 'README.md');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing manual hook install docs ===\n');

  let passed = 0;
  let failed = 0;

  const readme = fs.readFileSync(README, 'utf8');
  const hooksReadme = fs.readFileSync(HOOKS_README, 'utf8');

  if (test('README warns against raw hook file copying', () => {
    assert.ok(
      readme.includes('Do not copy the raw repo `hooks/hooks.json` into `~/.claude/settings.json` or `~/.claude/hooks/hooks.json`'),
      'README should warn against unsupported raw hook copying'
    );
    assert.ok(
      readme.includes('bash ./install.sh --target claude --modules hooks-runtime --enable-hooks'),
      'README should document the supported Bash hook install path'
    );
    assert.ok(
      readme.includes('pwsh -File .\\install.ps1 --target claude --modules hooks-runtime --enable-hooks'),
      'README should document the supported PowerShell hook install path'
    );
    assert.ok(
      readme.includes('%USERPROFILE%\\\\.claude'),
      'README should call out the correct Windows Claude config root'
    );
  })) passed++; else failed++;

  if (test('hooks/README mirrors supported manual install guidance', () => {
    assert.ok(
      hooksReadme.includes('do not paste the raw repo `hooks.json` into `~/.claude/settings.json` or copy it directly into `~/.claude/hooks/hooks.json`'),
      'hooks/README should warn against unsupported raw hook copying'
    );
    assert.ok(
      hooksReadme.includes('bash ./install.sh --target claude --modules hooks-runtime --enable-hooks'),
      'hooks/README should document the supported Bash hook install path'
    );
    assert.ok(
      hooksReadme.includes('pwsh -File .\\install.ps1 --target claude --modules hooks-runtime --enable-hooks'),
      'hooks/README should document the supported PowerShell hook install path'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
