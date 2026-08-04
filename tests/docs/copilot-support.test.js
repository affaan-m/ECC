'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const promptDir = path.join(repoRoot, '.github', 'prompts');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function parseSimpleFrontmatter(source, relativePath) {
  const normalizedSource = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalizedSource.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${relativePath} must start with YAML frontmatter`);

  const fields = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    assert.ok(field, `${relativePath} contains unsupported frontmatter line: ${line}`);
    fields[field[1]] = field[2];
  }

  return fields;
}

console.log('\n=== Testing GitHub Copilot support surface ===\n');

test('VS Code settings enable Copilot prompt files', () => {
  const settings = JSON.parse(read('.vscode/settings.json'));
  assert.strictEqual(settings['chat.promptFiles'], true);
  assert.ok(!Object.prototype.hasOwnProperty.call(settings, 'github.copilot.chat.reviewSelection.instructions'));
});

test('Copilot prompt files use current VS Code frontmatter', () => {
  const promptFiles = fs
    .readdirSync(promptDir)
    .filter(file => file.endsWith('.prompt.md'))
    .sort();

  assert.deepStrictEqual(promptFiles, ['build-fix.prompt.md', 'plan.prompt.md', 'refactor.prompt.md', 'security-review.prompt.md', 'tdd.prompt.md']);

  for (const file of promptFiles) {
    const relativePath = `.github/prompts/${file}`;
    const source = read(relativePath);
    const fields = parseSimpleFrontmatter(source, relativePath);

    assert.strictEqual(fields.agent, 'agent', `${relativePath} must use agent: agent`);
    assert.ok(fields.description, `${relativePath} must describe its purpose`);
    assert.ok(!Object.prototype.hasOwnProperty.call(fields, 'mode'), `${relativePath} must not use legacy mode frontmatter`);
  }
});

test('Copilot docs advertise slash prompt invocation instead of hash commands', () => {
  const sources = ['.github/copilot-instructions.md', 'README.md'].map(read).join('\n');

  for (const command of ['plan', 'tdd', 'security-review', 'build-fix', 'refactor']) {
    assert.ok(!sources.includes(`#${command}`), `Expected no stale #${command} command syntax`);
  }

  assert.ok(sources.includes('/plan'));
  assert.ok(sources.includes('/tdd'));
  assert.ok(sources.includes('/security-review'));
});

test('Copilot instructions include a prompt defense baseline', () => {
  const instructions = read('.github/copilot-instructions.md');
  assert.ok(instructions.includes('## Prompt Defense Baseline'));
  assert.ok(instructions.includes('untrusted input'));
  assert.ok(instructions.includes('Never print tokens'));
});

test('README documents prompt-file settings and surfaces', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('chat.promptFiles'));
  assert.ok(readme.includes('.github/prompts/'));
  assert.ok(readme.includes('.vscode/settings.json'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
