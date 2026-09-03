'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const guidePath = path.join(repoRoot, 'docs', 'ANTIGRAVITY-GUIDE.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

console.log('\n=== Testing Antigravity guide commands ===\n');

const guide = fs.readFileSync(guidePath, 'utf8');

test('guide requires an installer with native Antigravity 2.0 support', () => {
  assert.ok(
    guide.includes('ECC 2.2.0 or newer'),
    'Guide should state the minimum ECC version that installs into .agents'
  );
});

test('guide uses the published 2.2 package without stale pre-release copy', () => {
  assert.ok(
    guide.includes('npm view ecc-universal version'),
    'Guide should let operators verify registry propagation before installation'
  );
  assert.ok(
    guide.includes('npx ecc-universal@2.2.0 install --profile minimal --target antigravity'),
    'Guide should provide the pinned published-package installation path'
  );
  assert.ok(
    !guide.includes('ECC 2.2.0 has not been published to npm yet'),
    'The immutable 2.2 guide must not claim that 2.2 is unpublished'
  );
  assert.ok(
    !guide.includes('npm latest is currently `ecc-universal@2.1.0`'),
    'The immutable 2.2 guide must not advertise the old latest version'
  );
});

test('guide keeps the target project as the working directory', () => {
  assert.ok(
    guide.includes('Run every command below from the project you want to configure'),
    'Guide should make the project-root working-directory contract explicit'
  );
  assert.ok(
    guide.includes('ECC_ROOT="/absolute/path/to/ECC"'),
    'Guide should define an absolute ECC source path separately from the target project'
  );
  assert.ok(
    guide.includes('$EccRoot = "C:\\absolute\\path\\to\\ECC"'),
    'Guide should define the equivalent absolute source path for PowerShell users'
  );
});

test('guide installs through dependency-bootstrapping wrappers', () => {
  assert.ok(guide.includes('"$ECC_ROOT/install.sh" --profile minimal --target antigravity'));
  assert.ok(guide.includes('& "$EccRoot\\install.ps1" --profile minimal --target antigravity'));
  assert.ok(
    !guide.includes('node "$ECC_ROOT/scripts/install-apply.js"'),
    'Fresh source installs should not bypass the wrapper dependency bootstrap'
  );
});

test('guide invokes every post-install lifecycle script through the absolute ECC source path', () => {
  for (const script of ['list-installed.js', 'doctor.js', 'repair.js', 'uninstall.js']) {
    assert.ok(
      guide.includes(`node "$ECC_ROOT/scripts/${script}"`),
      `Guide should invoke ${script} through ECC_ROOT`
    );
    assert.ok(
      guide.includes(`node "$EccRoot\\scripts\\${script}"`),
      `Guide should invoke ${script} through EccRoot in PowerShell`
    );
  }

  assert.ok(!guide.includes('./install.sh'), 'Guide should not target the current project through a relative ECC installer path');
  assert.ok(!/node scripts\/(?:list-installed|doctor|repair|uninstall)\.js/.test(guide));
});

test('repository has no accidental nested ECC gitlink', () => {
  assert.ok(
    !fs.existsSync(path.join(repoRoot, 'ECC')),
    'The documentation PR should not add an ECC gitlink without .gitmodules metadata'
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
