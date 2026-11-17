'use strict';

/**
 * Regression tests for stale install-state operations (issue #3232).
 *
 * A reinstall must drop managed copy-file records that a selected module no
 * longer ships, delete only unchanged regular files reached without symlinks,
 * and keep ownership whenever the install fails or the record is out of scope.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install/apply');
const { readInstallState, writeInstallState } = require('../../scripts/lib/install-state');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { createInstallPlanFromRequest } = require('../../scripts/lib/install/runtime');
const { normalizeInstallRequest, parseInstallArgs } = require('../../scripts/lib/install/request');
const { buildDoctorReport } = require('../../scripts/lib/install-lifecycle');
const { completeStaleOperationsReconciliation } = require('../../scripts/lib/install/stale-operations-reconciliation');

const REPO_ROOT = path.join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stale-ops-'));
  try {
    if (fn(root) === 'skip') {
      console.log(`  - ${name} (skipped: symlinks unavailable)`);
      skipped += 1;
      return;
    }
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function trySymlink(targetPath, linkPath, type) {
  try {
    fs.symlinkSync(targetPath, linkPath, type);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && (error.code === 'EPERM' || error.code === 'EACCES')) {
      return false;
    }
    throw error;
  }
}

function cursorTarget(root) {
  const targetRoot = path.join(root, '.cursor');
  return {
    root,
    targetRoot,
    installStatePath: path.join(targetRoot, 'ecc-install-state.json'),
    adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
  };
}

function claudeTarget(root) {
  const targetRoot = path.join(root, '.claude');
  return {
    root,
    targetRoot,
    installStatePath: path.join(targetRoot, 'ecc', 'install-state.json'),
    adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
  };
}

// spec: { moduleId, source, dest?, kind?, content?, payload?, skipSource? }
function buildOperation(target, spec) {
  const destinationPath = path.join(target.targetRoot, spec.dest || spec.source);
  if (spec.kind === 'merge-json') {
    return {
      kind: 'merge-json',
      moduleId: spec.moduleId,
      sourceRelativePath: spec.source,
      destinationPath,
      strategy: 'merge-json',
      ownership: 'managed',
      scaffoldOnly: false,
      mergePayload: spec.payload || { managed: true },
    };
  }
  const sourcePath = path.join(target.root, 'source', spec.source);
  if (!spec.skipSource) {
    writeFile(sourcePath, spec.content === undefined ? `${spec.source}\n` : spec.content);
  }
  return {
    kind: 'copy-file',
    moduleId: spec.moduleId,
    sourcePath,
    sourceRelativePath: spec.source,
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
  };
}

function makePlan(target, specs, options = {}) {
  const operations = specs.map(spec => buildOperation(target, spec));
  const modules = options.modules || [...new Set(operations.map(operation => operation.moduleId))];
  return {
    mode: 'manifest',
    target: target.adapter.target,
    adapter: target.adapter,
    targetRoot: target.targetRoot,
    installRoot: target.targetRoot,
    installStatePath: target.installStatePath,
    operations,
    statePreview: {
      schemaVersion: 'ecc.install.v1',
      installedAt: new Date().toISOString(),
      target: { ...target.adapter, root: target.targetRoot, installStatePath: target.installStatePath },
      request: {
        profile: null,
        modules,
        includeComponents: [],
        excludeComponents: [],
        legacyLanguages: [],
        legacyMode: false,
        hookConsent: null,
      },
      resolution: { selectedModules: modules, skippedModules: [] },
      source: { manifestVersion: 1 },
      operations,
    },
    warnings: [],
  };
}

function relativeDestinations(target, operations) {
  const ops = operations || readInstallState(target.installStatePath).operations;
  return ops
    .map(operation => path.relative(target.targetRoot, operation.destinationPath).split(path.sep).join('/'))
    .sort();
}

function findRecord(target, relativePath) {
  const destinationPath = path.join(target.targetRoot, relativePath);
  return readInstallState(target.installStatePath).operations
    .find(operation => operation.destinationPath === destinationPath);
}

function editState(target, transform) {
  const state = readInstallState(target.installStatePath);
  writeInstallState(target.installStatePath, { ...state, operations: transform(state.operations) });
}

function orphanWarnings(result) {
  return result.warnings.filter(warning => warning.startsWith('Preserved orphaned file '));
}

const KEEP = { moduleId: 'core', source: 'lib/keep.js' };

console.log('\n=== Testing stale install-state operations (#3232) ===\n');

for (const phase of ['during hashing', 'after hashing']) {
  test(`preserves an equal-length user edit ${phase}`, root => {
    const target = cursorTarget(root);
    const file = path.join(target.targetRoot, 'obsolete.txt');
    const original = 'installed bytes\n';
    const edited = 'user edit bytes\n';
    assert.strictEqual(original.length, edited.length);
    writeFile(file, original);
    // Bind the fixture identity to its opened private file. Validate the
    // retained pathname through a fresh descriptor after the injected race.
    const identityFd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let identity;
    try { identity = fs.fstatSync(identityFd, { bigint: true }); }
    finally { fs.closeSync(identityFd); }
    const originalRead = fs.readFileSync;
    const originalFstat = fs.fstatSync;
    let mutationApplied = false;
    let matchingStats = 0;
    const matches = stat => stat.dev === identity.dev && stat.ino === identity.ino;
    const mutate = () => {
      fs.writeFileSync(file, edited);
      // Avoid depending on filesystem timestamp granularity in the race fixture.
      const later = new Date(Date.now() + 2000);
      fs.utimesSync(file, later, later);
      mutationApplied = true;
    };
    fs.readFileSync = function (value, ...args) {
      const bytes = originalRead.call(this, value, ...args);
      if (phase === 'during hashing' && typeof value === 'number'
        && matches(originalFstat(value, { bigint: true }))) mutate();
      return bytes;
    };
    fs.fstatSync = function (descriptor, ...args) {
      const stat = originalFstat.call(this, descriptor, ...args);
      if (phase === 'after hashing' && matches(stat) && ++matchingStats === 2) mutate();
      return stat;
    };
    let result;
    try {
      result = completeStaleOperationsReconciliation({ staleOperationCandidates: [{
        destinationPath: file, contentSha256: sha256(original),
      }] }, { targetRoot: target.targetRoot });
    } finally {
      fs.readFileSync = originalRead;
      fs.fstatSync = originalFstat;
    }
    assert.ok(mutationApplied, 'The equal-length mutation must actually execute');
    const retainedFd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const retainedIdentity = fs.fstatSync(retainedFd, { bigint: true });
      assert.ok(retainedIdentity.isFile());
      assert.ok(matches(retainedIdentity), 'The mutated fixture inode must remain at the retained path');
      assert.strictEqual(fs.readFileSync(retainedFd, 'utf8'), edited);
    } finally {
      fs.closeSync(retainedFd);
    }
    assert.deepStrictEqual(result.removedPaths, []);
    assert.strictEqual(result.warnings.length, 1);
    assert.match(result.warnings[0], /changed while being verified/);
  });
}

test('removes an unchanged stale copy and its record after a successful reinstall', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/obsolete/cost-estimate.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const stalePath = path.join(target.targetRoot, stale.source);
  assert.ok(fs.existsSync(stalePath));

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.ok(!fs.existsSync(stalePath), 'unchanged stale copy should be deleted');
  assert.ok(!fs.existsSync(path.dirname(stalePath)), 'emptied stale directory should be pruned');
  assert.ok(fs.existsSync(path.join(target.targetRoot, KEEP.source)));
  assert.deepStrictEqual(result.reconciledStalePaths, [path.resolve(stalePath)]);
  assert.deepStrictEqual(result.warnings, []);
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
  assert.deepStrictEqual(relativeDestinations(target, result.statePreview.operations), ['lib/keep.js']);
});

test('preserves a modified stale copy, drops its record, and warns only once', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/edited.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const stalePath = path.join(target.targetRoot, stale.source);
  fs.writeFileSync(stalePath, 'user edit\n');

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.strictEqual(fs.readFileSync(stalePath, 'utf8'), 'user edit\n');
  assert.deepStrictEqual(result.reconciledStalePaths, []);
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1, warnings.join('\n'));
  assert.ok(warnings[0].includes(stalePath) && /content changed after install/.test(warnings[0]));
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);

  const rerun = applyInstallPlan(makePlan(target, [KEEP]));
  assert.deepStrictEqual(orphanWarnings(rerun), [], 'an untracked orphan must not warn again');
  assert.strictEqual(fs.readFileSync(stalePath, 'utf8'), 'user edit\n');
});

test('preserves a stale copy whose record has no content digest', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/old-ledger.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  editState(target, operations => operations.map(operation => {
    if (!operation.destinationPath.endsWith('old-ledger.js')) {
      return operation;
    }
    const { contentSha256: _digest, ...digestless } = operation;
    return digestless;
  }));

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.ok(fs.existsSync(path.join(target.targetRoot, stale.source)));
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1);
  assert.ok(/no content digest/.test(warnings[0]));
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
});

test('preserves a stale destination that is no longer a regular file', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/now-a-dir.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const stalePath = path.join(target.targetRoot, stale.source);
  fs.rmSync(stalePath);
  writeFile(path.join(stalePath, 'user.txt'), 'user data\n');

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.strictEqual(fs.readFileSync(path.join(stalePath, 'user.txt'), 'utf8'), 'user data\n');
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1);
  assert.ok(/not a regular file/.test(warnings[0]));
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
});

test('never deletes a stale record destination outside the target root', root => {
  const target = cursorTarget(root);
  applyInstallPlan(makePlan(target, [KEEP]));
  const outsidePath = path.join(root, 'outside', 'victim.js');
  writeFile(outsidePath, 'victim\n');
  editState(target, operations => [...operations, {
    kind: 'copy-file',
    moduleId: 'core',
    sourceRelativePath: 'lib/victim.js',
    destinationPath: outsidePath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
    contentSha256: sha256('victim\n'),
  }]);

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.strictEqual(fs.readFileSync(outsidePath, 'utf8'), 'victim\n');
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1);
  assert.ok(/outside the install root/.test(warnings[0]));
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
});

test('never deletes the in-root target of a stale symlinked destination', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/linked.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const linkPath = path.join(target.targetRoot, stale.source);
  // The link target holds exactly the recorded bytes, so following the link
  // would pass the digest check and delete the user's file.
  const linkTarget = path.join(target.targetRoot, 'user', 'linked-target.js');
  writeFile(linkTarget, `${stale.source}\n`);
  fs.rmSync(linkPath);
  if (!trySymlink(linkTarget, linkPath, 'file')) {
    return 'skip';
  }

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.ok(fs.lstatSync(linkPath).isSymbolicLink(), 'the symlink itself must be preserved');
  assert.strictEqual(fs.readFileSync(linkTarget, 'utf8'), `${stale.source}\n`);
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1);
  assert.ok(/is a symlink/.test(warnings[0]));
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
});

test('never deletes through an in-root symlinked parent directory', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'nested/stale.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const linkedDir = path.join(target.targetRoot, 'nested');
  const realDir = path.join(target.targetRoot, 'real-nested');
  fs.renameSync(linkedDir, realDir);
  if (!trySymlink(realDir, linkedDir, 'dir')) {
    return 'skip';
  }

  const result = applyInstallPlan(makePlan(target, [KEEP]));
  assert.strictEqual(fs.readFileSync(path.join(realDir, 'stale.js'), 'utf8'), `${stale.source}\n`);
  assert.ok(fs.lstatSync(linkedDir).isSymbolicLink());
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1);
  assert.ok(/passes through the symlink/.test(warnings[0]));
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
});

test('dry-run previews the reconciled state without mutating files or install-state', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/obsolete.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const stateBefore = fs.readFileSync(target.installStatePath, 'utf8');

  const preview = previewInstallPlan(makePlan(target, [KEEP]));
  assert.strictEqual(preview.applied, false);
  assert.ok(fs.existsSync(path.join(target.targetRoot, stale.source)), 'dry-run must not delete');
  assert.strictEqual(fs.readFileSync(target.installStatePath, 'utf8'), stateBefore);
  assert.deepStrictEqual(relativeDestinations(target, preview.statePreview.operations), ['lib/keep.js']);
  assert.ok(preview.warnings.some(warning => /^1 previously managed file\(s\) are no longer part/.test(warning)));
  assert.deepStrictEqual(orphanWarnings(preview), []);
});

test('a failed reinstall keeps stale records and files for a later retry', root => {
  const target = cursorTarget(root);
  const stale = { moduleId: 'core', source: 'lib/obsolete.js' };
  applyInstallPlan(makePlan(target, [KEEP, stale]));
  const stalePath = path.join(target.targetRoot, stale.source);
  const recorded = findRecord(target, stale.source);

  // Failure while copying: the checkpoint is the bridge state.
  const broken = { moduleId: 'core', source: 'lib/missing-source.js', skipSource: true };
  assert.throws(() => applyInstallPlan(makePlan(target, [KEEP, broken])), /ENOENT/);
  assert.ok(fs.existsSync(stalePath));
  assert.deepStrictEqual(findRecord(target, stale.source), recorded);

  // Failure while persisting the final state, after every copy succeeded.
  let stateWrites = 0;
  assert.throws(() => applyInstallPlan(makePlan(target, [KEEP]), {
    beforeInstallStateWrite() {
      stateWrites += 1;
      if (stateWrites === 2) {
        throw new Error('simulated final install-state write failure');
      }
    },
  }), /simulated final install-state write failure/);
  assert.strictEqual(stateWrites, 2, 'bridge and final state writes should both be attempted');
  assert.ok(fs.existsSync(stalePath), 'stale file must survive a failed install');
  assert.deepStrictEqual(findRecord(target, stale.source), recorded);

  const retry = applyInstallPlan(makePlan(target, [KEEP]));
  assert.ok(!fs.existsSync(stalePath));
  assert.deepStrictEqual(retry.reconciledStalePaths, [path.resolve(stalePath)]);
  assert.deepStrictEqual(relativeDestinations(target), ['lib/keep.js']);
});

test('selective --modules installs only reconcile modules they select', root => {
  const target = cursorTarget(root);
  const alphaOne = { moduleId: 'alpha', source: 'alpha/one.md' };
  const alphaTwo = { moduleId: 'alpha', source: 'alpha/two.md' };
  const beta = { moduleId: 'beta', source: 'beta/one.md' };
  applyInstallPlan(makePlan(target, [alphaOne, alphaTwo]));
  applyInstallPlan(makePlan(target, [beta]));
  assert.deepStrictEqual(relativeDestinations(target), ['alpha/one.md', 'alpha/two.md', 'beta/one.md']);

  const alphaResult = applyInstallPlan(makePlan(target, [alphaOne]));
  assert.ok(!fs.existsSync(path.join(target.targetRoot, alphaTwo.source)));
  assert.deepStrictEqual(alphaResult.reconciledStalePaths, [
    path.resolve(path.join(target.targetRoot, alphaTwo.source)),
  ]);
  assert.ok(fs.existsSync(path.join(target.targetRoot, beta.source)), 'unselected module files stay');
  assert.deepStrictEqual(relativeDestinations(target), ['alpha/one.md', 'beta/one.md']);

  const betaResult = applyInstallPlan(makePlan(target, [beta]));
  assert.deepStrictEqual(betaResult.reconciledStalePaths, []);
  assert.deepStrictEqual(relativeDestinations(target), ['alpha/one.md', 'beta/one.md']);
});

test('reconciles a destination change for the same module and source', root => {
  const target = cursorTarget(root);
  applyInstallPlan(makePlan(target, [{ moduleId: 'core', source: 'cfg/tool.json', dest: 'old/tool.json' }]));
  const result = applyInstallPlan(makePlan(target, [{ moduleId: 'core', source: 'cfg/tool.json', dest: 'new/tool.json' }]));
  assert.ok(!fs.existsSync(path.join(target.targetRoot, 'old', 'tool.json')));
  assert.ok(fs.existsSync(path.join(target.targetRoot, 'new', 'tool.json')));
  assert.strictEqual(result.reconciledStalePaths.length, 1);
  const state = readInstallState(target.installStatePath);
  assert.deepStrictEqual(relativeDestinations(target), ['new/tool.json']);
  assert.strictEqual(state.operations[0].sourceRelativePath, 'cfg/tool.json');
});

test('keeps a destination whose kind changes and drops a kind-plus-destination move', root => {
  const target = cursorTarget(root);
  applyInstallPlan(makePlan(target, [
    { moduleId: 'core', source: 'cfg/config.json', dest: 'config.json', content: '{"base":1}\n' },
    { moduleId: 'core', source: 'cfg/events.json', dest: 'events/events.json', content: '{"events":[]}\n' },
  ]));

  const result = applyInstallPlan(makePlan(target, [
    { moduleId: 'core', kind: 'merge-json', source: 'cfg/config.json', dest: 'config.json', payload: { merged: true } },
    { moduleId: 'core', kind: 'merge-json', source: 'cfg/events.json', dest: 'settings.json', payload: { events: [] } },
  ]));

  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(target.targetRoot, 'config.json'), 'utf8')),
    { base: 1, merged: true },
    'a same-destination kind change must keep the file'
  );
  assert.ok(!fs.existsSync(path.join(target.targetRoot, 'events', 'events.json')));
  assert.deepStrictEqual(result.reconciledStalePaths, [
    path.resolve(path.join(target.targetRoot, 'events', 'events.json')),
  ]);
  const state = readInstallState(target.installStatePath);
  assert.deepStrictEqual(relativeDestinations(target), ['config.json', 'settings.json']);
  assert.ok(state.operations.every(operation => operation.kind === 'merge-json'));
});

test('preserves Claude legacy-skill migration conflict ownership', root => {
  const target = claudeTarget(root);
  const legacyPath = path.join(target.targetRoot, 'skills', 'ecc', 'demo', 'SKILL.md');
  const flatUserPath = path.join(target.targetRoot, 'skills', 'demo', 'SKILL.md');
  writeFile(legacyPath, '# demo (nested ECC copy)\n');
  writeFile(flatUserPath, '# demo (user-owned)\n');
  const seedPlan = makePlan(target, []);
  writeInstallState(target.installStatePath, {
    ...seedPlan.statePreview,
    request: { ...seedPlan.statePreview.request, modules: ['skills-core'] },
    resolution: { selectedModules: ['skills-core'], skippedModules: [] },
    operations: [{
      kind: 'copy-file',
      moduleId: 'skills-core',
      sourceRelativePath: 'skills/demo/SKILL.md',
      destinationPath: legacyPath,
      strategy: 'preserve-relative-path',
      ownership: 'managed',
      scaffoldOnly: false,
      contentSha256: sha256('# demo (nested ECC copy)\n'),
    }],
  });

  const result = applyInstallPlan(makePlan(target, [
    { moduleId: 'skills-core', source: 'skills/demo/SKILL.md', dest: 'skills/demo/SKILL.md' },
    { moduleId: 'skills-core', source: 'rules/keep.md', dest: 'rules/ecc/keep.md' },
  ]));

  assert.ok(result.warnings.some(warning => warning.startsWith("Skipped Claude skill 'demo'")));
  assert.deepStrictEqual(orphanWarnings(result), []);
  assert.deepStrictEqual(result.reconciledStalePaths, []);
  assert.strictEqual(fs.readFileSync(legacyPath, 'utf8'), '# demo (nested ECC copy)\n');
  assert.strictEqual(fs.readFileSync(flatUserPath, 'utf8'), '# demo (user-owned)\n');
  assert.deepStrictEqual(relativeDestinations(target), ['rules/ecc/keep.md', 'skills/ecc/demo/SKILL.md']);
});

test('declining hooks keeps hook files from modules that remain selected', root => {
  const target = cursorTarget(root);
  const hook = { moduleId: 'platform-configs', source: '.cursor/hooks/after-edit.js', dest: 'hooks/after-edit.js' };
  const rule = { moduleId: 'platform-configs', source: 'rules/keep.md' };
  applyInstallPlan(withHookConsent(makePlan(target, [hook, rule]), 'enabled'));

  const declined = withHookConsent(makePlan(target, [hook, rule]), 'declined');
  assert.ok(!declined.operations.some(operation => operation.sourceRelativePath === hook.source));
  const result = applyInstallPlan(declined);
  assert.deepStrictEqual(result.reconciledStalePaths, []);
  assert.ok(fs.existsSync(path.join(target.targetRoot, hook.dest)));
  assert.deepStrictEqual(relativeDestinations(target), ['hooks/after-edit.js', 'rules/keep.md']);
});

test('legacy language installs stay cumulative inside a shared module', root => {
  const target = cursorTarget(root);
  const legacyPlan = specs => ({ ...makePlan(target, specs), mode: 'legacy' });
  applyInstallPlan(legacyPlan([{ moduleId: 'legacy-cursor-install', source: 'rules/python-style.md' }]));
  const result = applyInstallPlan(legacyPlan([{ moduleId: 'legacy-cursor-install', source: 'rules/typescript-style.md' }]));
  assert.deepStrictEqual(result.reconciledStalePaths, []);
  assert.ok(fs.existsSync(path.join(target.targetRoot, 'rules', 'python-style.md')));
  assert.deepStrictEqual(relativeDestinations(target), ['rules/python-style.md', 'rules/typescript-style.md']);
});

test('Claude home reinstall drops obsolete hooks.json and cost-estimate.js records (#3232)', root => {
  const homeDir = path.join(root, 'home');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  const env = { HOME: homeDir, USERPROFILE: homeDir };
  const request = normalizeInstallRequest({
    ...parseInstallArgs(['node', 'install-apply.js', '--profile', 'core', '--enable-hooks']),
    config: null,
  });
  const createPlan = () => createInstallPlanFromRequest(request, { projectRoot, homeDir, env });
  const doctorCodes = () => buildDoctorReport({ repoRoot: REPO_ROOT, homeDir, projectRoot, targets: ['claude'], env })
    .results.flatMap(result => result.issues.map(issue => issue.code));

  const initialPlan = createPlan();
  applyInstallPlan(initialPlan);
  const claudeRoot = initialPlan.targetRoot;
  const hooksJsonPath = path.join(claudeRoot, 'hooks', 'hooks.json');
  const costEstimatePath = path.join(claudeRoot, 'scripts', 'lib', 'cost-estimate.js');
  const legacyHooksJson = '{"hooks":{}}\n';
  const legacyCostEstimate = 'module.exports = {};\n';
  // Seed the records an older pin left behind: hooks.json was copied before it
  // moved into settings.json, and cost-estimate.js was later deleted upstream.
  writeFile(hooksJsonPath, legacyHooksJson);
  writeFile(costEstimatePath, '// user tweak\n');
  const staleRecord = (sourceRelativePath, destinationPath, installedContent) => ({
    kind: 'copy-file',
    moduleId: 'hooks-runtime',
    sourcePath: path.join(REPO_ROOT, sourceRelativePath),
    sourceRelativePath,
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
    contentSha256: sha256(installedContent),
  });
  editState({ installStatePath: initialPlan.installStatePath }, operations => [
    ...operations,
    staleRecord('hooks/hooks.json', hooksJsonPath, legacyHooksJson),
    staleRecord('scripts/lib/cost-estimate.js', costEstimatePath, legacyCostEstimate),
  ]);
  assert.ok(doctorCodes().includes('missing-source-files'), 'seeded state should reproduce the doctor error');

  const plannedDestinations = new Set(createPlan().operations.map(operation => operation.destinationPath));
  const preview = previewInstallPlan(createPlan());
  assert.ok(
    preview.statePreview.operations.every(operation => plannedDestinations.has(operation.destinationPath)),
    'dry-run state preview must not carry operations the plan no longer contains'
  );
  assert.ok(fs.existsSync(hooksJsonPath) && fs.existsSync(costEstimatePath));

  const result = applyInstallPlan(createPlan());
  assert.ok(!fs.existsSync(hooksJsonPath), 'unchanged obsolete hooks.json should be removed');
  assert.strictEqual(fs.readFileSync(costEstimatePath, 'utf8'), '// user tweak\n');
  const warnings = orphanWarnings(result);
  assert.strictEqual(warnings.length, 1, warnings.join('\n'));
  assert.ok(warnings[0].includes(costEstimatePath));

  const state = readInstallState(initialPlan.installStatePath);
  assert.ok(!state.operations.some(operation => (
    operation.destinationPath === hooksJsonPath || operation.destinationPath === costEstimatePath
  )));
  const codes = doctorCodes();
  assert.ok(!codes.includes('missing-source-files'), `doctor still reports: ${codes.join(', ')}`);
  assert.ok(!codes.includes('drifted-managed-files'), `doctor still reports: ${codes.join(', ')}`);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
