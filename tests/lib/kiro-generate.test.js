/**
 * Tests for scripts/lib/kiro/generate.js — the Kiro adapter generator.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let yaml = null;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const {
  generateKiroAdapter,
  mapAgentTools,
  serializeFrontmatter,
} = require('../../scripts/lib/kiro/generate');

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

function makeFakeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-gen-'));

  // agents/
  fs.mkdirSync(path.join(repoRoot, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews code.\ntools: ["Read", "Grep", "Bash"]\nmodel: opus\n---\n\nYou are a reviewer.\n'
  );

  // skills/
  fs.mkdirSync(path.join(repoRoot, 'skills', 'tdd-workflow'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'skills', 'tdd-workflow', 'SKILL.md'),
    '---\nname: tdd-workflow\ndescription: TDD.\n---\n\n# TDD\n'
  );
  // a directory without SKILL.md should be ignored
  fs.mkdirSync(path.join(repoRoot, 'skills', 'not-a-skill'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'skills', 'not-a-skill', 'notes.md'), 'x\n');

  // rules/
  fs.mkdirSync(path.join(repoRoot, 'rules', 'common'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'rules', 'common', 'coding-style.md'), '# Coding Style\n\nBe consistent.\n');
  fs.mkdirSync(path.join(repoRoot, 'rules', 'python'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'rules', 'python', 'patterns.md'), '# Python\n\nUse type hints.\n');
  fs.writeFileSync(path.join(repoRoot, 'rules', 'README.md'), '# Rules index\n');

  // mcp-configs/
  fs.mkdirSync(path.join(repoRoot, 'mcp-configs'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'mcp-configs', 'mcp-servers.json'),
    JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', 'srv'] } } }, null, 2)
  );

  // pre-existing curated hooks
  fs.mkdirSync(path.join(repoRoot, '.kiro', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.kiro', 'hooks', 'quality-gate.kiro.hook'),
    JSON.stringify({
      version: '1.0.0',
      enabled: true,
      name: 'quality-gate',
      description: 'Run quality gate',
      when: { type: 'userTriggered' },
      then: { type: 'runCommand', command: 'echo ok' },
    }, null, 2)
  );

  return repoRoot;
}

function runTests() {
  console.log('\n=== Testing Kiro adapter generator ===\n');
  let passed = 0;
  let failed = 0;

  if (test('mapAgentTools maps read/write/bash tools to Kiro allowedTools', () => {
    assert.deepStrictEqual(mapAgentTools(['Read', 'Grep']), ['fs_read']);
    assert.deepStrictEqual(mapAgentTools(['Read', 'Write']).sort(), ['fs_read', 'fs_write']);
    assert.deepStrictEqual(mapAgentTools(['Bash']), ['execute_bash']);
    assert.deepStrictEqual(mapAgentTools([]), ['fs_read']);
  })) passed++; else failed++;

  if (test('serializeFrontmatter quotes glob patterns so YAML does not treat them as aliases', () => {
    const block = serializeFrontmatter({ inclusion: 'fileMatch', fileMatchPattern: '*.py' });
    assert.ok(block.includes('fileMatchPattern: "*.py"'), 'glob must be quoted');
    if (yaml) {
      const parsed = yaml.load(block.replace(/^---\n/, '').replace(/\n---$/, ''));
      assert.strictEqual(parsed.fileMatchPattern, '*.py');
    }
  })) passed++; else failed++;

  if (test('generateKiroAdapter produces agents, skills, steering, and mcp from canonical sources', () => {
    const repoRoot = makeFakeRepo();
    try {
      const summary = generateKiroAdapter({ repoRoot });
      assert.strictEqual(summary.agents, 1, 'one agent generated');
      assert.strictEqual(summary.skills, 1, 'only the dir with SKILL.md is a skill');
      assert.strictEqual(summary.steering, 2, 'two steering files (README skipped)');
      assert.strictEqual(summary.mcpServers, 1, 'one mcp server in the example');
      assert.strictEqual(summary.hooks.count, 1, 'curated hook is validated');
      assert.deepStrictEqual(summary.hooks.errors, [], 'no hook errors');

      const kiroRoot = path.join(repoRoot, '.kiro');
      // agent: both md and json exist; json has Kiro shape
      assert.ok(fs.existsSync(path.join(kiroRoot, 'agents', 'reviewer.md')));
      const agentJson = JSON.parse(fs.readFileSync(path.join(kiroRoot, 'agents', 'reviewer.json'), 'utf8'));
      assert.strictEqual(agentJson.name, 'reviewer');
      assert.deepStrictEqual(agentJson.tools, ['@builtin']);
      assert.ok(agentJson.allowedTools.includes('fs_read'));
      assert.ok(agentJson.prompt.includes('You are a reviewer'));

      // skill copied
      assert.ok(fs.existsSync(path.join(kiroRoot, 'skills', 'tdd-workflow', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(kiroRoot, 'skills', 'not-a-skill')));

      // steering: common is auto, language is fileMatch
      const common = fs.readFileSync(path.join(kiroRoot, 'steering', 'coding-style.md'), 'utf8');
      assert.ok(common.includes('inclusion: "auto"'));
      const py = fs.readFileSync(path.join(kiroRoot, 'steering', 'python-patterns.md'), 'utf8');
      assert.ok(py.includes('inclusion: "fileMatch"'));
      assert.ok(py.includes('fileMatchPattern: "*.py"'));

      // mcp example
      const mcp = JSON.parse(fs.readFileSync(path.join(kiroRoot, 'settings', 'mcp.json.example'), 'utf8'));
      assert.ok(mcp.mcpServers.github, 'github server present');
      assert.deepStrictEqual(mcp.mcpServers.github.autoApprove, []);
      assert.strictEqual(mcp.mcpServers.github.disabled, false);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('generateKiroAdapter is idempotent (stable output across runs)', () => {
    const repoRoot = makeFakeRepo();
    try {
      generateKiroAdapter({ repoRoot });
      const first = fs.readFileSync(path.join(repoRoot, '.kiro', 'agents', 'reviewer.json'), 'utf8');
      generateKiroAdapter({ repoRoot });
      const second = fs.readFileSync(path.join(repoRoot, '.kiro', 'agents', 'reviewer.json'), 'utf8');
      assert.strictEqual(first, second, 'regeneration must be stable');
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
