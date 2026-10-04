/**
 * Tests for scripts/install-plan.js
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'install-plan.js');

function run(args = [], options = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      timeout: 10000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

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
  console.log('\n=== Testing install-plan.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('shows help with no arguments', () => {
    const result = run();
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Inspect ECC selective-install manifests'));
  })) passed++; else failed++;

  if (test('lists install profiles', () => {
    const result = run(['--list-profiles']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Install profiles'));
    assert.ok(result.stdout.includes('core'));
  })) passed++; else failed++;

  if (test('lists install modules', () => {
    const result = run(['--list-modules']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Install modules'));
    assert.ok(result.stdout.includes('rules-core'));
  })) passed++; else failed++;

  if (test('lists install components', () => {
    const result = run(['--list-components', '--family', 'language']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Install components'));
    assert.ok(result.stdout.includes('lang:typescript'));
    assert.ok(!result.stdout.includes('capability:security'));
  })) passed++; else failed++;

  if (test('prints a filtered install plan for a profile and target', () => {
    const result = run([
      '--profile', 'developer',
      '--with', 'capability:security',
      '--without', 'capability:orchestration',
      '--target', 'cursor'
    ]);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Install plan'));
    assert.ok(result.stdout.includes('Included components: capability:security'));
    assert.ok(result.stdout.includes('Excluded components: capability:orchestration'));
    assert.ok(result.stdout.includes('Adapter: cursor-project'));
    assert.ok(result.stdout.includes('Target root:'));
    assert.ok(result.stdout.includes('Install-state:'));
    assert.ok(result.stdout.includes('Operation plan'));
    assert.ok(result.stdout.includes('Excluded by selection'));
    assert.ok(result.stdout.includes('security'));
  })) passed++; else failed++;

  if (test('emits JSON for explicit module resolution', () => {
    const result = run([
      '--modules', 'security',
      '--with', 'capability:research',
      '--target', 'cursor',
      '--json'
    ]);
    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.selectedModuleIds.includes('security'));
    assert.ok(parsed.selectedModuleIds.includes('research-apis'));
    assert.ok(parsed.selectedModuleIds.includes('workflow-quality'));
    assert.deepStrictEqual(parsed.includedComponentIds, ['capability:research']);
    assert.strictEqual(parsed.targetAdapterId, 'cursor-project');
    assert.ok(Array.isArray(parsed.operations));
    assert.ok(parsed.operations.length > 0);
  })) passed++; else failed++;

  if (test('emits JSON for --skills without pulling parent module', () => {
    const result = run([
      '--skills', 'continuous-learning-v2',
      '--target', 'claude',
      '--json',
    ]);
    assert.strictEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.deepStrictEqual(parsed.includedComponentIds, ['skill:continuous-learning-v2']);
    assert.deepStrictEqual(parsed.selectedModuleIds, ['skill-continuous-learning-v2']);
    assert.ok(parsed.operations.some(operation => operation.sourceRelativePath === 'skills/continuous-learning-v2'));
    assert.ok(!parsed.operations.some(operation => operation.sourceRelativePath === 'skills/tdd-workflow'));
  })) passed++; else failed++;

  if (test('loads planning intent from ecc-install.json', () => {
    const configDir = path.join(__dirname, '..', 'fixtures', 'tmp-install-plan-config');
    const configPath = path.join(configDir, 'ecc-install.json');

    try {
      require('fs').mkdirSync(configDir, { recursive: true });
      require('fs').writeFileSync(configPath, JSON.stringify({
        version: 1,
        target: 'cursor',
        profile: 'core',
        include: ['capability:security'],
        exclude: ['capability:orchestration'],
      }, null, 2));

      const result = run(['--config', configPath, '--json']);
      assert.strictEqual(result.code, 0);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.target, 'cursor');
      assert.deepStrictEqual(parsed.includedComponentIds, ['capability:security']);
      assert.deepStrictEqual(parsed.excludedComponentIds, ['capability:orchestration']);
      assert.ok(parsed.selectedModuleIds.includes('security'));
      assert.ok(!parsed.selectedModuleIds.includes('orchestration'));
    } finally {
      require('fs').rmSync(configDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('auto-detects planning intent from project ecc-install.json', () => {
    const configDir = path.join(__dirname, '..', 'fixtures', 'tmp-install-plan-autodetect');
    const configPath = path.join(configDir, 'ecc-install.json');

    try {
      require('fs').mkdirSync(configDir, { recursive: true });
      require('fs').writeFileSync(configPath, JSON.stringify({
        version: 1,
        target: 'cursor',
        profile: 'core',
        include: ['capability:security'],
      }, null, 2));

      const result = run(['--json'], { cwd: configDir });
      assert.strictEqual(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.target, 'cursor');
      assert.strictEqual(parsed.profileId, 'core');
      assert.deepStrictEqual(parsed.includedComponentIds, ['capability:security']);
      assert.ok(parsed.selectedModuleIds.includes('security'));
    } finally {
      require('fs').rmSync(configDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('fails on unknown arguments', () => {
    const result = run(['--unknown-flag']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown argument'));
  })) passed++; else failed++;
  if (test('accepts an existing leading-dash config but never consumes known flags', () => {
    const fs = require('fs');
    const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecc-plan-dash-'));
    try {
      fs.writeFileSync(path.join(directory, '--custom.json'), JSON.stringify({ version: 1, profile: 'core', target: 'cursor' }));
      const result = run(['--config', '--custom.json', '--json'], { cwd: directory });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).profileId, 'core');
      const installScript = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');
      const install = execFileSync('node', [installScript, '--config', '--custom.json', '--dry-run', '--json'], {
        cwd: directory, encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024 * 1024,
      });
      assert.ok(install.includes('core'));
      for (const flag of ['--json', '--dry-run', '--locale', '--enable-hooks', '--no-hooks']) {
        fs.writeFileSync(path.join(directory, flag), '{}');
        assert.strictEqual(run(['--config', flag], { cwd: directory }).code, 1);
        assert.throws(() => execFileSync('node', [installScript, '--config', flag, '--dry-run'], {
          cwd: directory, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000,
        }), /Missing value for --config/);
      }
      assert.strictEqual(run(['--config', '--missing.json'], { cwd: directory }).code, 1);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  })) passed++; else failed++;

  if (test('rejects missing option values before printing a default plan', () => {
    for (const flag of ['--family', '--profile', '--modules', '--with', '--without',
      '--skill', '--skills', '--config', '--target']) {
      for (const suffix of [[], ['--json'], ['-h']]) {
        const result = run(['--profile', 'core', flag, ...suffix]);
        assert.strictEqual(result.code, 1, `${flag} ${suffix}: ${result.stdout}`);
        assert.ok(result.stderr.includes(`Missing value for ${flag}`), result.stderr);
        assert.strictEqual(result.stdout, '');
      }
      if (flag !== '--with' && flag !== '--without') {
        for (const value of ['', '   ']) {
          const result = run(['--profile', 'core', flag, value]);
          assert.strictEqual(result.code, 1);
          assert.ok(result.stderr.includes(`Missing value for ${flag}`), result.stderr);
        }
      }
    }
  })) passed++; else failed++;

  if (test('preserves explicitly empty component overrides as no-ops', () => {
    const result = run(['--profile', 'core', '--with', '', '--without', '   ', '--json']);
    assert.strictEqual(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.deepStrictEqual(parsed.includedComponentIds, []);
    assert.deepStrictEqual(parsed.excludedComponentIds, []);
  })) passed++; else failed++;

  if (test('fails on invalid install target', () => {
    const result = run(['--profile', 'core', '--target', 'not-a-target']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown install target'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
