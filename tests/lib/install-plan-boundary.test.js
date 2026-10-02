/**
 * Contract tests for the planning-only install entry point.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PLAN_ENTRY = path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'plan.js');
const NODE_BUILTINS = new Set(Module.builtinModules.flatMap(name => [name, `node:${name}`]));

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

function resolveRelativeModule(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  assert.ok(found, `Could not resolve planning dependency from ${path.relative(REPO_ROOT, from)}`);
  return found;
}

function planningDependencyClosure(entry) {
  const pending = [entry];
  const visited = new Set();

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    if (!filePath.endsWith('.js')) continue;

    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(/\brequire\s*\(([^)\r\n]*)\)/g)) {
      const argument = match[1].trim();
      const literal = argument.match(/^(['"])([^'"]+)\1$/);
      assert.ok(literal, `Dynamic require in planning dependency ${path.relative(REPO_ROOT, filePath)}`);
      const specifier = literal[2];
      if (NODE_BUILTINS.has(specifier)) continue;
      assert.ok(specifier.startsWith('.'), `Package import in planning dependency ${path.relative(REPO_ROOT, filePath)}`);
      pending.push(resolveRelativeModule(filePath, specifier));
    }
  }

  return [...visited].map(filePath => path.relative(REPO_ROOT, filePath).split(path.sep).join('/')).sort();
}

function createPlan(createManifestInstallPlan, homeDir) {
  return createManifestInstallPlan({
    sourceRoot: REPO_ROOT,
    target: 'antigravity',
    moduleIds: ['agents-core'],
    homeDir,
  });
}

function runTests() {
  let passed = 0;
  let failed = 0;

  if (test('exposes a planning-only module with a package-free lexical dependency closure', () => {
    const closure = planningDependencyClosure(PLAN_ENTRY);
    assert.ok(closure.includes('scripts/lib/install/plan.js'));
    assert.ok(!closure.includes('scripts/lib/install/apply.js'));
    assert.ok(!closure.includes('scripts/lib/install/antigravity-agent.js'));
  })) passed++; else failed++;

  if (test('does not load js-yaml while generating a real manifest plan', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pure-plan-load-'));
    const loaded = [];
    const originalLoad = Module._load;
    try {
      Module._load = function(request, parent, isMain) {
        loaded.push(request);
        return originalLoad.call(this, request, parent, isMain);
      };
      const { createManifestInstallPlan } = require(PLAN_ENTRY);
      const plan = createPlan(createManifestInstallPlan, tempDir);
      assert.ok(plan.operations.length > 0);
      assert.ok(plan.operations.some(operation => operation.contentTransform === 'antigravity-agent-frontmatter'));
      assert.deepStrictEqual(loaded.filter(request => request === 'js-yaml' || request.startsWith('js-yaml/')), []);
    } finally {
      Module._load = originalLoad;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('preserves the install-executor manifest-plan contract exactly', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pure-plan-contract-'));
    try {
      const pure = require(PLAN_ENTRY).createManifestInstallPlan;
      const facade = require('../../scripts/lib/install-executor').createManifestInstallPlan;
      const purePlan = createPlan(pure, tempDir);
      const facadePlan = createPlan(facade, tempDir);
      assert.match(purePlan.statePreview.installedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(facadePlan.statePreview.installedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepStrictEqual(
        { ...purePlan, statePreview: { ...purePlan.statePreview, installedAt: '<timestamp>' } },
        { ...facadePlan, statePreview: { ...facadePlan.statePreview, installedAt: '<timestamp>' } }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
