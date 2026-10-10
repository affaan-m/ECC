/**
 * Tests for `.codex/config.toml` reference defaults.
 *
 * Run with: node tests/codex-config.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');
// Copied fixture scripts need the parent's resolved dependency, even without NODE_PATH.
const tomlDependencyRoot = path.resolve(
  path.dirname(require.resolve('@iarna/toml/package.json')), '..', '..'
);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

const repoRoot = path.join(__dirname, '..');
const configPath = path.join(repoRoot, '.codex', 'config.toml');
const config = fs.readFileSync(configPath, 'utf8');
const codexAgentsDir = path.join(repoRoot, '.codex', 'agents');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTomlSection(text, sectionName) {
  const escapedSection = escapeRegExp(sectionName);
  const headerPattern = new RegExp(`^\\s*\\[${escapedSection}\\]\\s*$`, 'm');
  const headerMatch = headerPattern.exec(text);

  assert.ok(headerMatch, `Expected TOML section to exist: [${sectionName}]`);

  const afterHeader = text.slice(headerMatch.index + headerMatch[0].length);
  const nextHeaderIndex = afterHeader.search(/^\s*\[/m);
  return nextHeaderIndex === -1 ? afterHeader : afterHeader.slice(0, nextHeaderIndex);
}

let passed = 0;
let failed = 0;

if (
  test('reference config does not pin a top-level model', () => {
    assert.ok(!/^model\s*=/m.test(config), 'Expected `.codex/config.toml` to inherit the CLI default model');
  })
)
  passed++;
else failed++;

if (
  test('reference config does not pin a top-level model provider', () => {
    assert.ok(
      !/^model_provider\s*=/m.test(config),
      'Expected `.codex/config.toml` to inherit the CLI default provider',
    );
  })
)
  passed++;
else failed++;

if (
  test('reference config enables Codex multi-agent support', () => {
    assert.ok(
      /^\s*multi_agent\s*=\s*true\s*$/m.test(config),
      'Expected `.codex/config.toml` to opt into Codex multi-agent collaboration',
    );
  })
)
  passed++;
else failed++;

if (
  test('reference config wires the sample Codex role files', () => {
    for (const roleFile of ['explorer.toml', 'reviewer.toml', 'docs-researcher.toml']) {
      const rolePath = path.join(codexAgentsDir, roleFile);
      const roleSection = roleFile.replace(/\.toml$/, '').replace(/-/g, '_');
      const sectionBody = getTomlSection(config, `agents.${roleSection}`);

      assert.ok(fs.existsSync(rolePath), `Expected role config to exist: ${roleFile}`);
      assert.ok(
        new RegExp(`^\\s*config_file\\s*=\\s*"agents\\/${escapeRegExp(roleFile)}"\\s*$`, 'm').test(
          sectionBody,
        ),
        `Expected \`.codex/config.toml\` to reference ${roleFile} inside [agents.${roleSection}]`,
      );
    }
  })
)
  passed++;
else failed++;

if (
  test('sample Codex role configs do not use o4-mini', () => {
    const roleFiles = fs.readdirSync(codexAgentsDir).filter(file => file.endsWith('.toml'));
    assert.ok(roleFiles.length > 0, 'Expected sample role config files under `.codex/agents`');

    for (const roleFile of roleFiles) {
      const rolePath = path.join(codexAgentsDir, roleFile);
      const roleConfig = fs.readFileSync(rolePath, 'utf8');
      assert.ok(
        !/^model\s*=\s*"o4-mini"$/m.test(roleConfig),
        `Expected sample role config to avoid o4-mini: ${roleFile}`,
      );
    }
  })
)
  passed++;
else failed++;


function readUserReference() {
  return TOML.parse(fs.readFileSync(path.join(repoRoot, '.codex', 'user-config.example.toml'), 'utf8'));
}

function withMergeFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-reference-'));
  try {
    const scriptDir = path.join(root, 'scripts', 'codex');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.mkdirSync(path.join(root, '.codex'));
    const script = path.join(scriptDir, 'merge-codex-config.js');
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'codex', 'merge-codex-config.js'), script);
    for (const name of ['config.toml', 'user-config.example.toml']) {
      const source = path.join(repoRoot, '.codex', name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(root, '.codex', name));
    }
    const target = path.join(root, 'target.toml');
    fs.writeFileSync(target, '');
    const run = (...args) => spawnSync(process.execPath, [script, target, ...args], {
      cwd: root, shell: false, encoding: 'utf8', input: '', timeout: 5000,
      maxBuffer: 128 * 1024,
      env: {
        PATH: path.dirname(process.execPath), HOME: root, USERPROFILE: root,
        TMPDIR: root, TMP: root, TEMP: root,
        NODE_PATH: tomlDependencyRoot,
      },
    });
    fn({ root, target, run });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const checks = [
  ['project config has only the intended guidance, feature and role keys', () => {
    const project = TOML.parse(config);
    assert.deepStrictEqual(Object.keys(project).sort(), ['agents', 'features', 'persistent_instructions']);
    assert.deepStrictEqual(project.features, { multi_agent: true });
    assert.strictEqual(project.persistent_instructions,
      'Follow project AGENTS.md guidelines. Use available MCP servers when they can help.');
    assert.deepStrictEqual(Object.keys(project.agents).sort(),
      ['docs_researcher', 'explorer', 'max_depth', 'max_threads', 'reviewer']);
    assert.strictEqual(project.agents.max_threads, 6);
    assert.strictEqual(project.agents.max_depth, 1);
  }],
  ['user reference preserves root defaults and explicit profiles in their own tables', () => {
    const user = readUserReference();
    assert.deepStrictEqual(Object.keys(user).sort(), [
      'agents', 'approval_policy', 'features', 'mcp_servers', 'notify',
      'persistent_instructions', 'profiles', 'sandbox_mode', 'web_search',
    ]);
    assert.strictEqual(user.approval_policy, 'on-request');
    assert.strictEqual(user.sandbox_mode, 'workspace-write');
    assert.strictEqual(user.web_search, 'live');
    assert.deepStrictEqual(user.notify,
      ['terminal-notifier', '-title', 'Codex ECC', '-message', 'Task completed!', '-sound', 'default']);
    assert.deepStrictEqual(user.profiles, {
      strict: { approval_policy: 'on-request', sandbox_mode: 'read-only', web_search: 'cached' },
      yolo: { approval_policy: 'never', sandbox_mode: 'workspace-write', web_search: 'live' },
    });
    assert.ok(!Object.hasOwn(user, 'profile'), 'Defining a profile must not select it');
  }],
  ['user reference preserves guidance, role mappings and existing MCP data', () => {
    const user = readUserReference();
    const project = TOML.parse(config);
    for (const key of ['persistent_instructions', 'features', 'agents']) {
      assert.deepStrictEqual(user[key], project[key]);
    }
    const args = {
      github: ['-y', '@modelcontextprotocol/server-github'],
      context7: ['-y', '@upstash/context7-mcp@latest'],
      exa: ['-y', 'mcp-remote', 'https://mcp.exa.ai/mcp'],
      memory: ['-y', '@modelcontextprotocol/server-memory'],
      playwright: ['-y', '@playwright/mcp@latest', '--extension'],
      'sequential-thinking': ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    };
    assert.deepStrictEqual(user.mcp_servers, Object.fromEntries(Object.entries(args).map(
      ([name, values]) => [name, { command: 'npx', args: values, startup_timeout_sec: 30 }]
    )));
  }],
  ['legacy merger adds the user baseline and is idempotent without installing MCP data', () => {
    withMergeFixture(({ target, run }) => {
      const first = run();
      assert.strictEqual(first.status, 0, first.stderr);
      const raw = fs.readFileSync(target, 'utf8');
      const expected = readUserReference();
      delete expected.mcp_servers;
      assert.deepStrictEqual(TOML.parse(raw), expected);
      assert.strictEqual(run().status, 0);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), raw);
    });
  }],
  ['legacy merger preserves customized values, unknown tables and dry-run bytes', () => {
    withMergeFixture(({ target, run }) => {
      const custom = {
        model: 'user-selected-model', model_provider: 'user-selected-provider',
        approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
        notify: ['custom-notifier'], persistent_instructions: 'My instructions', extra: 'keep',
        features: { multi_agent: false }, profiles: { strict: { sandbox_mode: 'workspace-write' } },
        mcp_servers: { personal: { command: 'private-command' } },
      };
      const raw = TOML.stringify(custom);
      fs.writeFileSync(target, raw);
      assert.strictEqual(run('--dry-run').status, 0);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), raw);
      const result = run();
      assert.strictEqual(result.status, 0, result.stderr);
      const merged = TOML.parse(fs.readFileSync(target, 'utf8'));
      for (const key of ['model', 'model_provider', 'approval_policy', 'sandbox_mode', 'web_search', 'notify',
        'persistent_instructions', 'extra', 'features', 'mcp_servers']) {
        assert.deepStrictEqual(merged[key], custom[key]);
      }
      assert.strictEqual(merged.profiles.strict.sandbox_mode, 'workspace-write');
      assert.strictEqual(merged.profiles.strict.approval_policy, 'on-request');
      assert.deepStrictEqual(merged.profiles.yolo, readUserReference().profiles.yolo);
    });
  }],
  ['legacy merger rejects missing user reference without falling back to project config', () => {
    withMergeFixture(({ root, target, run }) => {
      fs.rmSync(path.join(root, '.codex', 'user-config.example.toml'), { force: true });
      fs.writeFileSync(target, '# untouched\n');
      const result = run();
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Reference config not found/);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), '# untouched\n');
    });
  }],
  ['legacy merger rejects malformed target TOML without writing it', () => {
    withMergeFixture(({ target, run }) => {
      const raw = 'invalid = [\n';
      fs.writeFileSync(target, raw);
      const result = run();
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Failed to parse TOML/);
      assert.strictEqual(fs.readFileSync(target, 'utf8'), raw);
    });
  }],
];
for (const [name, fn] of checks) {
  if (test(name, fn)) passed++; else failed++;
}
if (
  test('sample Codex roles route research to GPT-6 Luna and review to GPT-6 Sol', () => {
    const expected = {
      'explorer.toml': ['gpt-6-luna', 'medium'],
      'docs-researcher.toml': ['gpt-6-luna', 'medium'],
      'reviewer.toml': ['gpt-6-sol', 'high'],
    };
    for (const [roleFile, [model, effort]] of Object.entries(expected)) {
      const roleConfig = fs.readFileSync(path.join(codexAgentsDir, roleFile), 'utf8');
      assert.ok(roleConfig.includes(`model = "${model}"`), `${roleFile}: expected ${model}`);
      assert.ok(
        roleConfig.includes(`model_reasoning_effort = "${effort}"`),
        `${roleFile}: expected ${effort} effort`,
      );
    }
    const guidance = fs.readFileSync(path.join(repoRoot, '.codex', 'AGENTS.md'), 'utf8');
    assert.ok(!/GPT 5\.5/.test(guidance), 'Expected model recommendations to be updated');
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
