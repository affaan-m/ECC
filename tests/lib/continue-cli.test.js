/**
 * Tests for scripts/lib/continue-cli.js (ECC -> Continue CLI converter).
 *
 * Run with: node tests/lib/continue-cli.test.js
 */

const assert = require('assert');
const path = require('path');
const yaml = require('js-yaml');
const lib = require('../../scripts/lib/continue-cli');

const repoRoot = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

console.log('continue-cli converter');

test('parseFrontmatter splits YAML and body', () => {
  const { data, body } = lib.parseFrontmatter('---\nname: x\ndescription: y\n---\n# Title\n');
  assert.deepStrictEqual(data, { name: 'x', description: 'y' });
  assert.strictEqual(body, '# Title\n');
});

test('parseFrontmatter tolerates documents without frontmatter', () => {
  const { data, body } = lib.parseFrontmatter('# Only body');
  assert.deepStrictEqual(data, {});
  assert.strictEqual(body, '# Only body');
});

test('buildRules emits always-apply rules and keeps language globs', () => {
  const rules = lib.buildRules(repoRoot, ['python']);
  const common = rules.filter(r => r.relPath.startsWith('common-'));
  const python = rules.filter(r => r.relPath.startsWith('python-'));
  assert.ok(common.length >= 5, 'common rules converted');
  assert.ok(python.length >= 5, 'python rules converted');
  for (const r of rules) {
    const { data } = lib.parseFrontmatter(r.content);
    assert.strictEqual(data.alwaysApply, true, `${r.relPath} must be always-apply (cn skips glob-only rules)`);
    assert.ok(data.name, `${r.relPath} has a name`);
  }
  const style = lib.parseFrontmatter(python.find(r => r.relPath === 'python-coding-style.md').content).data;
  assert.ok(Array.isArray(style.globs) && style.globs.includes('**/*.py'));
});

test('buildRules rejects unknown languages', () => {
  assert.throws(() => lib.buildRules(repoRoot, ['cobol']), /Unknown rule language/);
});

test('compat rule maps Claude tools to cn tools and points at the agents dir', () => {
  const { data, body } = lib.parseFrontmatter(lib.buildCompatRule({ agentsDir: '/x/agents' }));
  assert.strictEqual(data.alwaysApply, true);
  assert.ok(body.includes('| Grep | Search |'));
  assert.ok(body.includes('/x/agents/<agent-name>.md'));
});

test('resolveSkills honours manifest profiles and extras', () => {
  const core = lib.resolveSkills(repoRoot, 'core');
  const developer = lib.resolveSkills(repoRoot, 'developer');
  assert.ok(core.length > 10);
  assert.ok(developer.length > core.length);
  assert.ok(core.every(n => developer.includes(n)));
  assert.deepStrictEqual(lib.resolveSkills(repoRoot, 'none'), []);
  assert.deepStrictEqual(lib.resolveSkills(repoRoot, 'none', ['api-design']), ['api-design']);
  assert.throws(() => lib.resolveSkills(repoRoot, 'nope'), /Unknown skill profile/);
  assert.throws(() => lib.resolveSkills(repoRoot, 'none', ['does-not-exist']), /Unknown skill/);
});

test('every ECC skill is loadable by cn (name + description)', () => {
  const fs = require('fs');
  for (const name of lib.resolveSkills(repoRoot, 'all')) {
    const out = lib.convertSkill(name, fs.readFileSync(path.join(repoRoot, 'skills', name, 'SKILL.md'), 'utf8'));
    const { data } = lib.parseFrontmatter(out);
    assert.ok(typeof data.name === 'string' && data.name, `${name}: name`);
    assert.ok(typeof data.description === 'string' && data.description, `${name}: description`);
  }
});

test('convertSkill fills a missing name and rejects a missing description', () => {
  const out = lib.convertSkill('demo', '---\ndescription: Does things\n---\nBody');
  assert.strictEqual(lib.parseFrontmatter(out).data.name, 'demo');
  assert.throws(() => lib.convertSkill('demo', '---\nname: demo\n---\nBody'), /no description/);
});

test('convertCommand rewrites $ARGUMENTS and ends with the ARGUMENTS label', () => {
  const p = lib.convertCommand('tdd', '---\ndescription: Do TDD\n---\nWork on $ARGUMENTS now');
  assert.strictEqual(p.name, 'tdd');
  assert.strictEqual(p.description, 'Do TDD');
  assert.ok(!p.prompt.includes('$ARGUMENTS'));
  assert.ok(/ARGUMENTS \(text the user typed.*\): $/.test(p.prompt), 'cn appends args right after the prompt');
});

