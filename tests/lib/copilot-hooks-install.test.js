'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install-executor');
const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { writeInstallState } = require('../../scripts/lib/install-state');

const REPO_ROOT = path.resolve(__dirname, '../..');
const ENTRYPOINT = '.github/ecc/scripts/hooks/copilot-hook-adapter.js';
const EXPECTED_RUNTIME = [
  'hooks/copilot-hook-adapter.js',
  'hooks/block-no-verify.js',
  'hooks/config-protection.js',
  'hooks/doc-file-warning.js',
  'hooks/pretooluse-visible-output.js',
  'hooks/post-edit-console-warn.js',
  'hooks/lib/shell-scan.js',
  'lib/copilot-hooks.js',
  'lib/copilot-event-envelope.js',
  'hooks/copilot-guard.js', 'hooks/gateguard-fact-force.js', 'hooks/gateguard-heredoc.js',
  'lib/shell-substitution.js', 'lib/powershell-destructive-command.js',
  'lib/gateguard-state.js', 'lib/gateguard-target-class.js',
  'lib/copilot-shell-preflight.js', 'hooks/pre-bash-commit-quality.js', 'hooks/pre-bash-git-push-reminder.js',
  'hooks/copilot-quality.js', 'lib/copilot-quality.js', 'lib/resolve-formatter.js',
  'hooks/copilot-canvas.js', 'lib/copilot-canvas.js', 'lib/plan-canvas/sessions.js',
  'lib/package-manager.js', 'hooks/design-quality-check.js',
  'hooks/copilot-observe.js', 'lib/copilot-observations.js',
  'hooks/copilot-evidence.js', 'lib/copilot-evidence.js',
  'lib/copilot-telemetry.js', 'copilot-telemetry.js', 'lib/skill-evolution/tracker.js',
  'lib/copilot-native-skill-telemetry.js', 'hooks/copilot-native-telemetry.js',
  'lib/hook-flags.js',
  'lib/copilot-accessories.js', 'hooks/copilot-accessories.js',
  'lib/utils.js',
  'lib/agent-data-home.js',
  'lib/path-safety.js',
  'hooks/copilot-lifecycle.js',
  'lib/copilot-sessions.js',
  'lib/memory-vault-format.js',
  'copilot-hookify.js', 'lib/copilot-native-events.js', 'lib/copilot-runtime-tools.js',
  'hooks/hookify-runtime.js', 'hooks/hookify-frontmatter.js', 'hooks/hook-input.js', 'hooks/hook-input-limits.js',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc copilot hooks-'));
  try {
    fn(project);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}\n    Error: ${error.message}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

function planFor(project, consent = 'enabled') {
  return withHookConsent(createManifestInstallPlan({
    target: 'copilot',
    moduleIds: ['hooks-runtime'],
    projectRoot: project,
    homeDir: path.join(project, 'home'),
    env: {},
  }), consent);
}

function lifecycleOptions(project) {
  return {
    repoRoot: REPO_ROOT,
    projectRoot: project,
    homeDir: path.join(project, 'home'),
    targets: ['copilot'],
    env: {},
  };
}

function readConfig(project) {
  return JSON.parse(fs.readFileSync(path.join(project, '.github/hooks/ecc.json'), 'utf8'));
}

function invoke(project, entry, toolArgs) {
  assert.strictEqual(entry.exec, 'node');
  assert.ok(!entry.command && !entry.bash && !entry.powershell, 'launch must use direct argv, not a shell');
  const result = spawnSync(process.execPath, entry.args, {
    cwd: project,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '' },
    input: JSON.stringify({
      sessionId: 'copilot-installed-fixture',
      cwd: project,
      toolName: 'edit',
      toolArgs,
    }),
  });
  assert.ifError(result.error);
  return { ...result, output: JSON.parse(result.stdout) };
}

console.log('\n=== Testing managed Copilot hook installation ===\n');

