'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createHash } = require('crypto');
const { readInstallState, writeInstallState } = require('../../scripts/lib/install-state');

const cli = path.resolve(__dirname, '../../scripts/ecc.js');
let passed = 0;
let failed = 0;

for (const target of ['claude', 'claude-project']) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-native-names-')));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    ECC_AGENT_DATA_HOME: path.join(home, '.claude'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    OPENCODE_CONFIG_DIR: path.join(home, '.config/opencode'),
    CODEX_HOME: path.join(home, '.codex'),
    ECC_DRY_RUN: '0',
  };
  const installRoot = path.join(target === 'claude' ? home : project, '.claude');
  const rule = path.join(installRoot, 'rules/ecc/common/agents.md');
  const run = args => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: project, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 45000,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    return result;
  };
  const assertNativeNames = () => {
    assert.match(fs.readFileSync(rule, 'utf8'), /Agent\(subagent_type: "planner"/);
    assert.doesNotMatch(fs.readFileSync(rule, 'utf8'), /Agent\(subagent_type: "ecc:planner"/);
    assert.ok(fs.existsSync(path.join(installRoot, 'agents/planner.md')));
    assert.ok(fs.existsSync(path.join(installRoot, 'skills/tdd-workflow/SKILL.md')));
  };
  try {
    const installArgs = ['install', '--target', target, '--modules', 'rules-core',
      '--with', 'agent:planner', '--with', 'skill:tdd-workflow', '--no-hooks'];
    run(installArgs);
    assertNativeNames();
    const report = JSON.parse(run(['doctor', '--target', target, '--json']).stdout);
    assert.strictEqual(report.summary.errorCount, 0);
    assert.strictEqual(report.summary.warningCount, 0);
    // Seed obsolete managed records from an older install, then exercise the
    // public reinstall instead of calling reconciliation directly.
    const statePath = path.join(installRoot, 'ecc/install-state.json');
    const obsoleteContent = '# obsolete managed rule\n';
    const stalePaths = ['obsolete-unchanged.md', 'obsolete-edited.md']
      .map(name => path.join(installRoot, 'rules/ecc/common', name));
    const state = readInstallState(statePath);
    for (const file of stalePaths) {
      fs.writeFileSync(file, obsoleteContent);
      state.operations.push({
        kind: 'copy-file', moduleId: 'rules-core',
        sourceRelativePath: `rules/common/${path.basename(file)}`,
        destinationPath: file, strategy: 'preserve-relative-path',
        ownership: 'managed', scaffoldOnly: false,
        contentTransform: 'claude-manual-plugin-namespace',
        contentSha256: createHash('sha256').update(obsoleteContent).digest('hex'),
      });
    }
    writeInstallState(statePath, state);
    const userEdit = '# user wants to keep this obsolete rule\n';
    fs.writeFileSync(stalePaths[1], userEdit);
    const reinstall = JSON.parse(run([...installArgs, '--json']).stdout).result;
    assert.ok(!fs.existsSync(stalePaths[0]), 'Unmodified obsolete managed files should be removed');
    assert.strictEqual(fs.readFileSync(stalePaths[1], 'utf8'), userEdit);
    assert.deepStrictEqual(reinstall.reconciledStalePaths, [stalePaths[0]]);
    assert.strictEqual(reinstall.warnings.filter(warning => warning.startsWith('Preserved orphaned file ')).length, 1);
    assert.ok(readInstallState(statePath).operations.every(operation => !stalePaths.includes(operation.destinationPath)));
    assertNativeNames();
    const afterReinstall = JSON.parse(run(['doctor', '--target', target, '--json']).stdout);
    assert.strictEqual(afterReinstall.summary.errorCount, 0);
    assert.strictEqual(afterReinstall.summary.warningCount, 0);
    fs.appendFileSync(rule, '\nlocal drift\n');
    run(['repair', '--target', target, '--json']);
    assertNativeNames();
    assert.doesNotMatch(fs.readFileSync(rule, 'utf8'), /local drift/);
    run(installArgs);
    assertNativeNames();
    const userFile = path.join(installRoot, 'user-note.txt');
    fs.writeFileSync(userFile, 'keep this user file\n');
    run(['uninstall', '--target', target, '--json']);
    assert.ok(!fs.existsSync(rule));
    assert.strictEqual(fs.readFileSync(userFile, 'utf8'), 'keep this user file\n');
    assert.strictEqual(fs.readFileSync(stalePaths[1], 'utf8'), userEdit);
    passed++;
    console.log(`  PASS ${target} install, doctor, repair, reinstall and uninstall preserve native names`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${target}: ${error.stack}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
