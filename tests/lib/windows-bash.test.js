/**
 * Tests for scripts/lib/windows-bash.js
 *
 * Platform-independent: the Windows lookup is driven by an injected platform
 * and env over a temp tree laid out like a Windows install.
 *
 * Run with: node tests/lib/windows-bash.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isWslBashLauncher, resolveWindowsBashCandidates } = require('../../scripts/lib/windows-bash');

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

function touch(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, '');
  return filePath;
}

console.log('\n=== Testing windows-bash ===\n');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-bash-'));
const windowsDir = path.join(root, 'Windows');
const localAppData = path.join(root, 'Local');
const system32 = path.join(windowsDir, 'System32');
const windowsApps = path.join(localAppData, 'Microsoft', 'WindowsApps');
const gitBin = path.join(root, 'Git', 'usr', 'bin');
const toolsBin = path.join(root, 'tools');

touch(system32, 'bash.exe');
touch(windowsApps, 'bash.exe');
const gitBash = touch(gitBin, 'bash.exe');
const gitSh = touch(gitBin, 'sh.exe');
const toolsSh = touch(toolsBin, 'sh.exe');

// The WSL launchers sit ahead of Git on PATH, as on a default install.
const env = {
  PATH: [system32, windowsApps, toolsBin, gitBin].join(';'),
  SystemRoot: windowsDir,
  LOCALAPPDATA: localAppData,
};
const win32 = { env, platform: 'win32' };

try {
  test('skips System32 and WindowsApps launchers for a native bash later on PATH', () => {
    assert.deepStrictEqual(resolveWindowsBashCandidates(['bash.exe', 'bash'], win32), [gitBash]);
  });

  test('prefers earlier names over PATH order, so bash beats an earlier sh', () => {
    assert.deepStrictEqual(
      resolveWindowsBashCandidates(['bash.exe', 'bash', 'sh'], win32),
      [gitBash, toolsSh, gitSh]
    );
  });

  test('reads Windows environment names case-insensitively', () => {
    const mixedCaseEnv = {
      Path: env.PATH,
      SYSTEMROOT: windowsDir,
      LocalAppData: localAppData,
    };
    assert.deepStrictEqual(
      resolveWindowsBashCandidates(['bash'], { env: mixedCaseEnv, platform: 'win32' }),
      [gitBash]
    );
  });

  test('returns nothing when only WSL launchers or no PATH are present', () => {
    const launchersOnly = { ...env, PATH: [system32, windowsApps].join(';') };
    assert.deepStrictEqual(resolveWindowsBashCandidates(['bash'], { env: launchersOnly, platform: 'win32' }), []);
    assert.deepStrictEqual(resolveWindowsBashCandidates(['bash'], { env: {}, platform: 'win32' }), []);
  });

  test('leaves names untouched off Windows', () => {
    assert.deepStrictEqual(resolveWindowsBashCandidates(['bash', 'sh'], { env, platform: 'linux' }), ['bash', 'sh']);
  });

  test('recognises launchers in System32, SysWOW64, and Sysnative regardless of case', () => {
    for (const dir of ['SYSTEM32', 'SysWOW64', 'sysnative']) {
      assert.ok(isWslBashLauncher(path.join(windowsDir, dir, 'BASH.EXE'), env), dir);
    }
    assert.ok(isWslBashLauncher(path.join(windowsApps, 'bash.exe'), env));
  });

  test('does not flag a native bash or a non-bash binary in System32', () => {
    assert.ok(!isWslBashLauncher(gitBash, env));
    assert.ok(!isWslBashLauncher(path.join(system32, 'sh.exe'), env));
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
