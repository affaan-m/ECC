#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const { fixtureEnvironment } = require('../../scripts/copilot-native-discovery');

const ROOT = path.resolve(__dirname, '../..');
const BASELINE = 'a64711b70660e6f53e6f4066762a5bf3a67f4485';
const BASELINE_FILES = [
  'scripts/lib/copilot-sessions.js', 'scripts/lib/memory-vault-format.js',
  'scripts/copilot-learning.py', 'skills/continuous-learning-v2/scripts/instinct-cli.py',
];
const INSTINCT = '---\nid: baseline-instinct\ntrigger: when testing upgrades\nconfidence: 0.9\ndomain: workflow\n---\n## Action\nKeep the original instinct.\n';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc copilot upgrade '));
  try {
    const project = fs.realpathSync(fs.mkdirSync(path.join(root, 'project'), { recursive: true }));
    const env = { ...fixtureEnvironment(root), ECC_COPILOT_OBSERVE: '1' };
    const run = (executable, args, input, cwd = project) => execFileSync(executable, args, {
      cwd, env, input, encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const revision = run('git', ['rev-parse', 'HEAD'], undefined, ROOT).trim();
    const baseline = path.join(root, 'baseline');
    for (const file of BASELINE_FILES) {
      const destination = path.join(baseline, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, run('git', ['show', `${BASELINE}:${file}`], undefined, ROOT));
    }
    const python = process.env.ECC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const learning = (source, args, input) => JSON.parse(run(python, [path.join(source, 'scripts/copilot-learning.py'), ...args], input));
    const old = require(path.join(baseline, 'scripts/lib/copilot-sessions.js'));
    old.checkpoint(project, 'baseline-session', 'Baseline checkpoint.', env);
    assert.match(learning(baseline, ['import', '--stdin', '--apply'], INSTINCT).output, /Import complete/);

    const options = { target: 'copilot', repoRoot: ROOT, projectRoot: project, homeDir: root, env };
    applyInstallPlan(withHookConsent(createManifestInstallPlan({ ...options, moduleIds: ['commands-core'] }), 'declined'));
    const installed = path.join(project, '.github/ecc');
    const current = require(path.join(installed, 'scripts/lib/copilot-sessions.js'));
    assert.equal(current.recall(project, 'baseline-session', env).summary, 'Baseline checkpoint.');
    assert.match(learning(installed, ['export']).output, /id: baseline-instinct/);
    current.checkpoint(project, 'new-session', 'New checkpoint.', env);
    assert.equal(old.recall(project, 'new-session', env).summary, 'New checkpoint.');

    assert.equal(learning(installed, ['identity', '--apply']).applied, true);
    const sink = require(path.join(installed, 'scripts/lib/copilot-observations.js'));
    assert.equal(sink.observe({ schemaVersion: 1, event: 'postToolUse', sessionId: 'new-session', callId: 'fixture-read',
      workspace: { canonical: project }, tool: { name: 'Read' }, outcome: { status: 'succeeded' } }, env).status, 'recorded');
    run(process.execPath, [path.join(installed, 'scripts/copilot-observer.js'), 'once', '--backend', 'metadata-sequences']);
    const observer = require(path.join(installed, 'scripts/lib/copilot-observer.js'));
    const cursorPath = observer.stateFile(project, env);
    const cursor = fs.readFileSync(cursorPath);

    const lifecycle = { ...options, targets: ['copilot'] };
    assert.equal(repairInstalledStates(lifecycle).summary.errorCount, 0);
    assert.equal(uninstallInstalledStates(lifecycle).summary.errorCount, 0);
    assert.equal(old.recall(project, 'baseline-session', env).summary, 'Baseline checkpoint.');
    assert.equal(old.recall(project, 'new-session', env).summary, 'New checkpoint.');
    assert.match(learning(baseline, ['export']).output, /id: baseline-instinct/);
    assert.deepEqual(fs.readFileSync(cursorPath), cursor);
    return { schema: 'ecc.copilot.upgrade-fixture.v1', status: 'passed', baseline: BASELINE,
      revision, platform: process.platform, node: process.version, preserved: ['checkpoints', 'instinct', 'observer-cursor'] };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

try { process.stdout.write(JSON.stringify(fixture(), null, 2) + '\n'); }
catch { process.stderr.write('Copilot upgrade fixture failed. Verify the pinned baseline exists in Git and Python is available.\n'); process.exitCode = 1; }