test('commands colliding with cn built-ins get an ecc- prefix', () => {
  assert.strictEqual(lib.convertCommand('sessions', 'x').name, 'ecc-sessions');
  assert.strictEqual(lib.convertCommand('plan', 'x').name, 'plan');
});

test('buildPrompts converts every command and context with unique names', () => {
  const prompts = lib.buildPrompts(repoRoot);
  const names = new Set(prompts.map(p => p.name));
  assert.strictEqual(names.size, prompts.length);
  assert.ok(names.has('plan') && names.has('code-review') && names.has('ctx-dev'));
  for (const p of prompts) assert.ok(!lib.CN_BUILTIN_COMMANDS.has(p.name), `${p.name} shadows a cn command`);
});

test('blockYaml produces a single-entry block cn can unroll', () => {
  const doc = yaml.load(lib.blockYaml('prompts', 'plan', { name: 'plan', description: 'd', prompt: 'p: "x"\n' }));
  assert.strictEqual(doc.schema, 'v1');
  assert.strictEqual(doc.prompts.length, 1);
  assert.strictEqual(doc.prompts[0].prompt, 'p: "x"\n');
});

test('mapTools never grants more authority than the source', () => {
  const r = lib.mapTools('Read, Grep, Glob, Task, WebSearch, mcp__x__y');
  assert.deepStrictEqual(r.tools, ['Read', 'Search', 'List']);
  assert.deepStrictEqual(r.unsupported, ['Task', 'WebSearch', 'mcp__x__y']);
});

test('convertAgent drops the hub-resolved model and maps tools', () => {
  const a = lib.convertAgent('rev', '---\nname: rev\ndescription: Reviews\ntools: Read, Grep\nmodel: sonnet\n---\nYou review.');
  const { data, body } = lib.parseFrontmatter(a.content);
  assert.strictEqual(data.model, undefined);
  assert.strictEqual(data.tools, 'Read, Search');
  assert.strictEqual(body.trim(), 'You review.');
});

test('buildSubagentModel keeps the system message short and points at the agent file', () => {
  const model = lib.parseModelSpec('anthropic/claude-x');
  const entry = lib.buildSubagentModel({ name: 'planner', description: 'Plans.' }, '/a/planner.md', model);
  assert.deepStrictEqual(entry.roles, ['subagent']);
  assert.strictEqual(entry.apiKey, '${{ secrets.ANTHROPIC_API_KEY }}');
  assert.ok(entry.chatOptions.baseSystemMessage.includes('/a/planner.md'));
  assert.ok(entry.chatOptions.baseSystemMessage.length < 600);
});

test('parseModelSpec validates and honours overrides', () => {
  const m = lib.parseModelSpec('openai:gpt-x', { apiKeySecret: 'K', apiBase: 'http://h/v1' });
  assert.deepStrictEqual(m, { provider: 'openai', model: 'gpt-x', apiKey: '${{ secrets.K }}', apiBase: 'http://h/v1' });
  assert.throws(() => lib.parseModelSpec('nomodel'), /provider\/model/);
});

test('convertMcpServer maps env to secrets and urls to remote transports', () => {
  const local = lib.convertMcpServer('gh', { command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'YOUR_TOKEN' } });
  assert.deepStrictEqual(local, { name: 'gh', command: 'npx', args: ['-y', 'x'], env: { TOKEN: '${{ secrets.TOKEN }}' } });
  assert.strictEqual(lib.convertMcpServer('r', { type: 'http', url: 'https://h/mcp' }).type, 'streamable-http');
  assert.strictEqual(lib.convertMcpServer('s', { url: 'https://h/sse' }).type, 'sse');
  assert.ok(lib.loadMcpServers(repoRoot).size > 5);
});

test('buildHooks routes every hook through the adapter with anchored matchers', () => {
  const hooks = lib.buildHooks('/ecc', 'strict');
  const groups = Object.values(hooks).flat();
  assert.strictEqual(groups.length, lib.CONTINUE_HOOKS.length);
  for (const g of groups) {
    assert.ok(g.hooks[0].command.includes('continue-hook-adapter.js'));
    assert.ok(g.hooks[0].command.includes('--profile strict'));
    if (g.matcher) assert.ok(g.matcher.startsWith('^') && g.matcher.endsWith('$'));
  }
});

