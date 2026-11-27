/**
 * Regression test for migrate-homunculus.sh $HOME escaping (#2301).
 *
 * The running-observer guard in migrate-homunculus.sh builds a `pgrep -f`
 * pattern from $HOME. `pgrep -f` treats its argument as an extended regular
 * expression, so an unescaped $HOME containing regex metacharacters (e.g.
 * /home/user.name, /home/c++dev, /home/user (work)) made the match over-broad
 * or invalid. That caused either a false negative (a live observer-loop.sh is
 * missed and the migration proceeds unsafely) or a false positive (an unrelated
 * process matches and the migration is blocked).
 *
 * The fix escapes the ERE metacharacters in $HOME before interpolation. This
 * test pins that behavior by extracting the exact `sed` escaping command from
 * the script (so it tests the real implementation, not a copy), then asserting
 * that, for HOME values containing metacharacters:
 *   (a) the escaped pattern matches the literal home path, and
 *   (b) the escaped pattern does NOT over-match a decoy path that the
 *       unescaped (regex-expanded) form would have matched.
 *
 * Run with: node tests/hooks/migrate-homunculus-home-escape.test.js
 */

'use strict';

// migrate-homunculus.sh and this test's assertions rely on POSIX bash, sed, and
// grep -E semantics. Skip on Windows, matching the repo convention for
// bash-dependent clv2 tests (see tests/hooks/observe-subdirectory-detection.test.js).
if (process.platform === 'win32') {
  console.log('Skipping bash-dependent migrate-homunculus tests on Windows');
  process.exit(0);
}

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'scripts',
  'migrate-homunculus.sh'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

const scriptSource = fs.readFileSync(scriptPath, 'utf8');

// Extract the exact sed escaping command from the script so this test verifies
// the real implementation. Expected form:
//   escaped_home="$(printf '%s' "$HOME" | sed 's/.../\\&/g')"
const sedMatch = scriptSource.match(
  /escaped_home="\$\(printf '%s' "\$HOME" \| (sed '[^']*')\)"/
);

// Build the pgrep pattern exactly as the script does: ${escaped_home} followed
// by the literal observer-loop.sh regex tail.
function buildPattern(home) {
  assert.ok(
    sedMatch,
    'could not locate the escaped_home sed command in migrate-homunculus.sh; ' +
      'the fix for #2301 must escape $HOME before pgrep -f'
  );
  const sedCmd = sedMatch[1];
  const res = spawnSync(
    'bash',
    ['-c', `printf '%s' "$1" | ${sedCmd}`, 'bash', home],
    { encoding: 'utf8' }
  );
  assert.strictEqual(
    res.status,
    0,
    `sed escaping failed for HOME=${home}: ${res.stderr}`
  );
  return `${res.stdout}.*observer-loop\\.sh`;
}

// grep -E uses the same ERE engine as pgrep -f. Return true if cmdline matches.
function ereMatches(pattern, cmdline) {
  const res = spawnSync('grep', ['-E', pattern], {
    input: cmdline,
    encoding: 'utf8',
  });
  return res.status === 0;
}

console.log('\n=== migrate-homunculus.sh $HOME escaping (#2301) ===\n');

test('the running-observer guard no longer interpolates $HOME unescaped', () => {
  assert.ok(
    !/pgrep -f "\$\{HOME\}/.test(scriptSource),
    'pgrep -f must not use ${HOME} directly; it must use the escaped value'
  );
  assert.ok(
    /pgrep -f "\$\{escaped_home\}/.test(scriptSource),
    'pgrep -f must use the escaped_home value built from $HOME'
  );
});

const problemHomes = ['/home/user.name', '/home/c++dev', '/home/user (work)', '/tmp/h[x]'];

for (const home of problemHomes) {
  test(`escaped pattern matches the literal home ${home}`, () => {
    const pattern = buildPattern(home);
    const cmdline = `/bin/bash ${home}/.local/share/ecc-homunculus/observer-loop.sh`;
    assert.ok(
      ereMatches(pattern, cmdline),
      `expected escaped pattern to match the literal observer cmdline for HOME=${home}`
    );
  });
}

test('escaped "." does not over-match a different path (#2301 false positive)', () => {
  const pattern = buildPattern('/home/user.name');
  // The unescaped form ("." as any-char) would match /home/userXname; the
  // escaped form must not.
  const decoy = '/bin/bash /home/userXname/observer-loop.sh';
  assert.ok(
    !ereMatches(pattern, decoy),
    'escaped pattern must not over-match /home/userXname when HOME=/home/user.name'
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
