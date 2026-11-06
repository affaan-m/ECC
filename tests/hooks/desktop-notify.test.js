#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');

const { quotePowerShellString } = require('../../scripts/hooks/desktop-notify');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function findPowerShell() {
  for (const candidate of ['pwsh', 'powershell']) {
    const result = spawnSync(candidate, ['-NoProfile', '-Command', 'exit 0'], {
      stdio: 'ignore',
      timeout: 10000,
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

const SAMPLES = [
  "I've finished",
  'I\u2019ve finished the task',
  'Done\u2019; Write-Output INJECTED; \u2019',
  '\u2018a\u2019 \u201Ab\u201B c\'\u2019',
  'cost: $(Get-Date) $env:PATH `n',
];

function runTests() {
  console.log('\n=== Testing desktop-notify.js PowerShell quoting ===\n');
  let passed = 0;
  let failed = 0;

  (test('doubles ASCII and typographic single quotes', () => {
    assert.strictEqual(quotePowerShellString("it's"), "'it''s'");
    assert.strictEqual(quotePowerShellString('it\u2019s'), "'it\u2019\u2019s'");
    assert.strictEqual(
      quotePowerShellString('\u2018\u2019\u201A\u201B'),
      "'\u2018\u2018\u2019\u2019\u201A\u201A\u201B\u201B'"
    );
  }) ? passed++ : failed++);

  const ps = findPowerShell();
  if (!ps) {
    console.log('  - skipping PowerShell round-trip: no pwsh or powershell on PATH');
  } else {
    for (const sample of SAMPLES) {
      (test(`${ps} parses ${JSON.stringify(sample)} back unchanged`, () => {
        // Print code points so the console encoding cannot affect the check.
        const command = `$s = ${quotePowerShellString(sample)}; ($s.ToCharArray() | ForEach-Object { [int]$_ }) -join ','`;
        const result = spawnSync(ps, ['-NoProfile', '-Command', command], {
          encoding: 'utf8',
          timeout: 15000,
        });
        assert.strictEqual(result.status, 0, `exit ${result.status}: ${result.stderr}`);
        const expected = Array.from(sample, ch => ch.charCodeAt(0)).join(',');
        assert.strictEqual(result.stdout.trim(), expected);
      }) ? passed++ : failed++);
    }
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
