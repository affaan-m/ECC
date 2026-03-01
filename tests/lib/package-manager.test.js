/**
 * Tests for scripts/lib/package-manager.js
 *
 * Run with: node tests/lib/package-manager.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Import the modules
const pm = require('../../scripts/node/lib/package-manager');

// Test helper
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

// Create a temporary test directory
function createTestDir() {
  const testDir = path.join(os.tmpdir(), `pm-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

// Clean up test directory
function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

// Test suite
function runTests() {
  console.log('\n=== Testing package-manager.js ===\n');

  let passed = 0;
  let failed = 0;

  // PACKAGE_MANAGERS constant tests
  console.log('PACKAGE_MANAGERS Constant:');

  if (test('PACKAGE_MANAGERS has all expected managers', () => {
    assert.ok(pm.PACKAGE_MANAGERS.npm, 'Should have npm');
    assert.ok(pm.PACKAGE_MANAGERS.pnpm, 'Should have pnpm');
    assert.ok(pm.PACKAGE_MANAGERS.yarn, 'Should have yarn');
    assert.ok(pm.PACKAGE_MANAGERS.bun, 'Should have bun');
  })) passed++; else failed++;

  if (test('Each manager has required properties', () => {
    const requiredProps = ['name', 'lockFile', 'installCmd', 'runCmd', 'execCmd', 'testCmd', 'buildCmd', 'devCmd'];
    for (const [name, config] of Object.entries(pm.PACKAGE_MANAGERS)) {
      for (const prop of requiredProps) {
        assert.ok(config[prop], `${name} should have ${prop}`);
      }
    }
  })) passed++; else failed++;

  // detectFromLockFile tests
  console.log('\ndetectFromLockFile:');

  if (test('detects npm from package-lock.json', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'package-lock.json'), '{}');
      const result = pm.detectFromLockFile(testDir);
      assert.strictEqual(result, 'npm');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('detects pnpm from pnpm-lock.yaml', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'pnpm-lock.yaml'), '');
      const result = pm.detectFromLockFile(testDir);
      assert.strictEqual(result, 'pnpm');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('detects yarn from yarn.lock', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'yarn.lock'), '');
      const result = pm.detectFromLockFile(testDir);
      assert.strictEqual(result, 'yarn');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('detects bun from bun.lockb', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'bun.lockb'), '');
      const result = pm.detectFromLockFile(testDir);
      assert.strictEqual(result, 'bun');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('returns null when no lock file exists', () => {
    const testDir = createTestDir();
    try {
      const result = pm.detectFromLockFile(testDir);
      assert.strictEqual(result, null);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('respects detection priority (pnpm > npm)', () => {
    const testDir = createTestDir();
    try {
      // Create both lock files
      fs.writeFileSync(path.join(testDir, 'package-lock.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'pnpm-lock.yaml'), '');
      const result = pm.detectFromLockFile(testDir);
      // pnpm has higher priority in DETECTION_PRIORITY
      assert.strictEqual(result, 'pnpm');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  // detectFromPackageJson tests
  console.log('\ndetectFromPackageJson:');

  if (test('detects package manager from packageManager field', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        packageManager: 'pnpm@8.6.0'
      }));
      const result = pm.detectFromPackageJson(testDir);
      assert.strictEqual(result, 'pnpm');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('handles packageManager without version', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        packageManager: 'yarn'
      }));
      const result = pm.detectFromPackageJson(testDir);
      assert.strictEqual(result, 'yarn');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('returns null when no packageManager field', () => {
    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({
        name: 'test'
      }));
      const result = pm.detectFromPackageJson(testDir);
      assert.strictEqual(result, null);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('returns null when no package.json exists', () => {
    const testDir = createTestDir();
    try {
      const result = pm.detectFromPackageJson(testDir);
      assert.strictEqual(result, null);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  // getAvailablePackageManagers tests
  console.log('\ngetAvailablePackageManagers:');

  if (test('returns array of available managers', () => {
    const available = pm.getAvailablePackageManagers();
    assert.ok(Array.isArray(available), 'Should return array');
    // npm should always be available with Node.js
    assert.ok(available.includes('npm'), 'npm should be available');
  })) passed++; else failed++;

  // getPackageManager tests
  console.log('\ngetPackageManager:');

  if (test('returns object with name, config, and source', () => {
    const result = pm.getPackageManager();
    assert.ok(result.name, 'Should have name');
    assert.ok(result.config, 'Should have config');
    assert.ok(result.source, 'Should have source');
  })) passed++; else failed++;

  if (test('respects environment variable', () => {
    const originalEnv = process.env.CLAUDE_PACKAGE_MANAGER;
    try {
      process.env.CLAUDE_PACKAGE_MANAGER = 'yarn';
      const result = pm.getPackageManager();
      assert.strictEqual(result.name, 'yarn');
      assert.strictEqual(result.source, 'environment');
    } finally {
      if (originalEnv !== undefined) {
        process.env.CLAUDE_PACKAGE_MANAGER = originalEnv;
      } else {
        delete process.env.CLAUDE_PACKAGE_MANAGER;
      }
    }
  })) passed++; else failed++;

  if (test('detects from lock file in project', () => {
    const originalEnv = process.env.CLAUDE_PACKAGE_MANAGER;
    delete process.env.CLAUDE_PACKAGE_MANAGER;

    const testDir = createTestDir();
    try {
      fs.writeFileSync(path.join(testDir, 'bun.lockb'), '');
      const result = pm.getPackageManager({ projectDir: testDir });
      assert.strictEqual(result.name, 'bun');
      assert.strictEqual(result.source, 'lock-file');
    } finally {
      cleanupTestDir(testDir);
      if (originalEnv !== undefined) {
        process.env.CLAUDE_PACKAGE_MANAGER = originalEnv;
      }
    }
  })) passed++; else failed++;

  // getRunCommand tests
  console.log('\ngetRunCommand:');

  if (test('returns correct install command', () => {
    const originalEnv = process.env.CLAUDE_PACKAGE_MANAGER;
    try {
      process.env.CLAUDE_PACKAGE_MANAGER = 'pnpm';
      const cmd = pm.getRunCommand('install');
      assert.strictEqual(cmd, 'pnpm install');
    } finally {
      if (originalEnv !== undefined) {
        process.env.CLAUDE_PACKAGE_MANAGER = originalEnv;
      } else {
        delete process.env.CLAUDE_PACKAGE_MANAGER;
      }
    }
  })) passed++; else failed++;

  if (test('returns correct test command', () => {
    const originalEnv = process.env.CLAUDE_PACKAGE_MANAGER;
    try {
      process.env.CLAUDE_PACKAGE_MANAGER = 'npm';
      const cmd = pm.getRunCommand('test');
      assert.strictEqual(cmd, 'npm test');
    } finally {
      if (originalEnv !== undefined) {
        process.env.CLAUDE_PACKAGE_MANAGER = originalEnv;
      } else {
        delete process.env.CLAUDE_PACKAGE_MANAGER;
      }
    }
  })) passed++; else failed++;

  // getExecCommand tests
  console.log('\ngetExecCommand:');

  if (test('returns correct exec command for npm', () => {
    const originalEnv = process.env.CLAUDE_PACKAGE_MANAGER;
    try {
      process.env.CLAUDE_PACKAGE_MANAGER = 'npm';
      const cmd = pm.getExecCommand('oxfmt', '.');
      assert.strictEqual(cmd, 'npx oxfmt .');
    } finally {
      if (originalEnv !== undefined) {
        process.env.CLAUDE_PACKAGE_MANAGER = originalEnv;
      } else {
        delete process.env.CLAUDE_PACKAGE_MANAGER;
      }
    }
  })) passed++; else failed++;

  if (test('returns correct exec command for pnpm', () => {
    const originalEnv = process.env.CLAUDE_PACKAGE_MANAGER;
    try {
      process.env.CLAUDE_PACKAGE_MANAGER = 'pnpm';
      const cmd = pm.getExecCommand('eslint', '.');
      assert.strictEqual(cmd, 'pnpm dlx eslint .');
    } finally {
      if (originalEnv !== undefined) {
        process.env.CLAUDE_PACKAGE_MANAGER = originalEnv;
      } else {
        delete process.env.CLAUDE_PACKAGE_MANAGER;
      }
    }
  })) passed++; else failed++;

  // getCommandPattern tests
  console.log('\ngetCommandPattern:');

  if (test('generates pattern for dev command', () => {
    const pattern = pm.getCommandPattern('dev');
    assert.ok(pattern.includes('npm run dev'), 'Should include npm');
    assert.ok(pattern.includes('pnpm'), 'Should include pnpm');
    assert.ok(pattern.includes('yarn dev'), 'Should include yarn');
    assert.ok(pattern.includes('bun run dev'), 'Should include bun');
  })) passed++; else failed++;

  if (test('pattern matches actual commands', () => {
    const pattern = pm.getCommandPattern('test');
    const regex = new RegExp(pattern);

    assert.ok(regex.test('npm test'), 'Should match npm test');
    assert.ok(regex.test('pnpm test'), 'Should match pnpm test');
    assert.ok(regex.test('yarn test'), 'Should match yarn test');
    assert.ok(regex.test('bun test'), 'Should match bun test');
    assert.ok(!regex.test('cargo test'), 'Should not match cargo test');
  })) passed++; else failed++;

  // getSelectionPrompt tests
  console.log('\ngetSelectionPrompt:');

  if (test('returns informative prompt', () => {
    const prompt = pm.getSelectionPrompt();
    assert.ok(prompt.includes('Available package managers'), 'Should list available managers');
    assert.ok(prompt.includes('CLAUDE_PACKAGE_MANAGER'), 'Should mention env var');
  })) passed++; else failed++;

  // Summary
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
