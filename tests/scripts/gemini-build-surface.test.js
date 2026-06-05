/**
 * Tests for scripts/gemini-build-surface.js outputs.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const packageJson = require(path.join(repoRoot, 'package.json'));

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function countFiles(dirPath, predicate) {
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(entryPath, predicate);
    } else if (entry.isFile() && predicate(entryPath)) {
      count += 1;
    }
  }
  return count;
}

function runTests() {
  console.log('\n=== Testing Gemini surface ===\n');

  let passed = 0;
  let failed = 0;

  if (test('Gemini project-local surface contains context, agents, commands, and skills', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'GEMINI.md')), 'Missing .gemini/GEMINI.md');
    assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'agents')), 'Missing .gemini/agents');
    assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'commands')), 'Missing .gemini/commands');
    assert.ok(fs.existsSync(path.join(repoRoot, '.gemini', 'skills')), 'Missing .gemini/skills');
  })) passed++; else failed++;

  if (test('Gemini generated counts match canonical ECC sources', () => {
    const sourceAgents = countFiles(path.join(repoRoot, 'agents'), filePath => filePath.endsWith('.md'));
    const sourceCommands = countFiles(path.join(repoRoot, 'commands'), filePath => filePath.endsWith('.md'));
    const sourceSkills = countFiles(path.join(repoRoot, 'skills'), filePath => path.basename(filePath) === 'SKILL.md');

    const geminiAgents = countFiles(path.join(repoRoot, '.gemini', 'agents'), filePath => filePath.endsWith('.md'));
    const geminiCommands = countFiles(path.join(repoRoot, '.gemini', 'commands'), filePath => filePath.endsWith('.toml'));
    const geminiSkills = countFiles(path.join(repoRoot, '.gemini', 'skills'), filePath => path.basename(filePath) === 'SKILL.md');

    assert.strictEqual(geminiAgents, sourceAgents, 'Expected Gemini agent count to match canonical agents');
    assert.strictEqual(geminiCommands, sourceCommands, 'Expected Gemini command count to match canonical commands');
    assert.strictEqual(geminiSkills, sourceSkills, 'Expected Gemini skill count to match canonical skills');
  })) passed++; else failed++;

  if (test('Gemini agents use Gemini-compatible frontmatter', () => {
    const agentPath = path.join(repoRoot, '.gemini', 'agents', 'planner.md');
    const source = fs.readFileSync(agentPath, 'utf8');

    assert.ok(/^name:\s*planner$/m.test(source), 'Expected planner agent name');
    assert.ok(/^kind:\s*local$/m.test(source), 'Expected Gemini local agent kind');
    assert.ok(!/^model:\s*opus$/m.test(source), 'Gemini agent must not keep Claude model alias');
    assert.ok(source.includes('"read_file"'), 'Expected Read tool to be mapped to read_file');
    assert.ok(source.includes('"grep_search"'), 'Expected Grep tool to be mapped to grep_search');
  })) passed++; else failed++;

  if (test('Gemini custom command TOML is generated from ECC command markdown', () => {
    const commandPath = path.join(repoRoot, '.gemini', 'commands', 'plan.toml');
    const source = fs.readFileSync(commandPath, 'utf8');

    assert.ok(/^description = /m.test(source), 'Expected Gemini command description');
    assert.ok(/^prompt = '''/m.test(source), 'Expected Gemini command prompt literal string');
    assert.ok(source.includes('# ECC Command: /plan'), 'Expected generated command header');
  })) passed++; else failed++;

  if (test('Gemini extension surface is self-contained and versioned', () => {
    const extensionRoot = path.join(repoRoot, 'extensions', 'ecc-gemini');
    const manifestPath = path.join(extensionRoot, 'gemini-extension.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(manifest.name, 'ecc-gemini');
    assert.strictEqual(manifest.version, packageJson.version);
    assert.strictEqual(manifest.contextFileName, 'GEMINI.md');
    assert.ok(fs.existsSync(path.join(extensionRoot, 'GEMINI.md')), 'Missing extension GEMINI.md');
    assert.ok(fs.existsSync(path.join(extensionRoot, 'agents', 'planner.md')), 'Missing extension planner agent');
    assert.ok(fs.existsSync(path.join(extensionRoot, 'commands', 'plan.toml')), 'Missing extension plan command');
    assert.ok(fs.existsSync(path.join(extensionRoot, 'skills', 'tdd-workflow', 'SKILL.md')), 'Missing extension tdd-workflow skill');
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