test('hooks-runtime installs native commands and only the audited dependency closure', project => {
  const plan = planFor(project);
  applyInstallPlan(plan);
  const config = readConfig(project);
  assert.strictEqual(config.version, 1);
  assert.deepStrictEqual(Object.keys(config.hooks).sort(), ['agentStop', 'postToolUse', 'postToolUseFailure', 'preCompact', 'preToolUse', 'sessionEnd', 'sessionStart', 'userPromptSubmitted', 'userPromptTransformed']);
  assert.strictEqual(config.hooks.preToolUse.length, 6);
  assert.strictEqual(config.hooks.postToolUse.length, 4);
  assert.ok(!config.hooks.postToolUse.some(entry => entry.args[2] === 'post:edit:console-warn'), 'stop checks replace duplicate console warnings');
  assert.ok(!config.hooks.preToolUse.some(entry => entry.args[2] === 'pre:bash:block-no-verify'), 'combined guard invokes no-verify once');
  for (const [event, entries] of Object.entries(config.hooks)) {
    for (const entry of entries) {
      assert.strictEqual(entry.type, 'command');
      assert.strictEqual(entry.exec, 'node');
      const toolEvent = ['preToolUse', 'postToolUse'].includes(event);
      if (entry.args[0] === '.github/ecc/scripts/copilot-hookify.js') {
        assert.deepStrictEqual(entry.args.slice(1), ['hook', event]);
        continue;
      }
      if (['copilot-quality.js', 'copilot-observe.js', 'copilot-evidence.js', 'copilot-native-telemetry.js', 'copilot-canvas.js'].includes(path.basename(entry.args[0]))) {
        assert.deepStrictEqual(entry.args.slice(1), [event]);
        continue;
      }
      assert.strictEqual(entry.args[0], toolEvent ? ENTRYPOINT : '.github/ecc/scripts/hooks/copilot-lifecycle.js');
      assert.strictEqual(entry.args[1], event);
      if (toolEvent) assert.ok(entry.args[2], 'policy hook id must be explicit');
      assert.ok(entry.timeoutSec >= 15);
    }
  }
  const runtimeOperations = plan.operations.filter(operation => operation.sourceRelativePath.startsWith('scripts/'));
  assert.deepStrictEqual(runtimeOperations.map(operation => operation.sourceRelativePath.replace(/^scripts\//, '')).sort(), EXPECTED_RUNTIME.slice().sort());
  for (const relative of EXPECTED_RUNTIME) {
    assert.ok(fs.existsSync(path.join(project, '.github/ecc/scripts', relative)), relative);
  }
  assert.ok(!fs.existsSync(path.join(project, '.github/ecc/scripts/hooks/session-start.js')), 'Claude lifecycle must not be copied wholesale');
  assert.ok(plan.operations.every(operation => operation.moduleId === 'hooks-runtime'));
});

test('installed lifecycle checkpoint restores from generated hook, repair and uninstall preserve user memory', project => {
  applyInstallPlan(planFor(project));
  const config = readConfig(project);
  const dataHome = path.join(project, 'private-copilot');
  const env = { ...process.env, COPILOT_HOME: dataHome, ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '' };
  const invokeLifecycle = (args, input) => {
    const result = spawnSync(process.execPath, args, {
      cwd: project, env, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 15000,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const entry = config.hooks.sessionStart[0];
  invokeLifecycle(entry.args, { sessionId: 'one', cwd: project, source: 'startup' });
  const runtime = entry.args[0];
  invokeLifecycle([runtime, 'checkpoint', '--session', 'one', '--stdin'], 'Installer E2E checkpoint.');
  const restored = invokeLifecycle(entry.args, { sessionId: 'two', cwd: project, source: 'new' });
  assert.match(restored.additionalContext, /Installer E2E checkpoint/);
  fs.unlinkSync(path.join(project, runtime));
  repairInstalledStates(lifecycleOptions(project));
  assert.ok(fs.existsSync(path.join(project, runtime)));
  uninstallInstalledStates(lifecycleOptions(project));
  assert.ok(fs.existsSync(path.join(dataHome, 'ecc', 'projects')), 'uninstall must not remove private session data');
});

test('declining combined hooks and commands keeps manual session runtime without activation', project => {
  const plan = withHookConsent(createManifestInstallPlan({
    target: 'copilot', moduleIds: ['hooks-runtime', 'commands-core'],
    projectRoot: project, homeDir: path.join(project, 'home'), env: {},
  }), 'declined');
  applyInstallPlan(plan);
  assert.ok(!fs.existsSync(path.join(project, '.github/hooks/ecc.json')));
  const result = spawnSync(process.execPath, ['.github/ecc/scripts/hooks/copilot-lifecycle.js', 'checkpoint', '--session', 'manual', '--stdin'], {
    cwd: project, env: { ...process.env, COPILOT_HOME: path.join(project, 'private-copilot') },
    input: 'Manual commands still work.', encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).saved, true);
});

test('installed config guard denies existing config edits with object and JSON-string arguments', project => {
  applyInstallPlan(planFor(project));
  const config = readConfig(project);
  const guard = config.hooks.preToolUse.find(entry => entry.args[2] === 'pre:config-protection');
  assert.ok(guard, 'native config guard must be registered');
  const relative = 'cartella con spazi-è/eslint.config.js';
  const target = path.join(project, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'module.exports = [];\n');
  for (const args of [{ path: relative, old_str: '[]', new_str: '[{}]' }, JSON.stringify({ path: relative })]) {
    const result = invoke(project, guard, args);
    assert.strictEqual(result.output.permissionDecision, 'deny', result.stdout);
    assert.ok(result.output.permissionDecisionReason, 'deny reason must reach Copilot');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'module.exports = [];\n', 'guard must not execute the edit');
  }
  const allowed = invoke(project, guard, { path: 'brand-new/.prettierrc' });
  assert.deepStrictEqual(allowed.output, {}, 'success must leave normal Copilot permissions in force');
});

test('install is repeatable and repair restores missing runtime before uninstall preserves custom hooks', project => {
  const userHook = path.join(project, '.github/hooks/custom.json');
  const userContent = '{"version":1,"hooks":{}}\n';
  fs.mkdirSync(path.dirname(userHook), { recursive: true });
  fs.writeFileSync(userHook, userContent);
  applyInstallPlan(planFor(project));
  const original = fs.readFileSync(path.join(project, '.github/hooks/ecc.json'), 'utf8');
  applyInstallPlan(planFor(project));
  assert.strictEqual(fs.readFileSync(path.join(project, '.github/hooks/ecc.json'), 'utf8'), original);
  const runtime = path.join(project, ENTRYPOINT);
  fs.unlinkSync(runtime);
  const options = lifecycleOptions(project);
  const repair = repairInstalledStates(options);
  assert.strictEqual(repair.summary.errorCount, 0, JSON.stringify(repair));
  assert.ok(fs.existsSync(runtime), 'repair must restore the recorded dependency');
  const guard = readConfig(project).hooks.preToolUse.find(entry => entry.args[2] === 'pre:config-protection');
  assert.deepStrictEqual(invoke(project, guard, { path: 'new-file.js' }).output, {});
  const uninstall = uninstallInstalledStates(options);
  assert.strictEqual(uninstall.summary.errorCount, 0, JSON.stringify(uninstall));
  assert.ok(!fs.existsSync(runtime));
  assert.ok(!fs.existsSync(path.join(project, '.github/hooks/ecc.json')));
  assert.strictEqual(fs.readFileSync(userHook, 'utf8'), userContent);
});

test('install repair and uninstall never claim an existing user-owned ecc.json', project => {
  const userHook = path.join(project, '.github/hooks/ecc.json');
  const userContent = '{"version":1,"hooks":{},"owner":"user"}\n';
  fs.mkdirSync(path.dirname(userHook), { recursive: true });
  fs.writeFileSync(userHook, userContent);
  const plan = planFor(project);
  applyInstallPlan(plan);
  assert.strictEqual(fs.readFileSync(userHook, 'utf8'), userContent);
  const options = lifecycleOptions(project);
  const repair = repairInstalledStates(options);
  assert.strictEqual(repair.summary.errorCount, 0, JSON.stringify(repair));
  const state = JSON.parse(fs.readFileSync(plan.installStatePath, 'utf8'));
  assert.ok(!state.operations.some(operation => operation.destinationPath === userHook), 'user config must not become ECC-owned');
  const uninstall = uninstallInstalledStates(options);
  assert.strictEqual(uninstall.summary.errorCount, 0, JSON.stringify(uninstall));
  assert.strictEqual(fs.readFileSync(userHook, 'utf8'), userContent);
});

test('declined hook consent removes both activation and runtime materialization', project => {
  const plan = planFor(project, 'declined');
  assert.ok(!plan.selectedModuleIds.includes('hooks-runtime'));
  assert.ok(!plan.operations.some(operation => operation.moduleId === 'hooks-runtime'));
  applyInstallPlan(plan);
  assert.ok(!fs.existsSync(path.join(project, '.github/hooks/ecc.json')));
  assert.ok(!fs.existsSync(path.join(project, ENTRYPOINT)));
  assert.ok(!fs.existsSync(path.join(project, '.github/ecc/scripts/package.json')));
});

test('Copilot repairs an older ESM install and preserves the module scope of retained user scripts', project => {
  const rootPackage = path.join(project, 'package.json');
  const rootBytes = '{"type":"module"}\n';
  fs.writeFileSync(rootPackage, rootBytes);
  const plan = planFor(project);
  applyInstallPlan(plan);
  const marker = path.join(project, '.github/ecc/scripts/package.json');
  const ledger = JSON.parse(fs.readFileSync(plan.installStatePath, 'utf8'));
  ledger.operations = ledger.operations.filter(operation => operation.destinationPath !== marker);
  writeInstallState(plan.installStatePath, ledger);
  fs.unlinkSync(marker);

  const custom = path.join(path.dirname(marker), 'user.js');
  fs.writeFileSync(custom, 'export default 1;\n');
  assert.throws(() => previewInstallPlan(plan), /unowned or edited JavaScript/);
  assert.equal(repairInstalledStates(lifecycleOptions(project)).summary.errorCount, 1);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'export default 1;\n');
  assert.ok(!fs.existsSync(marker));
  fs.unlinkSync(custom);
  assert.equal(repairInstalledStates(lifecycleOptions(project)).summary.errorCount, 0);
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).type, 'commonjs');
  const config = readConfig(project);
  const guard = config.hooks.preToolUse.find(entry => entry.args[2] === 'pre:config-protection');
  assert.equal(invoke(project, guard, { path: 'demo.js' }).status, 0);

  fs.writeFileSync(custom, 'module.exports = 1;\n');
  const uninstall = uninstallInstalledStates(lifecycleOptions(project));
  assert.equal(uninstall.results[0].status, 'partial');
  assert.ok(uninstall.results[0].retainedPaths.includes(marker));
  assert.ok(fs.existsSync(marker));
  assert.equal(fs.readFileSync(custom, 'utf8'), 'module.exports = 1;\n');
  assert.equal(fs.readFileSync(rootPackage, 'utf8'), rootBytes);
});

test('declining previously enabled hooks removes the managed manifest and repair cannot recreate it', project => {
  const enabled = planFor(project);
  applyInstallPlan(enabled);
  const manifest = path.join(project, '.github/hooks/ecc.json');
  const userHook = path.join(project, '.github/hooks/user.json');
  fs.writeFileSync(userHook, '{}\n');
  const declined = planFor(project, 'declined');
  const preview = previewInstallPlan(declined);
  assert.deepStrictEqual(preview.plannedCopilotHookRemovals, [manifest]);
  assert.ok(fs.existsSync(manifest));
  const result = applyInstallPlan(declined);
  assert.deepStrictEqual(result.reconciledStalePaths, [manifest]);
  assert.equal(result.statePreview.request.hookConsent, 'declined');
  assert.ok(!result.statePreview.operations.some(operation => operation.destinationPath === manifest));
  assert.ok(!fs.existsSync(manifest));
  assert.equal(repairInstalledStates(lifecycleOptions(project)).summary.errorCount, 0);
  assert.ok(!fs.existsSync(manifest));
  assert.equal(fs.readFileSync(userHook, 'utf8'), '{}\n');
  assert.ok(fs.existsSync(path.join(project, ENTRYPOINT)));
  applyInstallPlan(enabled);
  assert.ok(fs.existsSync(manifest));
});

test('declining hooks refuses edited and unowned manifests without publishing consent', project => {
  const enabled = planFor(project);
  const manifest = path.join(project, '.github/hooks/ecc.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  const userContent = '{"version":1,"hooks":{}}\n';
  fs.writeFileSync(manifest, userContent);
  assert.throws(() => applyInstallPlan(planFor(project, 'declined')), /unowned Copilot hook manifest/);
  assert.equal(fs.readFileSync(manifest, 'utf8'), userContent);
  assert.ok(!fs.existsSync(enabled.installStatePath));
  fs.unlinkSync(manifest);
  applyInstallPlan(enabled);
  const linked = path.join(project, 'manifest-hardlink.json');
  fs.linkSync(manifest, linked);
  assert.throws(() => applyInstallPlan(planFor(project, 'declined')), /multiple hard links/);
  fs.unlinkSync(linked);
  fs.writeFileSync(manifest, userContent);
  const previousState = fs.readFileSync(enabled.installStatePath, 'utf8');
  assert.throws(() => previewInstallPlan(planFor(project, 'declined')), /changed after install/);
  assert.throws(() => applyInstallPlan(planFor(project, 'declined')), /changed after install/);
  assert.equal(fs.readFileSync(manifest, 'utf8'), userContent);
  assert.equal(fs.readFileSync(enabled.installStatePath, 'utf8'), previousState);
});

test('repair refuses an old declined state that still owns the Copilot activation', project => {
  const enabled = planFor(project);
  applyInstallPlan(enabled);
  const manifest = path.join(project, '.github/hooks/ecc.json');
  const legacyState = JSON.parse(fs.readFileSync(enabled.installStatePath, 'utf8'));
  legacyState.request.hookConsent = 'declined';
  fs.writeFileSync(enabled.installStatePath, JSON.stringify(legacyState));
  fs.unlinkSync(manifest);
  const repair = repairInstalledStates(lifecycleOptions(project));
  assert.equal(repair.summary.errorCount, 1);
  assert.match(repair.results[0].error, /--no-hooks/);
  assert.ok(!fs.existsSync(manifest));
  applyInstallPlan(planFor(project, 'declined'));
  assert.equal(repairInstalledStates(lifecycleOptions(project)).summary.errorCount, 0);
  assert.ok(!fs.existsSync(manifest));
});

test('deactivation rechecks the manifest and preserves the previous decision on a late edit', project => {
  const enabled = planFor(project);
  applyInstallPlan(enabled);
  const manifest = path.join(project, '.github/hooks/ecc.json');
  const declined = withHookConsent(createManifestInstallPlan({
    target: 'copilot', moduleIds: ['commands-core'], projectRoot: project,
    homeDir: path.join(project, 'home'), env: {},
  }), 'declined');
  assert.throws(() => applyInstallPlan(declined, {
    beforeInstallStateWrite({ state }) {
      if (state.request.hookConsent === 'declined') fs.appendFileSync(manifest, '\n');
    },
  }), /changed after install/);
  assert.ok(fs.existsSync(manifest));
  const state = JSON.parse(fs.readFileSync(enabled.installStatePath, 'utf8'));
  assert.equal(state.request.hookConsent, 'enabled');
  assert.ok(state.operations.some(operation => operation.destinationPath === manifest));
});

test('a state write failure after deactivation checkpoints the inactive manifest', project => {
  const enabled = planFor(project);
  applyInstallPlan(enabled);
  const declined = withHookConsent(createManifestInstallPlan({
    target: 'copilot', moduleIds: ['commands-core'], projectRoot: project,
    homeDir: path.join(project, 'home'), env: {},
  }), 'declined');
  let failed = false;
  assert.throws(() => applyInstallPlan(declined, {
    writeInstallState(file, state) {
      if (!failed && state.request.hookConsent === 'declined') {
        failed = true;
        throw new Error('simulated final write failure');
      }
      return writeInstallState(file, state);
    },
  }), /simulated final write failure/);
  const manifest = path.join(project, '.github/hooks/ecc.json');
  assert.ok(!fs.existsSync(manifest));
  const state = JSON.parse(fs.readFileSync(enabled.installStatePath, 'utf8'));
  assert.equal(state.request.hookConsent, 'declined');
  assert.ok(!state.operations.some(operation => operation.destinationPath === manifest));
  assert.equal(repairInstalledStates(lifecycleOptions(project)).summary.errorCount, 0);
  assert.ok(!fs.existsSync(manifest));
});

test('automatic hook installation requires the existing explicit consent gate', project => {
  const plan = createManifestInstallPlan({
    target: 'copilot',
    moduleIds: ['hooks-runtime'],
    projectRoot: project,
    homeDir: path.join(project, 'home'),
    env: {},
  });
  assert.throws(() => applyInstallPlan(plan), /--enable-hooks/);
  assert.ok(!fs.existsSync(path.join(project, '.github/hooks/ecc.json')));
  assert.ok(!fs.existsSync(path.join(project, ENTRYPOINT)));
});

test('missing canonical policy cannot silently allow a pre-tool call', project => {
  applyInstallPlan(planFor(project));
  const guard = readConfig(project).hooks.preToolUse.find(entry => entry.args[2] === 'pre:config-protection');
  fs.unlinkSync(path.join(project, '.github/ecc/scripts/hooks/config-protection.js'));
  const result = invoke(project, guard, { path: 'demo.js' });
  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(result.output.permissionDecision, 'deny');
});

test('child timeout denies before the outer Copilot deadline', project => {
  applyInstallPlan(planFor(project));
  const guard = readConfig(project).hooks.preToolUse.find(entry => entry.args[2] === 'pre:config-protection');
  fs.writeFileSync(path.join(project, '.github/ecc/scripts/hooks/config-protection.js'), 'setInterval(() => {}, 1000);\n');
  const started = Date.now();
  const result = invoke(project, guard, { path: 'demo.js' });
  assert.ok(Date.now() - started < 14000, 'internal timeout must precede outer timeout');
  assert.strictEqual(result.output.permissionDecision, 'deny');
  assert.notStrictEqual(result.status, 0);
});

console.log(`\nPassed: ${passed}\nFailed: ${failed}\n`);
process.exitCode = failed ? 1 : 0;
