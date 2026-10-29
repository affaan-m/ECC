/**
 * Contract tests for the GitHub Copilot install target.
 *
 * Covers the frontmatter transform in isolation and the adapter's operation
 * planning, including the containment guarantee that nothing is written
 * outside the project's .github/ directory.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { adaptCopilotAgent } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'copilot-agent'));
const copilotAdapter = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install-targets', 'copilot-project'));
const { getInstallTargetAdapter } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install-targets', 'registry'));
const { SUPPORTED_INSTALL_TARGETS } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install-manifests'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

const CLAUDE_AGENT = [
  '---',
  'name: architect',
  'description: Software architecture specialist.',
  'tools: Read, Grep, Glob',
  'model: opus',
  'color: teal',
  '---',
  '',
  '## Role',
  '',
  'You are an architect.',
  '',
].join('\n');

function planFor(modules) {
  return copilotAdapter.planOperations({
    repoRoot: '/repo',
    projectRoot: '/project',
    homeDir: '/home/user',
    modules,
  });
}

console.log('=== Testing Copilot install target ===\n');

test('registry resolves the copilot target and adapter id', () => {
  assert.strictEqual(getInstallTargetAdapter('copilot').id, 'copilot-project');
  assert.strictEqual(getInstallTargetAdapter('copilot-project').id, 'copilot-project');
  assert.strictEqual(copilotAdapter.target, 'copilot');
  assert.strictEqual(copilotAdapter.kind, 'project');
});

test('copilot is a supported install target', () => {
  assert.ok(SUPPORTED_INSTALL_TARGETS.includes('copilot'));
});

test('transform keeps only name and description', () => {
  const adapted = adaptCopilotAgent(CLAUDE_AGENT, 'agents/architect.md');
  assert.match(adapted, /^---\n/);
  assert.match(adapted, /name: architect/);
  assert.match(adapted, /description: Software architecture specialist\./);
  assert.doesNotMatch(adapted, /^model:/m);
  assert.doesNotMatch(adapted, /^tools:/m);
  assert.doesNotMatch(adapted, /^color:/m);
});

test('transform preserves the agent body verbatim', () => {
  const adapted = adaptCopilotAgent(CLAUDE_AGENT, 'agents/architect.md');
  assert.ok(adapted.includes('## Role'));
  assert.ok(adapted.includes('You are an architect.'));
});

test('transform rejects a file without frontmatter', () => {
  assert.throws(
    () => adaptCopilotAgent('# no frontmatter\n', 'agents/broken.md'),
    /missing YAML frontmatter/
  );
});

test('transform rejects frontmatter that is not an object', () => {
  assert.throws(
    () => adaptCopilotAgent('---\n- a\n- b\n---\nbody\n', 'agents/broken.md'),
    /frontmatter must be an object/
  );
});

test('transform requires name and description', () => {
  assert.throws(
    () => adaptCopilotAgent('---\nname: only-name\n---\nbody\n', 'agents/broken.md'),
    /missing required frontmatter "description"/
  );
  assert.throws(
    () => adaptCopilotAgent('---\ndescription: only description\n---\nbody\n', 'agents/broken.md'),
    /missing required frontmatter "name"/
  );
});

test('agents are planned into .github/agents with the frontmatter transform', () => {
  const operations = planFor([{ id: 'agents-core', paths: ['agents'] }]);
  assert.strictEqual(operations.length, 1);
  assert.strictEqual(operations[0].contentTransform, 'copilot-agent-frontmatter');
  assert.strictEqual(operations[0].destinationPath, path.join('/project', '.github', 'agents'));
});

test('skills are planned into .github/skills with installed helper references', () => {
  const operations = planFor([{ id: 'workflow-quality', paths: ['skills/tdd-workflow'] }]);
  assert.strictEqual(operations.length, 1);
  assert.strictEqual(operations[0].contentTransform, 'copilot-workflow-paths');
  assert.strictEqual(
    operations[0].destinationPath,
    path.join('/project', '.github', 'skills', 'tdd-workflow')
  );
});

test('unsupported source paths produce no operations', () => {
  const operations = planFor([
    { id: 'rules-core', paths: ['rules'] },
    { id: 'commands-core', paths: ['commands', 'scripts/harness-audit.js'] },
    { id: 'hooks-runtime', paths: ['hooks', 'scripts/hooks'] },
    { id: 'platform-configs', paths: ['.claude-plugin', '.codex', 'mcp-configs'] },
  ]);
  assert.strictEqual(operations.length, 0);
});

test('supportsModule stays permissive so dependency anchors still resolve', () => {
  // rules-core, commands-core and platform-configs ship no agents or skills but
  // are dependencies of the skill modules. Gating them out here would cascade
  // and skip every module that depends on them.
  assert.strictEqual(copilotAdapter.supportsModule({ id: 'rules-core', paths: ['rules'] }), true);
  assert.strictEqual(copilotAdapter.supportsModule({ id: 'empty', paths: [] }), false);
});

test('every planned operation is contained within .github', () => {
  const operations = planFor([
    { id: 'agents-core', paths: ['agents', '.agents', 'AGENTS.md'] },
    { id: 'framework-language', paths: ['skills/api-design', 'skills/react-patterns'] },
    { id: 'rules-core', paths: ['rules'] },
  ]);
  const root = path.join('/project', '.github');
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    const relative = path.relative(root, operation.destinationPath);
    assert.ok(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      `operation escapes .github: ${operation.destinationPath}`
    );
  }
});

test('AGENTS.md and .agents are not installed by this target', () => {
  const operations = planFor([{ id: 'agents-core', paths: ['.agents', 'AGENTS.md'] }]);
  assert.strictEqual(operations.length, 0);
});

test('traversal segments produce no planned operations', () => {
  for (const value of ['agents/../../escape.md', 'skills/../escape.md', 'agents\\..\\..\\escape.md']) {
    assert.deepStrictEqual(planFor([{ id: 'agents-core', paths: [value] }]), []);
  }
});

test('repair and uninstall preserve user-owned agents across project adapters', () => {
  const fs = require('fs');
  const os = require('os');
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
  for (const [target, segments] of [['copilot', ['.github', 'agents']], ['antigravity', ['.agents', 'agents']]]) {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agent-ownership-'));
    try {
      const agent = path.join(project, ...segments, 'architect.md');
      fs.mkdirSync(path.dirname(agent), { recursive: true });
      fs.writeFileSync(agent, 'USER OWNED SENTINEL\n');
      const homeDir = path.join(project, 'home');
      const plan = createManifestInstallPlan({ target, moduleIds: ['agents-core'], projectRoot: project, homeDir, env: {} });
      applyInstallPlan(plan);
      assert.strictEqual(fs.readFileSync(agent, 'utf8'), 'USER OWNED SENTINEL\n', 'install must preserve user file');
      const options = { repoRoot: REPO_ROOT, projectRoot: project, homeDir, targets: [target], env: {} };
      const repair = repairInstalledStates(options);
      assert.strictEqual(repair.summary.errorCount, 0, JSON.stringify(repair));
      assert.strictEqual(fs.readFileSync(agent, 'utf8'), 'USER OWNED SENTINEL\n', 'repair must preserve user file');
      const state = JSON.parse(fs.readFileSync(plan.installStatePath, 'utf8'));
      assert.ok(!state.operations.some(operation => operation.destinationPath === agent), 'repair must not claim ownership');
      const uninstall = uninstallInstalledStates(options);
      assert.strictEqual(uninstall.summary.errorCount, 0, JSON.stringify(uninstall));
      assert.strictEqual(fs.readFileSync(agent, 'utf8'), 'USER OWNED SENTINEL\n', 'uninstall must preserve user file');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }
});

test('normal installed Copilot TDD command runs from the project with a complete managed helper closure', () => {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-workflow-'));
  try {
    const env = { ...process.env, ECC_AGENT_DATA_HOME: path.join(project, 'data') };
    const homeDir = path.join(project, 'home');
    fs.mkdirSync(path.join(project, 'scripts'));
    fs.writeFileSync(path.join(project, 'scripts', 'setup-package-manager.js'), 'USER PROJECT SENTINEL\n');
    fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    const plan = createManifestInstallPlan({ target: 'copilot', moduleIds: ['workflow-quality'], projectRoot: project, homeDir, env });
    applyInstallPlan(plan);
    const skill = fs.readFileSync(path.join(project, '.github', 'skills', 'tdd-workflow', 'SKILL.md'), 'utf8');
    const command = skill.match(/node (\S*setup-package-manager\.js) --detect/);
    assert.ok(command, 'installed skill must give an executable detection command');
    assert.strictEqual(command[1], '.github/ecc/scripts/setup-package-manager.js');
    for (const helper of ['package-manager', 'utils', 'agent-data-home', 'path-safety']) {
      assert.ok(fs.existsSync(path.join(project, '.github', 'ecc', 'scripts', 'lib', `${helper}.js`)), helper);
    }
    const detected = spawnSync(process.execPath, [command[1], '--detect'], { cwd: project, env, encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(detected.status, 0, detected.stderr);
    assert.match(detected.stdout, /pnpm/);
    assert.ok(!plan.operations.some(operation => operation.kind === 'update-claude-settings'
      || /[\\/]\.github[\\/]hooks[\\/]|[\\/]ecc[\\/]scripts[\\/]hooks[\\/]|settings\.json$|hooks\.json$/.test(operation.destinationPath)), 'Copilot must not register hooks');
    assert.strictEqual(fs.readFileSync(path.join(project, 'scripts', 'setup-package-manager.js'), 'utf8'), 'USER PROJECT SENTINEL\n');
    const options = { repoRoot: REPO_ROOT, projectRoot: project, homeDir, targets: ['copilot'], env };
    const repair = repairInstalledStates(options);
    assert.strictEqual(repair.summary.errorCount, 0, JSON.stringify(repair));
    const uninstall = uninstallInstalledStates(options);
    assert.strictEqual(uninstall.summary.errorCount, 0, JSON.stringify(uninstall));
    assert.ok(!fs.existsSync(path.join(project, '.github', 'ecc', 'scripts', 'lib', 'package-manager.js')));

    const userProject = path.join(project, 'user-project');
    const userHelper = path.join(userProject, '.github', 'ecc', 'scripts', 'setup-package-manager.js');
    fs.mkdirSync(path.dirname(userHelper), { recursive: true });
    fs.writeFileSync(userHelper, 'USER OWNED HELPER SENTINEL\n');
    const userPlan = createManifestInstallPlan({ target: 'copilot', moduleIds: ['workflow-quality'], projectRoot: userProject, homeDir, env });
    applyInstallPlan(userPlan);
    assert.strictEqual(fs.readFileSync(userHelper, 'utf8'), 'USER OWNED HELPER SENTINEL\n');
    const userOptions = { ...options, projectRoot: userProject };
    const userRepair = repairInstalledStates(userOptions);
    assert.strictEqual(userRepair.summary.errorCount, 0);
    assert.strictEqual(fs.readFileSync(userHelper, 'utf8'), 'USER OWNED HELPER SENTINEL\n');
    const state = JSON.parse(fs.readFileSync(userPlan.installStatePath, 'utf8'));
    assert.ok(!state.operations.some(operation => operation.destinationPath === userHelper));
    const userUninstall = uninstallInstalledStates(userOptions);
    assert.strictEqual(userUninstall.summary.errorCount, 0);
    assert.strictEqual(fs.readFileSync(userHelper, 'utf8'), 'USER OWNED HELPER SENTINEL\n');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('Copilot rewrites Markdown commands while preserving binary skill assets and source bytes', () => {
  const fs = require('fs');
  const os = require('os');
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-assets-'));
  try {
    const sourceRoot = path.join(temp, 'source');
    fs.mkdirSync(path.join(sourceRoot, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-modules.json'), JSON.stringify({ version: 1, modules: [{
      id: 'fixture', kind: 'skills', paths: ['skills/fixture'], targets: ['copilot'], dependencies: [],
    }] }));
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-profiles.json'), JSON.stringify({ version: 1, profiles: {} }));
    const skillRoot = path.join(sourceRoot, 'skills', 'fixture');
    fs.mkdirSync(skillRoot, { recursive: true });
    const original = 'Run `node scripts/setup-package-manager.js --detect`.\nhttps://example.org/scripts/setup-package-manager.js\n';
    const binary = Buffer.from([0, 255, 254, 128, 42]);
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), original);
    fs.writeFileSync(path.join(skillRoot, 'asset.png'), binary);
    const plan = createManifestInstallPlan({ sourceRoot, target: 'copilot', moduleIds: ['fixture'], projectRoot: path.join(temp, 'project'), homeDir: path.join(temp, 'home'), env: {} });
    applyInstallPlan(plan);
    const installed = path.join(plan.targetRoot, 'skills', 'fixture');
    assert.strictEqual(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), original.replace('node scripts/', 'node .github/ecc/scripts/'));
    assert.deepStrictEqual(fs.readFileSync(path.join(installed, 'asset.png')), binary);
    assert.strictEqual(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8'), original);
    assert.ok(!plan.operations.find(operation => operation.sourceRelativePath.endsWith('asset.png')).contentTransform);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Copilot installs non-Markdown agent assets byte-for-byte while adapting Markdown agents', () => {
  const fs = require('fs');
  const os = require('os');
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-agent-assets-'));
  try {
    const sourceRoot = path.join(temp, 'source');
    fs.mkdirSync(path.join(sourceRoot, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-modules.json'), JSON.stringify({ version: 1, modules: [{
      id: 'fixture', kind: 'agents', paths: ['agents'], targets: ['copilot'], dependencies: [],
    }] }));
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-profiles.json'), JSON.stringify({ version: 1, profiles: {} }));
    const agentRoot = path.join(sourceRoot, 'agents');
    fs.mkdirSync(path.join(agentRoot, 'assets'), { recursive: true });
    const binary = Buffer.from([0, 255, 254, 128, 42]);
    const helper = 'Run node scripts/setup-package-manager.js --detect\n';
    fs.writeFileSync(path.join(agentRoot, 'assets', 'icon.png'), binary);
    fs.writeFileSync(path.join(agentRoot, 'assets', 'helper.txt'), helper);
    fs.writeFileSync(path.join(agentRoot, 'architect.MD'), CLAUDE_AGENT);
    const plan = createManifestInstallPlan({ sourceRoot, target: 'copilot', moduleIds: ['fixture'], projectRoot: path.join(temp, 'project'), homeDir: path.join(temp, 'home'), env: {} });
    applyInstallPlan(plan);
    const installed = path.join(plan.targetRoot, 'agents');
    assert.deepStrictEqual(fs.readFileSync(path.join(installed, 'assets', 'icon.png')), binary);
    assert.strictEqual(fs.readFileSync(path.join(installed, 'assets', 'helper.txt'), 'utf8'), helper);
    assert.strictEqual(fs.readFileSync(path.join(installed, 'architect.MD'), 'utf8'), adaptCopilotAgent(CLAUDE_AGENT, 'agents/architect.MD'));
    for (const operation of plan.operations.filter(operation => operation.sourceRelativePath.includes('/assets/'))) {
      assert.ok(!operation.contentTransform, operation.sourceRelativePath);
    }
    assert.strictEqual(fs.readFileSync(path.join(agentRoot, 'architect.MD'), 'utf8'), CLAUDE_AGENT);
    assert.deepStrictEqual(fs.readFileSync(path.join(agentRoot, 'assets', 'icon.png')), binary);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
