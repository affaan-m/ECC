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
const { adaptCopilotRule } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'copilot-rule'));
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

function planForRepo(modules) {
  return copilotAdapter.planOperations({
    repoRoot: REPO_ROOT,
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

test('rule transform converts paths frontmatter to applyTo', () => {
  const source = [
    '---',
    'paths:',
    '  - "**/*.component.ts"',
    '  - "**/*.service.ts"',
    '---',
    '',
    '# Angular Coding Style',
    '',
  ].join('\n');
  const adapted = adaptCopilotRule(source, 'rules/angular/coding-style.md');
  assert.match(adapted, /^---\n/);
  assert.match(adapted, /applyTo: ["']\*\*\/\*\.component\.ts,\*\*\/\*\.service\.ts["']\n/);
  assert.doesNotMatch(adapted, /^paths:/m);
  assert.ok(adapted.includes('# Angular Coding Style'));
});

test('rule transform makes a rule without frontmatter global', () => {
  const adapted = adaptCopilotRule('# Security\n\nAlways validate input.\n', 'rules/common/security.md');
  assert.match(adapted, /^---\napplyTo: ["']\*\*["']\n---\n/);
  assert.ok(adapted.endsWith('# Security\n\nAlways validate input.\n'));
});

test('rule transform makes a rule without paths global', () => {
  const adapted = adaptCopilotRule('---\ndescription: General guidance\n---\nbody\n', 'rules/common/other.md');
  assert.match(adapted, /^---\napplyTo: ["']\*\*["']\n---\nbody\n/);
});

test('rule transform rejects frontmatter that is not an object', () => {
  assert.throws(
    () => adaptCopilotRule('---\n- a\n- b\n---\nbody\n', 'rules/broken.md'),
    /frontmatter must be an object/
  );
});

test('rule transform rejects a non-list paths value', () => {
  assert.throws(
    () => adaptCopilotRule('---\npaths: not-a-list\n---\nbody\n', 'rules/broken.md'),
    /"paths" must be a non-empty list of glob strings/
  );
});

test('rule transform rejects an empty paths list', () => {
  assert.throws(
    () => adaptCopilotRule('---\npaths: []\n---\nbody\n', 'rules/broken.md'),
    /"paths" must be a non-empty list of glob strings/
  );
});

test('rule transform treats an immediately empty frontmatter block as global', () => {
  const adapted = adaptCopilotRule('---\n---\n# Rule\n', 'rules/common/x.md');
  assert.match(adapted, /^---\napplyTo: ["']\*\*["']\n---\n# Rule\n/);
  assert.strictEqual(adapted.match(/^---$/gm).length, 2, 'must not leave stray delimiters in the body');
});

test('rule transform treats a whitespace-only frontmatter block as global', () => {
  const adapted = adaptCopilotRule('---\n\n---\n# Rule\n', 'rules/common/x.md');
  assert.match(adapted, /^---\napplyTo: ["']\*\*["']\n---\n# Rule\n/);
  assert.strictEqual(adapted.match(/^---$/gm).length, 2, 'must not leave stray delimiters in the body');
});

test('rule transform rewrites links to installed rule files', () => {
  const source = '---\npaths:\n  - "**/*.ts"\n---\nSee [common](../common/coding-style.md) and [anchor](../common/hooks.md#hooks).\n';
  const adapted = adaptCopilotRule(source, 'rules/angular/coding-style.md');
  assert.ok(adapted.includes('](../common/coding-style.instructions.md)'));
  assert.ok(adapted.includes('](../common/hooks.instructions.md#hooks)'));
});

test('rule transform leaves links outside the installed rule set unchanged', () => {
  const source = '---\npaths:\n  - "**/*.ts"\n---\n[docs](../../docs/guide.md) [readme](../README.md) [web](https://example.org/x.md) [self](#section) [abs](/rules/x.md)\n';
  const adapted = adaptCopilotRule(source, 'rules/angular/coding-style.md');
  assert.ok(adapted.includes('](../../docs/guide.md)'));
  assert.ok(adapted.includes('](../README.md)'));
  assert.ok(adapted.includes('(https://example.org/x.md)'));
  assert.ok(adapted.includes('(#section)'));
  assert.ok(adapted.includes('(/rules/x.md)'));
});

test('rule transform keeps fenced code examples unchanged', () => {
  const source = '---\npaths:\n  - "**/*.ts"\n---\nOutside [link](../common/hooks.md).\n\n```md\n[example](../common/coding-style.md)\n```\n~~~\n[tildes](../common/patterns.md)\n~~~\n';
  const adapted = adaptCopilotRule(source, 'rules/angular/coding-style.md');
  assert.ok(adapted.includes('](../common/hooks.instructions.md)'));
  assert.ok(adapted.includes('```md\n[example](../common/coding-style.md)\n```'));
  assert.ok(adapted.includes('~~~\n[tildes](../common/patterns.md)\n~~~'));
});

test('rules are planned into .github/instructions/ecc as renamed instructions files', () => {
  const operations = planForRepo([{ id: 'rules-core', paths: ['rules'] }]);
  assert.ok(operations.length > 100);
  const root = path.join('/project', '.github', 'instructions', 'ecc');
  for (const operation of operations) {
    assert.strictEqual(operation.contentTransform, 'copilot-rule-frontmatter');
    assert.ok(operation.destinationPath.endsWith('.instructions.md'), operation.destinationPath);
    const relative = path.relative(root, operation.destinationPath);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), operation.destinationPath);
    assert.ok(!/(^|[\\/])README\.instructions\.md$/i.test(operation.destinationPath), operation.destinationPath);
  }
  assert.ok(operations.some(operation => (
    operation.destinationPath === path.join(root, 'angular', 'coding-style.instructions.md')
    && operation.sourceRelativePath === 'rules/angular/coding-style.md'
  )));
});

test('a rules subdirectory keeps its namespace under instructions/ecc', () => {
  const operations = planForRepo([{ id: 'rules-core', paths: ['rules/angular'] }]);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    const relative = path.relative(path.join('/project', '.github', 'instructions', 'ecc', 'angular'), operation.destinationPath);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), operation.destinationPath);
  }
});

test('single rule files retain language namespaces and distinct managed destinations', () => {
  const operations = planForRepo([{ id: 'rules-core', paths: [
    'rules/angular/coding-style.md', 'rules/typescript/coding-style.md'
  ] }]);
  assert.strictEqual(operations.length, 2);
  assert.deepStrictEqual(operations.map(operation => operation.destinationPath), [
    path.join('/project', '.github', 'instructions', 'ecc', 'angular', 'coding-style.instructions.md'),
    path.join('/project', '.github', 'instructions', 'ecc', 'typescript', 'coding-style.instructions.md')
  ]);
});

test('rule transform preserves longer fences and embedded alternate fence markers', () => {
  const body = '````md\n```\n[example](../common/hooks.md)\n~~~\n````\nOutside [link](../common/hooks.md).\n';
  const adapted = adaptCopilotRule(body, 'rules/angular/coding-style.md');
  assert.ok(adapted.includes('````md\n```\n[example](../common/hooks.md)\n~~~\n````'));
  assert.ok(adapted.includes('Outside [link](../common/hooks.instructions.md).'));
});

test('rule transform preserves CRLF fenced examples and rewrites only prose links', () => {
  const body = '````md\r\n```\r\n[example](../common/hooks.md)\r\n~~~\r\n````\r\nOutside [link](../common/hooks.md).\r\n';
  const adapted = adaptCopilotRule(`---\r\npaths:\r\n  - "**/*.ts"\r\n---\r\n${body}`, 'rules/angular/coding-style.md');
  assert.ok(adapted.includes('````md\r\n```\r\n[example](../common/hooks.md)\r\n~~~\r\n````'));
  assert.ok(adapted.includes('Outside [link](../common/hooks.instructions.md).\r\n'));
});

test('unsupported source paths produce no operations', () => {
  const operations = planFor([
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
  for (const value of ['agents/../../escape.md', 'skills/../escape.md', 'rules/../../escape.md', 'agents\\..\\..\\escape.md']) {
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
    assert.match(skill, /This Copilot projection runs the detector from the managed \.github\/ecc\/scripts\/ closure/);
    assert.doesNotMatch(skill, /The resolution lines (?:locate|use)/, 'installed prose must describe the projected command');
    const command = skill.match(/node (\S*setup-package-manager\.js) --detect/);
    assert.ok(command, 'installed skill must give an executable detection command');
    assert.strictEqual(command[1], '.github/ecc/scripts/setup-package-manager.js');
    for (const helper of ['package-manager', 'utils', 'agent-data-home', 'path-safety']) {
      assert.ok(fs.existsSync(path.join(project, '.github', 'ecc', 'scripts', 'lib', `${helper}.js`)), helper);
    }
    const detected = spawnSync(process.execPath, [command[1], '--detect'], { cwd: project, env, encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(detected.status, 0, detected.stderr);
    assert.match(detected.stdout, /pnpm/);
    if (process.platform !== 'win32') {
      const detectorBlock = [...skill.matchAll(/```bash\r?\n([\s\S]*?)```/g)]
        .map(match => match[1]).find(block => block.includes('setup-package-manager.js'));
      assert.ok(detectorBlock, 'installed skill must retain its executable Bash example');
      assert.doesNotMatch(detectorBlock, /ECC_ROOT|CLAUDE_PLUGIN_ROOT/,
        'Copilot must use its managed project helper instead of a Claude resolver');
      const actualRecipe = spawnSync('bash', ['-c', detectorBlock], {
        cwd: project, encoding: 'utf8', timeout: 15000,
        env: { ...env, HOME: homeDir, USERPROFILE: homeDir,
          CLAUDE_PLUGIN_ROOT: path.join(project, 'wrong-plugin'), CLAUDE_CONFIG_DIR: path.join(project, 'wrong-config') }
      });
      assert.ifError(actualRecipe.error);
      assert.strictEqual(actualRecipe.status, 0, actualRecipe.stderr);
      assert.match(actualRecipe.stdout, /pnpm/);
    }

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

test('Copilot preserves unrelated workflow shell steps around a detector call', () => {
  const { transformInstallContent } = require('../../scripts/lib/install/content-transform');
  const content = [
    '```bash', 'ECC_ROOT="/custom/tool"', 'printf before',
    'node "$ECC_ROOT/scripts/setup-package-manager.js" --detect',
    'printf after', '```', ''
  ].join('\n');
  const actual = transformInstallContent({
    contentTransform: 'copilot-workflow-paths', sourceRelativePath: 'skills/fixture/SKILL.md'
  }, content);
  assert.strictEqual(actual, content, 'only the canonical TDD detector block may be replaced');
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

test('Copilot installs rules as instructions and uninstall removes them', () => {
  const fs = require('fs');
  const os = require('os');
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-rules-'));
  try {
    const homeDir = path.join(project, 'home');
    const plan = createManifestInstallPlan({ target: 'copilot', moduleIds: ['rules-core'], projectRoot: project, homeDir, env: {} });
    applyInstallPlan(plan);
    const instructionsRoot = path.join(project, '.github', 'instructions', 'ecc');
    const angular = fs.readFileSync(path.join(instructionsRoot, 'angular', 'coding-style.instructions.md'), 'utf8');
    assert.match(angular, /^---\napplyTo: ["']\*\*\/\*\.component\.ts/);
    assert.doesNotMatch(angular, /^paths:/m);
    assert.ok(angular.includes('](../common/coding-style.instructions.md)'));
    assert.ok(!angular.includes('](../common/coding-style.md)'));
    const security = fs.readFileSync(path.join(instructionsRoot, 'common', 'security.instructions.md'), 'utf8');
    assert.match(security, /^---\napplyTo: ["']\*\*["']\n---\n/);
    assert.ok(!fs.existsSync(path.join(instructionsRoot, 'README.instructions.md')));
    const options = { repoRoot: REPO_ROOT, projectRoot: project, homeDir, targets: ['copilot'], env: {} };
    const uninstall = uninstallInstalledStates(options);
    assert.strictEqual(uninstall.summary.errorCount, 0, JSON.stringify(uninstall));
    assert.ok(!fs.existsSync(path.join(instructionsRoot, 'angular', 'coding-style.instructions.md')));
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('single-file rules survive install and repair without colliding or claiming user instructions', () => {
  const fs = require('fs');
  const os = require('os');
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-rule-files-'));
  try {
    const sourceRoot = path.join(temp, 'source');
    const projectRoot = path.join(temp, 'project');
    const homeDir = path.join(temp, 'home');
    const languages = ['angular', 'typescript', 'python'];
    fs.mkdirSync(path.join(sourceRoot, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-modules.json'), JSON.stringify({ version: 1, modules: [{
      id: 'fixture', kind: 'rules', paths: languages.map(language => `rules/${language}/coding-style.md`),
      targets: ['copilot'], dependencies: [],
    }] }));
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-profiles.json'), JSON.stringify({ version: 1, profiles: {} }));
    for (const language of languages) {
      const file = path.join(sourceRoot, 'rules', language, 'coding-style.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# ${language}\n`);
    }
    const instruction = language => path.join(projectRoot, '.github', 'instructions', 'ecc', language, 'coding-style.instructions.md');
    fs.mkdirSync(path.dirname(instruction('python')), { recursive: true });
    fs.writeFileSync(instruction('python'), 'USER INSTRUCTION\n');
    const plan = createManifestInstallPlan({ sourceRoot, target: 'copilot', moduleIds: ['fixture'], projectRoot, homeDir, env: {} });
    applyInstallPlan(plan);
    const options = { repoRoot: sourceRoot, projectRoot, homeDir, targets: ['copilot'], env: {} };
    fs.unlinkSync(instruction('typescript'));
    const repair = repairInstalledStates(options);
    assert.strictEqual(repair.summary.errorCount, 0, JSON.stringify(repair));
    for (const language of ['angular', 'typescript']) {
      assert.strictEqual(fs.readFileSync(instruction(language), 'utf8'), `---\napplyTo: "**"\n---\n# ${language}\n`);
    }
    assert.strictEqual(fs.readFileSync(instruction('python'), 'utf8'), 'USER INSTRUCTION\n');
    const uninstall = uninstallInstalledStates(options);
    assert.strictEqual(uninstall.summary.errorCount, 0, JSON.stringify(uninstall));
    assert.ok(!fs.existsSync(instruction('angular')));
    assert.ok(!fs.existsSync(instruction('typescript')));
    assert.strictEqual(fs.readFileSync(instruction('python'), 'utf8'), 'USER INSTRUCTION\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
