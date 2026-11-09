'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { adaptCopilotAgent, projectCopilotTools } = require('../../scripts/lib/install/copilot-agent');
let failed = 0;
function test(name, fn) { try { fn(); console.log(`✓ ${name}`); } catch (error) { failed++; console.error(`✗ ${name}: ${error.message}`); } }
function source(tools, name = 'worker', extra = '') { return `---\nname: ${name}\ndescription: Test agent\n${tools}\n${extra}\n---\nBody must remain unchanged.\n`; }
function front(text) { return yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]); }
test('canonical aliases project to an explicit restricted list', () => {
  const result = front(adaptCopilotAgent(source('tools: Read, Write, Edit, Bash, Grep, Glob, Task, WebFetch, TodoWrite')));
  assert.deepStrictEqual(result.tools, ['read', 'edit', 'execute', 'search', 'agent', 'web', 'todo']);
});
test('empty tools remain no tools and missing tools fail closed', () => {
  assert.deepStrictEqual(front(adaptCopilotAgent(source('tools: []'))).tools, []);
  const result = adaptCopilotAgent(source(''));
  assert.deepStrictEqual(front(result).tools, []);
  assert.match(result, /incompatible.*missing tools/i);
});
test('unknown MCP tool cannot silently disappear from a partial list', () => {
  const result = adaptCopilotAgent(source('tools: Read, mcp__unknown__write'));
  assert.deepStrictEqual(front(result).tools, []);
  assert.match(result, /incompatible.*unmapped tools/i);
  assert.doesNotMatch(result, /^model:/m);
});
test('wildcards and parameterized shell permissions fail closed', () => {
  for (const value of ['["*"]', '["Bash(git status)"]', '["server/*"]']) {
    assert.deepStrictEqual(front(adaptCopilotAgent(source(`tools: ${value}`))).tools, []);
  }
});
test('reviewer cannot edit through shell or delegation', () => {
  const output = adaptCopilotAgent(source('tools: Read, Grep, Bash, Edit, Task', 'code-reviewer'));
  assert.deepStrictEqual(front(output).tools, ['read', 'search']);
  assert.match(output, /read-only projection/);
});
test('malformed tool declarations fail closed without inspecting arbitrary objects', () => {
  for (const value of ['null', '[Read, 4]', '{Read: true}', '"Read,,Edit"']) {
    assert.deepStrictEqual(front(adaptCopilotAgent(source(`tools: ${value}`))).tools, []);
  }
});
test('unknown frontmatter and Claude models are removed and body retained verbatim', () => {
  const output = adaptCopilotAgent(source('tools: [Read]', 'worker', 'model: opus\nunknown-privilege: true'));
  assert.deepStrictEqual(Object.keys(front(output)), ['name', 'description', 'tools', 'strict-tools-list']);
  assert.strictEqual(front(output)['strict-tools-list'], true);
  assert.ok(output.endsWith('Body must remain unchanged.\n'));
});
test('model override requires an operator supplied verified model set', () => {
  const input = source('tools: [Read]');
  assert.throws(() => adaptCopilotAgent(input, 'worker', { model: 'test-model' }), /verified/);
  assert.strictEqual(front(adaptCopilotAgent(input, 'worker', { model: 'test-model', verifiedModels: ['test-model'] })).model, 'test-model');
});
test('all canonical agents retain explicit tools with visible incompatibilities', () => {
  for (const file of fs.readdirSync(path.resolve(__dirname, '../../agents')).filter(file => file.endsWith('.md'))) {
    const text = fs.readFileSync(path.resolve(__dirname, '../../agents', file), 'utf8');
    const output = adaptCopilotAgent(text, `agents/${file}`);
    assert.ok(Array.isArray(front(output).tools), file);
    assert.ok(!front(output).tools.includes('*'), file);
  }
});
test('projection status separates policy narrowing from incompatibility', () => {
  assert.strictEqual(projectCopilotTools('Read, Grep', 'worker').status, 'mapped');
  assert.strictEqual(projectCopilotTools('Read, Bash', 'security-reviewer').status, 'restricted');
  assert.strictEqual(projectCopilotTools('Read, Unknown', 'worker').status, 'incompatible');
});
process.exitCode = failed ? 1 : 0;
