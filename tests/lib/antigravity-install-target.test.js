/**
 * Contract tests for the Antigravity install target and agent frontmatter transform.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { adaptAntigravityAgent } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install', 'antigravity-agent'));
const antigravityAdapter = require(path.join(REPO_ROOT, 'scripts', 'lib', 'install-targets', 'antigravity-project'));
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
  'name: code-simplifier',
  'description: Refactoring and simplification specialist.',
  'tools: Read, ReadFile, NotebookRead, Edit, MultiEdit, Write, Grep, Glob, Bash, WebSearch, WebFetch, Task',
  'model: opus',
  'color: teal',
  '---',
  '',
  '## Role',
  '',
  'You simplify complex code.',
  '',
].join('\n');

function planFor(modules) {
  return antigravityAdapter.planOperations({
    repoRoot: '/repo',
    projectRoot: '/project',
    homeDir: '/home/user',
    modules,
  });
}

console.log('=== Testing Antigravity install target ===\n');

test('registry resolves the antigravity target and adapter id', () => {
  assert.strictEqual(getInstallTargetAdapter('antigravity').id, 'antigravity-project');
  assert.strictEqual(getInstallTargetAdapter('antigravity-project').id, 'antigravity-project');
  assert.strictEqual(antigravityAdapter.target, 'antigravity');
  assert.strictEqual(antigravityAdapter.kind, 'project');
});

test('antigravity is a supported install target', () => {
  assert.ok(SUPPORTED_INSTALL_TARGETS.includes('antigravity'));
});

test('transform maps Claude tools (including MultiEdit/ReadFile/NotebookRead), maps model tiers, and strips color', () => {
  const yaml = require('js-yaml');
  const adapted = adaptAntigravityAgent(CLAUDE_AGENT, 'agents/code-simplifier.md');
  const match = adapted.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'Expected YAML frontmatter');
  const parsed = yaml.load(match[1]);

  assert.strictEqual(parsed.name, 'code-simplifier');
  assert.strictEqual(parsed.description, 'Refactoring and simplification specialist.');
  assert.strictEqual(parsed.model, 'pro');
  assert.strictEqual(Object.hasOwn(parsed, 'color'), false);
  assert.deepStrictEqual(parsed.tools, [
    'read_file',
    'edit_file',
    'write_file',
    'grep_search',
    'find_by_name',
    'run_command',
    'search_web',
    'read_url_content',
    'invoke_subagent',
  ]);
  assert.ok(adapted.includes('## Role'));
  assert.ok(adapted.includes('You simplify complex code.'));
});

test('transform parses quoted tool scalars and maps haiku to flash', () => {
  const yaml = require('js-yaml');
  const source = [
    '---',
    'name: fast-helper',
    'description: Quick lookup agent',
    'tools: \'"Read", "MultiEdit"\'',
    'model: haiku',
    '---',
    '',
    'Body',
    '',
  ].join('\n');
  const adapted = adaptAntigravityAgent(source, 'agents/fast-helper.md');
  const parsed = yaml.load(adapted.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.strictEqual(parsed.model, 'flash');
  assert.deepStrictEqual(parsed.tools, ['read_file', 'edit_file']);
});

test('search-only agent receives search tools without shell access (run_command)', () => {
  const yaml = require('js-yaml');
  const source = [
    '---',
    'name: read-only-reviewer',
    'description: Review without shell',
    'tools: Read, Grep, Glob',
    'model: sonnet',
    '---',
    '',
    'Review only.',
  ].join('\n');
  const adapted = adaptAntigravityAgent(source, 'agents/read-only-reviewer.md');
  const parsed = yaml.load(adapted.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.deepStrictEqual(parsed.tools, ['read_file', 'grep_search', 'find_by_name']);
  assert.strictEqual(parsed.tools.includes('run_command'), false);
});

test('pinned native loader receipt establishes distinct editor and CLI capability boundaries', () => {
  const yaml = require('js-yaml');
  const allClaudeTools = 'Read, ReadFile, NotebookRead, Write, Edit, MultiEdit, Grep, Glob, Bash, WebSearch, WebFetch, Task';
  const source = [
    '---',
    'name: full-agent',
    'description: Agent with all tools',
    `tools: ${allClaudeTools}`,
    'model: opus',
    '---',
    '',
    'Full agent body',
  ].join('\n');

  // CLI / Antigravity 2.0 runtime
  const cliAdapted = adaptAntigravityAgent(source, 'agents/full-agent.md', { runtime: 'cli' });
  const cliParsed = yaml.load(cliAdapted.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.deepStrictEqual(cliParsed.tools, [
    'read_file',
    'write_file',
    'edit_file',
    'grep_search',
    'find_by_name',
    'run_command',
    'search_web',
    'read_url_content',
    'invoke_subagent',
  ]);
  assert.ok(cliParsed.tools.includes('invoke_subagent'), 'CLI runtime must support invoke_subagent');

  // Editor-only runtime
  const editorAdapted = adaptAntigravityAgent(source, 'agents/full-agent.md', { runtime: 'editor' });
  const editorParsed = yaml.load(editorAdapted.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.deepStrictEqual(editorParsed.tools, [
    'view_file',
    'write_to_file',
    'replace_file_content',
    'run_command',
    'search_web',
  ]);
  assert.strictEqual(editorParsed.tools.includes('invoke_subagent'), false, 'Editor runtime must exclude invoke_subagent');
});

test('transform preserves CRLF line endings consistently on Windows-saved agents', () => {
  const crlfSource = [
    '---',
    'name: windows-agent',
    'description: Windows line endings',
    'tools: Read, MultiEdit',
    'model: sonnet',
    'color: purple',
    '---',
    '',
    'Body line 1',
    'Body line 2',
  ].join('\r\n');

  const adapted = adaptAntigravityAgent(crlfSource, 'agents/windows-agent.md');
  assert.ok(adapted.includes('\r\n'), 'Expected CRLF line endings to be preserved');
  assert.ok(!/[^\r]\n/.test(adapted), 'Expected no mixed bare LF line endings in CRLF output');
  assert.ok(!adapted.includes('color:'));
  assert.ok(adapted.includes('edit_file'));
});

test('transform preserves mixed body line endings verbatim without rewriting body LFs', () => {
  const mixedBody = '\nFirst LF line\nPasted CRLF line\r\nFinal LF line\n';
  const source = `---\nname: mixed-agent\ndescription: Mixed body\ntools: Read\ncolor: teal\n---\n${mixedBody}`;
  const adapted = adaptAntigravityAgent(source, 'agents/mixed-agent.md');
  assert.ok(adapted.endsWith(`---\n${mixedBody}`), 'Expected mixed body line endings to remain verbatim');
});

test('transform rejects missing or non-object frontmatter', () => {
  assert.throws(
    () => adaptAntigravityAgent('# no frontmatter\n', 'agents/broken.md'),
    /missing YAML frontmatter/
  );
  assert.throws(
    () => adaptAntigravityAgent('---\n- item\n---\nbody\n', 'agents/broken.md'),
    /frontmatter must be an object/
  );
});

test('traversal segments produce no planned operations', () => {
  for (const value of [
    'agents/../../escape.md',
    'skills/../escape.md',
    'commands/../../escape.md',
    'rules/../../escape.md',
    'agents\\..\\..\\escape.md',
  ]) {
    assert.deepStrictEqual(planFor([{ id: 'agents-core', paths: [value] }]), []);
  }
});

test('every planned operation is contained within .agents', () => {
  const operations = planFor([
    { id: 'agents-core', paths: ['agents', '.agents', 'AGENTS.md'] },
    { id: 'commands-core', paths: ['commands'] },
    { id: 'framework-language', paths: ['skills/api-design'] },
    { id: 'hooks-core', paths: ['hooks'] },
  ]);
  const root = path.join('/project', '.agents');
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    const relative = path.relative(root, operation.destinationPath);
    assert.ok(
      relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      `operation escapes .agents: ${operation.destinationPath}`
    );
  }
});

test('plans hook operation copying antigravity-hooks.json to .agents/hooks.json', () => {
  const operations = planFor([
    { id: 'hooks-core', paths: ['hooks'] },
  ]);
  assert.strictEqual(operations.length, 1);
  assert.strictEqual(operations[0].destinationPath, path.join('/project', '.agents', 'hooks.json'));
  assert.strictEqual(operations[0].strategy, 'copy-file');
});

test('plans hook-bridge and runtime helpers when hooks-runtime is selected', () => {
  const operations = planFor([
    {
      id: 'hooks-runtime',
      paths: ['hooks', 'scripts/hooks', 'scripts/lib'],
    },
  ]);
  assert.strictEqual(operations.length, 4);
  const destPaths = operations.map(op => op.destinationPath);
  assert.ok(destPaths.includes(path.join('/project', '.agents', 'hooks.json')));
  assert.ok(destPaths.includes(path.join('/project', '.agents', 'scripts', 'antigravity', 'hook-bridge.js')));
  assert.ok(destPaths.includes(path.join('/project', '.agents', 'scripts', 'hooks')));
  assert.ok(destPaths.includes(path.join('/project', '.agents', 'scripts', 'lib')));
});

test('Antigravity installs non-Markdown agent assets byte-for-byte while adapting Markdown agents', () => {
  const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-antigravity-agent-assets-'));
  try {
    const sourceRoot = path.join(temp, 'source');
    fs.mkdirSync(path.join(sourceRoot, 'manifests'), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-modules.json'), JSON.stringify({
      version: 1,
      modules: [{
        id: 'fixture',
        kind: 'agents',
        paths: ['agents'],
        targets: ['antigravity'],
        dependencies: [],
      }],
    }));
    fs.writeFileSync(path.join(sourceRoot, 'manifests', 'install-profiles.json'), JSON.stringify({
      version: 1,
      profiles: {},
    }));
    const agentRoot = path.join(sourceRoot, 'agents');
    fs.mkdirSync(path.join(agentRoot, 'assets'), { recursive: true });
    const binary = Buffer.from([0, 255, 254, 128, 42]);
    const helper = '# helper text without YAML frontmatter\n';
    fs.writeFileSync(path.join(agentRoot, 'assets', 'icon.png'), binary);
    fs.writeFileSync(path.join(agentRoot, 'assets', 'helper.txt'), helper);
    fs.writeFileSync(path.join(agentRoot, 'code-simplifier.MD'), CLAUDE_AGENT);

    const plan = createManifestInstallPlan({
      sourceRoot,
      target: 'antigravity',
      moduleIds: ['fixture'],
      projectRoot: path.join(temp, 'project'),
      homeDir: path.join(temp, 'home'),
      env: {},
    });
    applyInstallPlan(plan);

    const installed = path.join(plan.targetRoot, 'agents');
    assert.deepStrictEqual(fs.readFileSync(path.join(installed, 'assets', 'icon.png')), binary);
    assert.strictEqual(fs.readFileSync(path.join(installed, 'assets', 'helper.txt'), 'utf8'), helper);
    assert.strictEqual(
      fs.readFileSync(path.join(installed, 'code-simplifier.MD'), 'utf8'),
      adaptAntigravityAgent(CLAUDE_AGENT, 'agents/code-simplifier.MD')
    );
    for (const operation of plan.operations.filter(op => op.sourceRelativePath.replace(/\\/g, '/').includes('/assets/'))) {
      assert.ok(!operation.contentTransform, operation.sourceRelativePath);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);

