'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { loadAgentOptions } = require('../../scripts/lib/install/copilot-agent-config');
const { adaptCopilotAgent } = require('../../scripts/lib/install/copilot-agent');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agent-config-'));
const configFile = path.join(root, 'agents.json');
const config = () => ({ schema: 'ecc.copilot.agents.v1', cliVersion: '1.0.105',
  verifiedTools: ['context7/resolve-library-id', 'context7/query-docs'], verifiedModels: ['operator-model'],
  agents: { 'docs-lookup': { toolMappings: {
    mcp__context7__resolve_library_id: 'context7/resolve-library-id',
    'mcp__context7__resolve-library-id': 'context7/resolve-library-id',
    'mcp__context7__query-docs': 'context7/query-docs',
  }, model: 'operator-model' } } });
function save(value) { fs.writeFileSync(configFile, JSON.stringify(value)); }
const environment = { ECC_COPILOT_AGENT_CONFIG: configFile };
const source = (name, tools) => `---\nname: ${name}\ndescription: Test\ntools: ${JSON.stringify(tools)}\n---\nOriginal instructions.\n`;
const front = text => yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
let passed = 0;
function test(name, action) { action(); passed++; console.log(`PASS ${name}`); }
try {
  test('no config is an unchanged fail-closed default with no path probing', () => {
    assert.deepEqual(loadAgentOptions('docs-lookup', {}), {});
    const result = adaptCopilotAgent(source('docs-lookup', ['Read', 'mcp__context7__query-docs']));
    assert.deepEqual(front(result).tools, []);
  });
  test('operator config maps exact verified MCP tools and pins an explicitly verified model', () => {
    save(config());
    const options = loadAgentOptions('docs-lookup', environment);
    const result = front(adaptCopilotAgent(source('docs-lookup', ['Read', 'mcp__context7__query-docs']), 'agents/docs-lookup.md', options));
    assert.deepEqual(result.tools, ['read', 'context7/query-docs']);
    assert.equal(result.model, 'operator-model'); assert.equal(result['strict-tools-list'], true);
  });
  test('unreviewed targets, model names and wildcard permission grammars reject', () => {
    for (const target of ['*', 'context7/*', 'mcp__context7__query-docs', 'execute(git status)', 'unverified/tool']) {
      const value = config(); value.agents['docs-lookup'].toolMappings['mcp__context7__query-docs'] = target;
      save(value); assert.throws(() => loadAgentOptions('docs-lookup', environment));
    }
    const value = config(); value.agents['docs-lookup'].model = 'not-verified';
    save(value); assert.throws(() => loadAgentOptions('docs-lookup', environment));
  });
  test('known canonical aliases cannot be remapped into a broader tool group', () => {
    const value = config(); value.verifiedTools.push('execute');
    value.agents['docs-lookup'].toolMappings.Read = 'execute'; save(value);
    assert.throws(() => loadAgentOptions('docs-lookup', environment));
  });
  test('reviewer tools remain read-only despite explicit MCP mappings and misleading names', () => {
    const options = { toolMappings: { mcp__service__mutate: 'service/mutate' }, verifiedTools: ['service/mutate'] };
    const named = front(adaptCopilotAgent(source('security-reviewer', ['Read', 'Bash', 'mcp__service__mutate']), 'agents/security-reviewer.md', options));
    assert.deepEqual(named.tools, ['read']);
    const renamed = front(adaptCopilotAgent(source('worker', ['Read', 'Write', 'Bash', 'Task']), 'agents/security-reviewer.md'));
    assert.deepEqual(renamed.tools, ['read']);
    const nativeSuffix = front(adaptCopilotAgent(source('worker', ['Read', 'Bash', 'Task']), 'agents/code-reviewer.agent.md'));
    assert.deepEqual(nativeSuffix.tools, ['read']);
  });
  test('unknown versions metadata malformed and oversized configs fail before projection', () => {
    const values = [ { ...config(), schema: 'future' }, { ...config(), unsafe: true }, { ...config(), agents: [] },
      { ...config(), verifiedTools: ['service/*'] }, { ...config(), cliVersion: '' } ];
    for (const value of values) { save(value); assert.throws(() => loadAgentOptions('docs-lookup', environment)); }
    fs.writeFileSync(configFile, '{bad'); assert.throws(() => loadAgentOptions('docs-lookup', environment));
    fs.writeFileSync(configFile, ' '.repeat(65537)); assert.throws(() => loadAgentOptions('docs-lookup', environment));
    assert.throws(() => loadAgentOptions('docs-lookup', { ECC_COPILOT_AGENT_CONFIG: 'relative.json' }));
  });
  test('linked operator configuration is refused', () => {
    save(config()); const hard = path.join(root, 'hard.json'); fs.linkSync(configFile, hard);
    assert.throws(() => loadAgentOptions('docs-lookup', environment)); fs.unlinkSync(hard);
    const linked = path.join(root, 'linked.json'); fs.symlinkSync(configFile, linked);
    assert.throws(() => loadAgentOptions('docs-lookup', { ECC_COPILOT_AGENT_CONFIG: linked }));
  });
  test('actual installer consumes only the explicitly selected operator file and preserves restrictions', () => {
    save(config());
    const prior = process.env.ECC_COPILOT_AGENT_CONFIG;
    const project = path.join(root, 'project'); fs.mkdirSync(project);
    process.env.ECC_COPILOT_AGENT_CONFIG = configFile;
    try {
      const plan = createManifestInstallPlan({ target: 'copilot', moduleIds: ['agents-core'], projectRoot: project,
        homeDir: path.join(root, 'home'), env: {} });
      applyInstallPlan(plan);
      const installed = front(fs.readFileSync(path.join(project, '.github/agents/docs-lookup.md'), 'utf8'));
      assert.deepEqual(installed.tools, ['read', 'search', 'context7/resolve-library-id', 'context7/query-docs']);
      assert.equal(installed.model, 'operator-model');
      const reviewer = front(fs.readFileSync(path.join(project, '.github/agents/code-reviewer.md'), 'utf8'));
      assert.deepEqual(reviewer.tools, ['read', 'search']);
      assert.equal(fs.existsSync(path.join(project, '.github/agents/agents.json')), false);
    } finally {
      if (prior === undefined) delete process.env.ECC_COPILOT_AGENT_CONFIG; else process.env.ECC_COPILOT_AGENT_CONFIG = prior;
    }
  });
  test('read-only projection report names default incompatibilities and configured remediation', () => {
    const { report } = require('../../scripts/copilot-agents');
    const checkout = path.resolve(__dirname, '../..');
    const defaults = report(checkout, {});
    assert.deepEqual(defaults.agents.filter(agent => agent.status === 'incompatible').map(agent => agent.name).sort(), ['docs-lookup', 'gan-evaluator']);
    save(config());
    const configured = report(checkout, environment);
    assert.equal(configured.agents.find(agent => agent.name === 'docs-lookup').status, 'mapped');
    assert.equal(configured.agents.find(agent => agent.name === 'gan-evaluator').status, 'incompatible');
    assert.equal(configured.nativeEnforcement, 'unverified');
  });
  test('report CLI rejects bad config without exposing its body', () => {
    const { spawnSync } = require('child_process');
    save({ ...config(), PRIVATE_SENTINEL: 'DO_NOT_ECHO_CONFIG' });
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/copilot-agents.js'), 'report'], {
      env: { ...process.env, ...environment }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /DO_NOT_ECHO_CONFIG|PRIVATE_SENTINEL/);
    fs.writeFileSync(configFile, '{"SECRET_SENTINEL": PRIVATE_CONFIG_BODY}');
    assert.throws(() => loadAgentOptions('docs-lookup', environment), error => !/PRIVATE_CONFIG_BODY|SECRET_SENTINEL/.test(error.message));
  });
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
