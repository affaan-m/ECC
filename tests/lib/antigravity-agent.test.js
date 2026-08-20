/**
 * Tests for scripts/lib/install/antigravity-agent.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { adaptAntigravityAgent } = require('../../scripts/lib/install/antigravity-agent');

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

function runTests() {
  console.log('\n=== Testing antigravity-agent.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('reports actionable error when js-yaml is missing', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-agent-no-yaml-'));
    const scriptsDir = path.join(sandbox, 'scripts');
    const libDir = path.join(scriptsDir, 'lib', 'install');

    try {
      fs.mkdirSync(libDir, { recursive: true });
      fs.cpSync(
        path.join(__dirname, '..', '..', 'scripts', 'lib', 'require-runtime.js'),
        path.join(scriptsDir, 'lib', 'require-runtime.js'),
      );
      fs.cpSync(
        path.join(__dirname, '..', '..', 'scripts', 'lib', 'install', 'antigravity-agent.js'),
        path.join(libDir, 'antigravity-agent.js'),
      );

      const source = `---
name: demo
tools: Read
---
Body
`;
      const result = spawnInSandbox(sandbox, source);
      assert.strictEqual(result.status, 1);
      assert.ok(result.stderr.includes("Missing runtime dependency 'js-yaml'"));
      assert.ok(result.stderr.includes('npm install'));
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('adapts agent frontmatter when js-yaml is available', () => {
    const adapted = adaptAntigravityAgent(`---
name: demo
tools: Read, Bash
model: sonnet
---
Body
`, 'demo.md');
    assert.ok(adapted.includes('view_file'));
    assert.ok(adapted.includes('run_command'));
    assert.ok(adapted.includes('pro'));
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

function spawnInSandbox(sandbox, source) {
  const runner = path.join(sandbox, 'runner.js');
  fs.writeFileSync(runner, `
    const { adaptAntigravityAgent } = require('./scripts/lib/install/antigravity-agent');
    try {
      adaptAntigravityAgent(${JSON.stringify(source)}, 'demo.md');
      process.exit(0);
    } catch (error) {
      process.stderr.write(String(error.message || error));
      process.exit(1);
    }
  `);
  return require('child_process').spawnSync(process.execPath, [runner], {
    encoding: 'utf8',
    cwd: sandbox,
  });
}

runTests();
