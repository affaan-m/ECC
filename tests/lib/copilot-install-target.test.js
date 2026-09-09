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

test('skills are planned into .github/skills without a transform', () => {
  const operations = planFor([{ id: 'workflow-quality', paths: ['skills/tdd-workflow'] }]);
  assert.strictEqual(operations.length, 1);
  assert.strictEqual(operations[0].contentTransform, undefined);
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

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
