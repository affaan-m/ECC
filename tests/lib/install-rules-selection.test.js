/**
 * Tests for scripts/lib/install-rules-selection.js
 *
 * Covers the behaviors flagged in PR #2647 review: source selection,
 * stack-to-rule mapping, local/global scope, existing-directory conflicts,
 * cancellation, and apply-failure propagation.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { test, banner, summary } = require('./helpers/mini-test-runner');

const {
  DEFAULT_MAPPINGS_PATH,
  loadStackMappings,
  detectStacks,
  resolveLanguages,
  buildInstallArgs,
  runInstallApply,
  planRulesInstall,
  applyRulesInstall,
  runInstallRulesFlow
} = require('../../scripts/lib/install-rules-selection');

const REPO_ROOT = path.join(__dirname, '..', '..');

function makeTempProjectDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-install-rules-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

const FIXTURE_MAPPINGS = {
  version: 1,
  stacks: [
    {
      id: 'typescript',
      name: 'TypeScript',
      indicators: [
        { file: 'tsconfig.json' },
        { file: 'tsconfig.*.json' },
        { file: 'package.json', contains: 'typescript' }
      ],
      rules: ['common', 'typescript']
    },
    {
      id: 'react',
      name: 'React',
      indicators: [{ file: 'package.json', contains: '"react":' }],
      rules: ['common', 'typescript', 'web', 'react']
    },
    {
      id: 'python',
      name: 'Python',
      indicators: [{ file: 'requirements.txt' }, { file: 'pyproject.toml' }],
      rules: ['common', 'python']
    }
  ]
};

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed += 1;
  else failed += 1;
}

banner('install-rules-selection');

// --- loadStackMappings -----------------------------------------------------

run('loadStackMappings loads the real repo config with the expected shape', () => {
  const mappings = loadStackMappings(DEFAULT_MAPPINGS_PATH);
  assert.strictEqual(typeof mappings.version, 'number');
  assert.ok(Array.isArray(mappings.stacks));
  assert.ok(mappings.stacks.length > 0);
  for (const stack of mappings.stacks) {
    assert.ok(stack.id, 'each stack must declare an id');
    assert.ok(Array.isArray(stack.indicators), `${stack.id} must declare indicators`);
    assert.ok(Array.isArray(stack.rules), `${stack.id} must declare rules`);
  }
});

run('loadStackMappings throws a clear error for a missing file', () => {
  assert.throws(
    () => loadStackMappings('/nonexistent/project-stack-mappings.json'),
    /project-stack-mappings/
  );
});

// --- detectStacks: indicator matching ---------------------------------------

run('detectStacks matches a plain file-exists indicator', () => {
  const dir = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
  const detected = detectStacks(dir, FIXTURE_MAPPINGS);
  assert.deepStrictEqual(detected.map(s => s.id), ['python']);
});

run('detectStacks matches a glob indicator', () => {
  const dir = makeTempProjectDir({ 'tsconfig.build.json': '{}' });
  const detected = detectStacks(dir, FIXTURE_MAPPINGS);
  assert.deepStrictEqual(detected.map(s => s.id), ['typescript']);
});

run('detectStacks matches a "contains" indicator and ignores files where the substring is absent', () => {
  const withReact = makeTempProjectDir({
    'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } })
  });
  const withoutReact = makeTempProjectDir({
    'package.json': JSON.stringify({ dependencies: { express: '^4.0.0' } })
  });
  assert.deepStrictEqual(detectStacks(withReact, FIXTURE_MAPPINGS).map(s => s.id), ['react']);
  assert.deepStrictEqual(detectStacks(withoutReact, FIXTURE_MAPPINGS), []);
});

run('detectStacks returns no matches for an empty project', () => {
  const dir = makeTempProjectDir({});
  assert.deepStrictEqual(detectStacks(dir, FIXTURE_MAPPINGS), []);
});

// --- resolveLanguages: stack-to-rule mapping + source cross-validation -----

run('resolveLanguages flattens and dedupes rule languages, dropping "common"', () => {
  const detected = detectStacks(
    makeTempProjectDir({
      'package.json': JSON.stringify({ dependencies: { react: '^18', typescript: '^5' } })
    }),
    FIXTURE_MAPPINGS
  );
  const { languages } = resolveLanguages(detected, {
    listAvailableLanguages: () => ['typescript', 'web', 'react', 'python', 'go']
  });
  assert.deepStrictEqual(languages, ['react', 'typescript', 'web']);
});

run('resolveLanguages drops languages not present in the installed ECC source and reports them as skipped', () => {
  const detected = detectStacks(makeTempProjectDir({ 'requirements.txt': '' }), FIXTURE_MAPPINGS);
  const { languages, skipped } = resolveLanguages(detected, {
    listAvailableLanguages: () => ['typescript'] // python not installed in this source
  });
  assert.deepStrictEqual(languages, []);
  assert.deepStrictEqual(skipped, ['python']);
});

run('resolveLanguages defaults to the real installed source when no override is given', () => {
  const detected = detectStacks(makeTempProjectDir({ 'requirements.txt': '' }), FIXTURE_MAPPINGS);
  const { languages } = resolveLanguages(detected, { sourceRoot: REPO_ROOT });
  assert.deepStrictEqual(languages, ['python']);
});

// --- buildInstallArgs: local vs global scope --------------------------------

run('buildInstallArgs builds a dry-run argv for the home-scoped (global) claude target', () => {
  const args = buildInstallArgs({ modules: ['rules-core'], target: 'claude', dryRun: true, json: true });
  assert.deepStrictEqual(args, ['--target', 'claude', '--dry-run', '--json', '--modules', 'rules-core']);
});

run('buildInstallArgs builds an apply argv for the project-scoped (local) claude-project target', () => {
  const args = buildInstallArgs({ modules: ['rules-core'], target: 'claude-project', dryRun: false, json: true });
  assert.deepStrictEqual(args, ['--target', 'claude-project', '--json', '--modules', 'rules-core']);
});

run('buildInstallArgs refuses to build an argv with zero modules', () => {
  assert.throws(() => buildInstallArgs({ modules: [], target: 'claude', dryRun: true }), /module/i);
});

// --- runInstallApply: injectable spawn, argv wiring -------------------------

run('runInstallApply invokes node against install-apply.js in the given source root with the given args', () => {
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '{"dryRun":true,"plan":{"warnings":[]}}', stderr: '' };
  };
  const result = runInstallApply({
    sourceRoot: '/fake/source',
    args: ['--target', 'claude', '--dry-run', '--json', 'python'],
    spawn: fakeSpawn
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].command, process.execPath);
  assert.deepStrictEqual(calls[0].args, [
    path.join('/fake/source', 'scripts', 'install-apply.js'),
    '--target',
    'claude',
    '--dry-run',
    '--json',
    'python'
  ]);
  assert.strictEqual(result.status, 0);
});

run('runInstallApply propagates a non-zero exit status without throwing', () => {
  const fakeSpawn = () => ({ status: 1, stdout: '', stderr: 'Error: boom' });
  const result = runInstallApply({ sourceRoot: '/fake/source', args: ['python'], spawn: fakeSpawn });
  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /boom/);
});

// --- planRulesInstall: surfaces existing-directory conflict warnings -------

run('planRulesInstall surfaces plan warnings (e.g. existing-directory conflicts) instead of swallowing them', () => {
  const fakeSpawn = () =>
    ({
      status: 0,
      stdout: JSON.stringify({
        dryRun: true,
        plan: { warnings: ['Destination ~/.claude/rules/ecc/ already exists and files may be overwritten'], operations: [] }
      }),
      stderr: ''
    });
  const dir = makeTempProjectDir({ 'requirements.txt': '' });
  const result = planRulesInstall({
    projectRoot: dir,
    sourceRoot: '/fake/source',
    target: 'claude',
    mappings: FIXTURE_MAPPINGS,
    listAvailableLanguages: () => ['python'],
    spawn: fakeSpawn
  });
  assert.strictEqual(result.languages.length, 1);
  assert.deepStrictEqual(result.plan.warnings, [
    'Destination ~/.claude/rules/ecc/ already exists and files may be overwritten'
  ]);
});

run('planRulesInstall still plans the full rules-core module when no project stack is detected', () => {
  const calls = [];
  const dir = makeTempProjectDir({ 'README.md': 'hello' });
  const result = planRulesInstall({
    projectRoot: dir,
    sourceRoot: '/fake/source',
    target: 'claude',
    mappings: FIXTURE_MAPPINGS,
    listAvailableLanguages: () => ['python'],
    spawn: (command, args) => {
      calls.push(args);
      return { status: 0, stdout: '{"dryRun":true,"plan":{"warnings":[],"operations":[]}}', stderr: '' };
    }
  });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].includes('rules-core'));
  assert.strictEqual(result.languages.length, 0);
  assert.ok(result.plan, 'still returns a real plan for the rules-core module');
});

// --- runInstallRulesFlow: cancellation and partial-failure propagation -----

run('runInstallRulesFlow does not apply when the confirm callback declines (cancellation)', () => {
  const applyCalls = [];
  const fakeSpawn = (command, args) => {
    const isDryRun = args.includes('--dry-run');
    if (!isDryRun) applyCalls.push(args);
    return { status: 0, stdout: '{"dryRun":true,"plan":{"warnings":[],"operations":[]}}', stderr: '' };
  };
  const dir = makeTempProjectDir({ 'requirements.txt': '' });
  const result = runInstallRulesFlow({
    projectRoot: dir,
    sourceRoot: '/fake/source',
    target: 'claude',
    mappings: FIXTURE_MAPPINGS,
    listAvailableLanguages: () => ['python'],
    spawn: fakeSpawn,
    confirm: () => false
  });
  assert.strictEqual(result.status, 'cancelled');
  assert.strictEqual(applyCalls.length, 0);
});

run('runInstallRulesFlow applies when the confirm callback approves', () => {
  const fakeSpawn = (command, args) => {
    const isDryRun = args.includes('--dry-run');
    return {
      status: 0,
      stdout: isDryRun
        ? '{"dryRun":true,"plan":{"warnings":[],"operations":[]}}'
        : '{"dryRun":false,"result":{"warnings":[],"operations":[]}}',
      stderr: ''
    };
  };
  const dir = makeTempProjectDir({ 'requirements.txt': '' });
  const result = runInstallRulesFlow({
    projectRoot: dir,
    sourceRoot: '/fake/source',
    target: 'claude',
    mappings: FIXTURE_MAPPINGS,
    listAvailableLanguages: () => ['python'],
    spawn: fakeSpawn,
    confirm: () => true
  });
  assert.strictEqual(result.status, 'applied');
});

run('runInstallRulesFlow surfaces an apply failure instead of reporting success (no silent partial-failure)', () => {
  const fakeSpawn = (command, args) => {
    const isDryRun = args.includes('--dry-run');
    if (isDryRun) {
      return { status: 0, stdout: '{"dryRun":true,"plan":{"warnings":[],"operations":[]}}', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'Error: disk full' };
  };
  const dir = makeTempProjectDir({ 'requirements.txt': '' });
  const result = runInstallRulesFlow({
    projectRoot: dir,
    sourceRoot: '/fake/source',
    target: 'claude',
    mappings: FIXTURE_MAPPINGS,
    listAvailableLanguages: () => ['python'],
    spawn: fakeSpawn,
    confirm: () => true
  });
  assert.strictEqual(result.status, 'apply-failed');
  assert.match(result.error, /disk full/);
});

run('runInstallRulesFlow still asks for confirmation (with an empty detected-languages list) when no stack was detected', () => {
  let confirmedWith = null;
  const dir = makeTempProjectDir({ 'README.md': 'hello' });
  const fakeSpawn = (command, args) => {
    const isDryRun = args.includes('--dry-run');
    return {
      status: 0,
      stdout: isDryRun
        ? '{"dryRun":true,"plan":{"warnings":[],"operations":[]}}'
        : '{"dryRun":false,"result":{"warnings":[],"operations":[]}}',
      stderr: ''
    };
  };
  const result = runInstallRulesFlow({
    projectRoot: dir,
    sourceRoot: '/fake/source',
    target: 'claude',
    mappings: FIXTURE_MAPPINGS,
    listAvailableLanguages: () => ['python'],
    spawn: fakeSpawn,
    confirm: planResult => {
      confirmedWith = planResult;
      return true;
    }
  });
  assert.ok(confirmedWith, 'confirm should still be called for a whole-module install');
  assert.deepStrictEqual(confirmedWith.languages, []);
  assert.strictEqual(result.status, 'applied');
});

// --- End-to-end smoke test against the real install-apply.js CLI -----------

run('end-to-end: planRulesInstall against the real install-apply.js produces a real rules-core dry-run plan', () => {
  const dir = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
  const result = planRulesInstall({
    projectRoot: dir,
    sourceRoot: REPO_ROOT,
    target: 'claude-project',
    mappings: FIXTURE_MAPPINGS
  });
  // Informational only: this project's stack is Python, even though the
  // actual install always installs the whole rules-core module (see the
  // module-level doc comment on scripts/lib/install-rules-selection.js).
  assert.deepStrictEqual(result.languages, ['python']);
  assert.ok(result.plan, 'expected a real plan object from install-apply.js --dry-run --json');
  assert.ok(Array.isArray(result.plan.warnings));
  assert.ok(Array.isArray(result.plan.operations));
  assert.ok(result.plan.operations.length > 0, 'expected at least one planned rules operation');
  assert.ok(
    result.plan.operations.some(op => op.sourceRelativePath && op.sourceRelativePath.includes('rules/')),
    'expected rules-core operations to come from rules/'
  );
});

summary(passed, failed);
