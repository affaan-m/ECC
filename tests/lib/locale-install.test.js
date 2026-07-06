/**
 * Tests for --locale translated docs installs.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  listInstallComponents,
  resolveInstallPlan,
} = require('../../scripts/lib/install-manifests');

function normalizePlanPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function runInstallApply(args, options = {}) {
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');
  return execFileSync('node', [scriptPath, ...args], {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
  console.log('\n=== Testing --locale translated docs installs ===\n');

  let passed = 0;
  let failed = 0;

  if (test('component catalog includes only supported locale entries', () => {
    const components = listInstallComponents({ family: 'locale' });
    // Only zh-cn and zh-tw locales are supported after i18n slim-down
    assert.ok(components.some(component => component.id === 'locale:zh-cn'));
    assert.ok(components.some(component => component.id === 'locale:zh-tw'));
    assert.ok(!components.some(component => component.id === 'locale:ja'));
    assert.ok(!components.some(component => component.id === 'locale:de-de'));
    assert.ok(!components.some(component => component.id === 'locale:ko-kr'));
    assert.ok(!components.some(component => component.id === 'locale:pt-br'));
    assert.ok(!components.some(component => component.id === 'locale:tr'));
    assert.ok(!components.some(component => component.id === 'locale:vi-vn'));
    assert.ok(!components.some(component => component.id === 'locale:de-de'));
    assert.ok(!components.some(component => component.id === 'locale:ru'));
    assert.ok(components.every(component => component.family === 'locale'));
  })) passed++; else failed++;

  if (test('locale component resolves to the zh-cn translated docs module', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-plan-'));
    try {
      const plan = resolveInstallPlan({
        includeComponentIds: ['locale:zh-cn'],
        target: 'claude',
        homeDir,
      });

      assert.deepStrictEqual(plan.selectedModuleIds, ['docs-zh-cn']);
      assert.ok(
        plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/zh-CN'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/zh-CN')
        )),
        'Should map docs/zh-CN to ~/.claude/docs/zh-CN'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('locale:zh-tw resolves to the Traditional Chinese translated docs module', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-plan-zh-tw-'));
    try {
      const plan = resolveInstallPlan({
        includeComponentIds: ['locale:zh-tw'],
        target: 'claude',
        homeDir,
      });

      assert.deepStrictEqual(plan.selectedModuleIds, ['docs-zh-tw']);
      assert.ok(
        plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/zh-TW'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/zh-TW')
        )),
        'Should map docs/zh-TW to ~/.claude/docs/zh-TW'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: unknown locale dry-run errors out', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-unknown-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-unknown-project-'));

    try {
      let error = null;
      try {
        runInstallApply([
          '--locale', 'ja',
          '--dry-run',
          '--json',
        ], {
          cwd: projectDir,
          env: { HOME: homeDir },
        });
      } catch (err) {
        error = err;
      }
      assert.ok(error, 'Unknown locale should cause install-apply to fail');
      assert.ok(
        error.message.includes('Unsupported locale')
        || error.message.includes('locale:ja'),
        `Expected unknown locale error, got: ${error.message}`
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: --locale zh-CN dry-run includes docs-zh-cn operations', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-zh-CN-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-zh-CN-project-'));

    try {
      const output = runInstallApply([
        '--locale', 'zh-CN',
        '--dry-run',
        '--json',
      ], {
        cwd: projectDir,
        env: { HOME: homeDir },
      });
      const json = JSON.parse(output);

      assert.strictEqual(json.plan.mode, 'manifest');
      assert.deepStrictEqual(json.plan.includedComponentIds, ['locale:zh-cn']);
      assert.deepStrictEqual(json.plan.selectedModuleIds, ['docs-zh-cn']);
      assert.ok(
        json.plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/zh-CN/README.md'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/zh-CN/README.md')
        )),
        'Should copy translated README into ~/.claude/docs/zh-CN'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: legacy language plus unknown locale errors', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-legacy-dry-run-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-legacy-dry-run-project-'));

    try {
      let error = null;
      try {
        runInstallApply([
          'typescript',
          '--locale', 'ja',
          '--dry-run',
          '--json',
        ], {
          cwd: projectDir,
          env: { HOME: homeDir },
        });
      } catch (err) {
        error = err;
      }
      assert.ok(error, 'Unknown locale with legacy language should fail');
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: --locale zh-TW installs translated docs side-by-side', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-install-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-install-project-'));

    try {
      runInstallApply([
        '--locale', 'zh-TW',
      ], {
        cwd: projectDir,
        env: { HOME: homeDir },
      });

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(
        fs.existsSync(path.join(claudeRoot, 'docs', 'zh-TW', 'README.md')),
        'Should install Traditional Chinese README under docs/zh-TW'
      );
      assert.ok(
        !fs.existsSync(path.join(claudeRoot, 'skills', 'ecc', 'configure-ecc', 'SKILL.md')),
        'Locale-only install should not install English skills'
      );

      const statePath = path.join(claudeRoot, 'ecc', 'install-state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.deepStrictEqual(state.request.includeComponents, ['locale:zh-tw']);
      assert.deepStrictEqual(state.resolution.selectedModules, ['docs-zh-tw']);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
