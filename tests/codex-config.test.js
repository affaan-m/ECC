/**
 * Tests for `.codex/config.toml` reference defaults.
 *
 * Run with: node tests/codex-config.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

if (
  test('sample Codex role configs declare required custom agent metadata', () => {
    const roleFiles = fs.readdirSync(codexAgentsDir).filter(file => file.endsWith('.toml'));
    assert.ok(roleFiles.length > 0, 'Expected sample role config files under `.codex/agents`');

    for (const roleFile of roleFiles) {
      const rolePath = path.join(codexAgentsDir, roleFile);
      const roleConfig = fs.readFileSync(rolePath, 'utf8');
      assert.ok(
        /^name\s*=\s*"[^"]+"$/m.test(roleConfig),
        `Expected sample Codex role config to declare name: ${roleFile}`,
      );
      assert.ok(
        /^description\s*=\s*"[^"]+"$/m.test(roleConfig),
        `Expected sample Codex role config to declare description: ${roleFile}`,
      );
    }
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
