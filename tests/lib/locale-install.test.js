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

  if (test('component catalog includes locale entries', () => {
    const components = listInstallComponents({ family: 'locale' });
    assert.ok(components.some(component => component.id === 'locale:ja'));
    assert.ok(components.some(component => component.id === 'locale:zh-cn'));
    assert.ok(components.some(component => component.id === 'locale:de-de'));
    assert.ok(components.every(component => component.family === 'locale'));
  })) passed++; else failed++;

  if (test('locale component resolves to the translated docs module', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-plan-'));
    try {
      const plan = resolveInstallPlan({
        includeComponentIds: ['locale:ja'],
        target: 'claude',
        homeDir,
      });

      assert.deepStrictEqual(plan.selectedModuleIds, ['docs-ja-jp']);
      assert.ok(
        plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/ja-JP'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/ja-JP')
        )),
        'Should map docs/ja-JP to ~/.claude/docs/ja-JP'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('locale:de-de resolves to the German translated docs module', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-plan-de-'));
    try {
      const plan = resolveInstallPlan({
        includeComponentIds: ['locale:de-de'],
        target: 'claude',
        homeDir,
      });

      assert.deepStrictEqual(plan.selectedModuleIds, ['docs-de-de']);
      assert.ok(
        plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/de-DE'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/de-DE')
        )),
        'Should map docs/de-DE to ~/.claude/docs/de-DE'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: --locale de dry-run includes docs-de-de operations', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-de-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-de-project-'));

    try {
      const output = runInstallApply([
        '--locale', 'de',
        '--dry-run',
        '--json',
      ], {
        cwd: projectDir,
        env: { HOME: homeDir },
      });
      const json = JSON.parse(output);

      assert.strictEqual(json.plan.mode, 'manifest');
      assert.deepStrictEqual(json.plan.includedComponentIds, ['locale:de-de']);
      assert.deepStrictEqual(json.plan.selectedModuleIds, ['docs-de-de']);
      assert.ok(
        json.plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/de-DE/README.md'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/de-DE/README.md')
        )),
        'Should copy translated README into ~/.claude/docs/de-DE'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: --locale ja dry-run includes docs-ja-jp operations', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-dry-run-project-'));

    try {
      const output = runInstallApply([
        '--locale', 'ja',
        '--dry-run',
        '--json',
      ], {
        cwd: projectDir,
        env: { HOME: homeDir },
      });
      const json = JSON.parse(output);

      assert.strictEqual(json.plan.mode, 'manifest');
      assert.deepStrictEqual(json.plan.includedComponentIds, ['locale:ja']);
      assert.deepStrictEqual(json.plan.selectedModuleIds, ['docs-ja-jp']);
      assert.ok(
        json.plan.operations.some(operation => (
          normalizePlanPath(operation.sourceRelativePath) === 'docs/ja-JP/README.md'
          && normalizePlanPath(operation.destinationPath).endsWith('/.claude/docs/ja-JP/README.md')
        )),
        'Should copy translated README into ~/.claude/docs/ja-JP'
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: legacy language plus --locale keeps legacy install and docs', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-legacy-dry-run-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-legacy-dry-run-project-'));

    try {
      const output = runInstallApply([
        'typescript',
        '--locale', 'ja',
        '--dry-run',
        '--json',
      ], {
        cwd: projectDir,
        env: { HOME: homeDir },
      });
      const json = JSON.parse(output);

      assert.strictEqual(json.plan.mode, 'legacy-compat');
      assert.deepStrictEqual(json.plan.legacyLanguages, ['typescript']);
      assert.ok(json.plan.includedComponentIds.includes('locale:ja'));
      assert.ok(json.plan.selectedModuleIds.includes('framework-language'));
      assert.ok(json.plan.selectedModuleIds.includes('docs-ja-jp'));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('end-to-end: --locale ja installs translated docs side-by-side', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-install-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-install-project-'));

    try {
      runInstallApply([
        '--locale', 'ja',
      ], {
        cwd: projectDir,
        env: { HOME: homeDir },
      });

      const claudeRoot = path.join(homeDir, '.claude');
      assert.ok(
        fs.existsSync(path.join(claudeRoot, 'docs', 'ja-JP', 'README.md')),
        'Should install Japanese README under docs/ja-JP'
      );
      assert.ok(
        !fs.existsSync(path.join(claudeRoot, 'skills', 'ecc', 'configure-ecc', 'SKILL.md')),
        'Locale-only install should not install English skills'
      );

      const statePath = path.join(claudeRoot, 'ecc', 'install-state.json');
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.deepStrictEqual(state.request.includeComponents, ['locale:ja']);
      assert.deepStrictEqual(state.resolution.selectedModules, ['docs-ja-jp']);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