test('mergeHookSettings replaces old ECC hooks and keeps user hooks', () => {
  const user = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
  const settings = { model: 'x', hooks: { PreToolUse: [user] } };
  const once = lib.mergeHookSettings(settings, lib.buildHooks('/ecc'));
  const twice = lib.mergeHookSettings(once, lib.buildHooks('/ecc'));
  assert.deepStrictEqual(once, twice, 'idempotent');
  assert.strictEqual(twice.model, 'x');
  assert.ok(twice.hooks.PreToolUse.includes(user) || twice.hooks.PreToolUse.some(g => g.hooks[0].command === 'echo mine'));
  const removed = lib.mergeHookSettings(twice, {});
  assert.deepStrictEqual(removed, settings);
});

test('mergePermissions adds and removes only ECC guardrails', () => {
  const user = 'allow:\n  - Read\nexclude:\n  - Bash(rm -rf*)\n';
  const added = yaml.load(lib.mergePermissions(user));
  assert.deepStrictEqual(added.exclude, ['Bash(rm -rf*)', ...lib.GUARDRAIL_EXCLUDES]);
  assert.deepStrictEqual(yaml.load(lib.mergePermissions(lib.mergePermissions(user))), added, 'idempotent');
  assert.deepStrictEqual(yaml.load(lib.mergePermissions(lib.mergePermissions(user), { remove: true })), yaml.load(user));
  assert.strictEqual(lib.mergePermissions(lib.mergePermissions(''), { remove: true }), '');
});

const USER_CONFIG = `name: Mine
version: 1.0.0
schema: v1
models:
  - name: main
    provider: anthropic
    model: m
# keep this comment
rules:
  - Be nice
`;

test('mergeConfigYaml appends after user entries and preserves comments', () => {
  const merged = lib.mergeConfigYaml(USER_CONFIG, { models: ['file:///b/m.yaml'], prompts: ['file:///b/p1.yaml', 'file:///b/p2.yaml'] });
  const doc = yaml.load(merged);
  assert.strictEqual(doc.models[0].name, 'main', 'user model stays first (default chat model)');
  assert.strictEqual(doc.models[1].uses, 'file:///b/m.yaml');
  assert.deepStrictEqual(doc.prompts.map(p => p.uses), ['file:///b/p1.yaml', 'file:///b/p2.yaml']);
  assert.ok(merged.includes('# keep this comment'));
  assert.deepStrictEqual(doc.rules, ['Be nice']);
});

test('mergeConfigYaml is idempotent and stripManaged restores the original', () => {
  const sections = { prompts: ['file:///b/p1.yaml'], mcpServers: ['file:///b/gh.yaml'] };
  const once = lib.mergeConfigYaml(USER_CONFIG, sections);
  assert.strictEqual(lib.mergeConfigYaml(once, sections), once);
  assert.deepStrictEqual(yaml.load(lib.stripManaged(once)), yaml.load(USER_CONFIG));
});

test('stripManaged also removes untagged ECC block references', () => {
  const rewritten = `${USER_CONFIG}prompts:\n  - uses: file:///home/u/.continue/ecc/blocks/prompts/plan.yaml\n`;
  assert.deepStrictEqual(yaml.load(lib.stripManaged(rewritten)), yaml.load(USER_CONFIG));
});

test('mergeConfigYaml matches existing list indentation and empty lists', () => {
  const zeroIndent = 'name: a\nversion: 1\nschema: v1\nprompts:\n- name: mine\n  prompt: hi\n';
  const doc = yaml.load(lib.mergeConfigYaml(zeroIndent, { prompts: ['file:///p.yaml'] }));
  assert.deepStrictEqual(doc.prompts.map(p => p.name || p.uses), ['mine', 'file:///p.yaml']);
  const empty = yaml.load(lib.mergeConfigYaml('name: a\nprompts: []\n', { prompts: ['file:///p.yaml'] }));
  assert.deepStrictEqual(empty.prompts, [{ uses: 'file:///p.yaml' }]);
  assert.throws(() => lib.mergeConfigYaml('prompts: [{name: x}]\n', { prompts: ['file:///p.yaml'] }), /flow style/);
});

test('fileUri matches the way Continue builds local block URIs', () => {
  assert.strictEqual(lib.fileUri('/home/u/x.yaml'), 'file:///home/u/x.yaml');
});

test('starterConfig produces a valid config with a secret-backed key', () => {
  const doc = yaml.load(lib.starterConfig(lib.parseModelSpec('anthropic/claude-sonnet-4-6')));
  assert.strictEqual(doc.schema, 'v1');
  assert.strictEqual(doc.models[0].apiKey, '${{ secrets.ANTHROPIC_API_KEY }}');
});

test('detectLanguages reads project marker files', () => {
  const langs = lib.detectLanguages(repoRoot, lib.listRuleLanguages(repoRoot));
  assert.ok(langs.includes('typescript'), 'package.json -> typescript');
  assert.ok(langs.includes('python'), 'pyproject.toml -> python');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
