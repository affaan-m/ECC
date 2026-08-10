/**
 * Tests for .opencode/opencode.json local file references.
 *
 * Run with: node tests/opencode-config.test.js
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
const opencodeDir = path.join(repoRoot, '.opencode');
const configPath = path.join(opencodeDir, 'opencode.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

let passed = 0;
let failed = 0;

if (
  test('plugin paths do not duplicate the .opencode directory', () => {
    const plugins = config.plugin || [];
    for (const pluginPath of plugins) {
      assert.ok(!pluginPath.includes('.opencode/'), `Plugin path should be config-relative, got: ${pluginPath}`);
      assert.ok(fs.existsSync(path.resolve(opencodeDir, pluginPath)), `Plugin path should resolve from .opencode/: ${pluginPath}`);
    }
  })
)
  passed++;
else failed++;

if (
  test('file references are config-relative and resolve to existing files', () => {
    const refs = [];

    function walk(value) {
      if (typeof value === 'string') {
        const matches = value.matchAll(/\{file:([^}]+)\}/g);
        for (const match of matches) {
          refs.push(match[1]);
        }
        return;
      }

      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }

      if (value && typeof value === 'object') {
        Object.values(value).forEach(walk);
      }
    }

    walk(config);

    assert.ok(refs.length > 0, 'Expected to find file references in opencode.json');

    for (const ref of refs) {
      assert.ok(!ref.startsWith('.opencode/'), `File ref should not duplicate .opencode/: ${ref}`);
      assert.ok(fs.existsSync(path.resolve(opencodeDir, ref)), `File ref should resolve from .opencode/: ${ref}`);
    }
  })
)
  passed++;
else failed++;

if (
  test('command markdown frontmatter agent ids resolve to a registered opencode agent', () => {
    const commandsDir = path.join(opencodeDir, 'commands');
    const registeredAgents = new Set(Object.keys(config.agent || {}));
    assert.ok(registeredAgents.size > 0, 'Expected opencode.json to register at least one agent');

    for (const entry of fs.readdirSync(commandsDir)) {
      if (!entry.endsWith('.md')) {
        continue;
      }

      const body = fs.readFileSync(path.join(commandsDir, entry), 'utf8');
      const match = body.match(/^agent:\s*(.+)$/m);

      if (!match) {
        continue;
      }

      const agentId = match[1].trim().replace(/^['"]|['"]$/g, '');

      // Regression guard for #2477: opencode registers these agents unscoped
      // in opencode.json's `agent` map, so ANY namespace-scoped id
      // (`<plugin>:<agent>` — e.g. the Claude Code `everything-claude-code:`
      // prefix) fails to resolve ("Agent not found") and hard-breaks subtask
      // commands like /code-review on opencode. Reject the whole scoped class,
      // not just the one legacy prefix.
      assert.ok(
        !agentId.includes(':'),
        `${entry}: command agent must be an unscoped opencode agent id, got: ${agentId}`
      );

      assert.ok(
        registeredAgents.has(agentId),
        `${entry}: command agent "${agentId}" is not registered in opencode.json's agent map`
      );
    }
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
