/**
 * Tests for scripts/build-vibe.js and the generated vibe/core payload.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-vibe.js');
const PAYLOAD_DIR = path.join(REPO_ROOT, 'vibe', 'core');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'vibe.json'), 'utf8'));
const VERSION = fs.readFileSync(path.join(REPO_ROOT, 'VERSION'), 'utf8').trim();

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

function listMarkdown(dir) {
  return fs.readdirSync(dir).filter(name => name.endsWith('.md')).sort();
}

function readPayload(relativePath) {
  return fs.readFileSync(path.join(PAYLOAD_DIR, relativePath), 'utf8');
}

function payloadExists(relativePath) {
  return fs.existsSync(path.join(PAYLOAD_DIR, relativePath));
}

function runTests() {
  console.log('\n=== Testing vibe plugin payload ===\n');

  let passed = 0;
  let failed = 0;

  if (test('committed payload is up to date with the build', () => {
    const result = spawnSync(process.execPath, [BUILD_SCRIPT, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.strictEqual(result.status, 0, `build-vibe --check failed: ${result.stdout} ${result.stderr}`);
  })) passed++; else failed++;

  if (test('plugin.json follows the Agent Plugins 1.0 field whitelist', () => {
    const manifest = JSON.parse(readPayload('plugin.json'));
    const allowed = new Set([
      '$schema', 'name', 'version', 'description', 'author', 'homepage',
      'repository', 'license', 'keywords', 'extensions',
    ]);
    for (const key of Object.keys(manifest)) {
      assert.ok(allowed.has(key), `unexpected plugin.json field: ${key}`);
    }
    assert.strictEqual(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    assert.strictEqual(manifest.name, MANIFEST.profile.pluginName);
    assert.strictEqual(manifest.version, VERSION);
    const extension = manifest.extensions['ai.mistral.vibe'];
    assert.strictEqual(extension.schemaVersion, 1);
    assert.strictEqual(extension.toolNamespace, MANIFEST.profile.toolNamespace);
  })) passed++; else failed++;

  if (test('every agent markdown file has a converted subagent TOML', () => {
    const agentFiles = listMarkdown(path.join(REPO_ROOT, 'agents'));
    for (const agentFile of agentFiles) {
      const tomlPath = path.join('ai.mistral.vibe', 'agents', agentFile.replace(/\.md$/, '.toml'));
      assert.ok(payloadExists(tomlPath), `missing converted agent: ${tomlPath}`);
    }
    assert.strictEqual(agentFiles.length, 68);
  })) passed++; else failed++;

  if (test('subagent TOMLs carry the required Vibe fields', () => {
    const tomlDir = path.join(PAYLOAD_DIR, 'ai.mistral.vibe', 'agents');
    const tomlFiles = fs.readdirSync(tomlDir).filter(name => name.endsWith('.toml'));
    assert.ok(tomlFiles.length > 0);
    for (const tomlFile of tomlFiles) {
      const content = readPayload(path.join('ai.mistral.vibe', 'agents', tomlFile));
      assert.match(content, /^schema_version = 1$/m, `${tomlFile}: schema_version`);
      assert.match(content, /^agent_type = "subagent"$/m, `${tomlFile}: agent_type`);
      assert.match(content, /^display_name = "/m, `${tomlFile}: display_name`);
      assert.match(content, /^description = "/m, `${tomlFile}: description`);
      assert.match(content, /^safety = "(safe|neutral)"$/m, `${tomlFile}: safety`);
      assert.match(content, /^instructions = '''$/m, `${tomlFile}: instructions block`);
    }
  })) passed++; else failed++;

  if (test('command conversion excludes classified commands and rewrites arguments', () => {
    const commandFiles = listMarkdown(path.join(REPO_ROOT, 'commands'));
    const excluded = Object.keys(MANIFEST.commands.exclude);
    const expectedSkills = commandFiles.filter(
      name => !excluded.includes(name.replace(/\.md$/, ''))
    );

    for (const commandFile of expectedSkills) {
      const skillPath = path.join('skills', commandFile.replace(/\.md$/, ''), 'SKILL.md');
      assert.ok(payloadExists(skillPath), `missing converted command skill: ${skillPath}`);
    }
    for (const commandName of excluded) {
      assert.ok(
        !payloadExists(path.join('skills', commandName, 'SKILL.md')),
        `excluded command ${commandName} must not ship as a skill`
      );
    }

    for (const commandFile of expectedSkills) {
      const skillPath = path.join('skills', commandFile.replace(/\.md$/, ''), 'SKILL.md');
      const content = readPayload(skillPath);
      assert.ok(!content.includes('$ARGUMENTS'), `${skillPath}: $ARGUMENTS must be rewritten`);
      assert.match(content, /^user-invocable: true$/m, `${skillPath}: user-invocable`);
    }
  })) passed++; else failed++;

  if (test('knowledge folders mirror the rules namespaces', () => {
    const rulesRoot = path.join(REPO_ROOT, MANIFEST.knowledge.rulesRoot);
    const namespaces = fs.readdirSync(rulesRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    for (const namespace of namespaces) {
      const entryPath = path.join('ai.mistral.vibe', 'knowledge', `rules-${namespace}`, 'KNOWLEDGE.md');
      assert.ok(payloadExists(entryPath), `missing knowledge pack: ${entryPath}`);
      const content = readPayload(entryPath);
      assert.match(content, new RegExp(`^name: rules-${namespace}$`, 'm'), `${entryPath}: name`);
      const description = content.match(/^description: (.+)$/m);
      assert.ok(description, `${entryPath}: description`);
      assert.ok(
        description[1].length >= 5 && description[1].length <= 300,
        `${entryPath}: description must be 5-300 characters`
      );
    }
  })) passed++; else failed++;

  if (test('hooks.toml wires curated hooks through the bridge and ships the runtime', () => {
    const content = readPayload(path.join('ai.mistral.vibe', 'hooks.toml'));
    const hookBlocks = content.split('[[hooks]]').slice(1);
    assert.strictEqual(hookBlocks.length, MANIFEST.hooks.include.length);

    for (const entry of MANIFEST.hooks.include) {
      assert.ok(content.includes(`name = "${entry.name}"`), `hooks.toml missing hook ${entry.name}`);
      assert.ok(
        content.includes(`node scripts/hooks/vibe-hook-bridge.js ${entry.runner}`),
        `hooks.toml missing bridge wiring for ${entry.name}`
      );
      assert.ok(
        payloadExists(entry.runner),
        `runner missing from payload: ${entry.runner}`
      );
    }
    assert.ok(payloadExists(path.join('scripts', 'hooks', 'vibe-hook-bridge.js')));
  })) passed++; else failed++;

  if (test('curation ledger lists every excluded command with a reason', () => {
    const ledger = readPayload('CURATION.md');
    for (const [commandName, reason] of Object.entries(MANIFEST.commands.exclude)) {
      assert.ok(ledger.includes(`\`${commandName}\``), `CURATION.md missing command ${commandName}`);
      assert.ok(ledger.includes(reason), `CURATION.md missing reason for ${commandName}`);
    }
  })) passed++; else failed++;

  if (test('generated command skills never collide with canonical skills', () => {
    const canonicalSkills = fs.readdirSync(path.join(REPO_ROOT, 'skills'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    const generatedSkills = fs.readdirSync(path.join(PAYLOAD_DIR, 'skills'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    const collisions = generatedSkills.filter(name => canonicalSkills.includes(name));
    assert.deepStrictEqual(collisions, [], 'payload skill names must not collide with canonical skills');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
