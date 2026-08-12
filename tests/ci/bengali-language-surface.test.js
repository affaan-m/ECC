#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function findPython() {
  for (const command of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const args = command === 'py' ? ['-3', '--version'] : ['--version'];
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status === 0) {
      return { command, prefix: command === 'py' ? ['-3'] : [] };
    }
  }
  return null;
}

function run() {
  console.log('\n=== Testing Bengali language surfaces ===\n');

  let passed = 0;
  let failed = 0;

  if (test('Bengali Python examples are syntactically valid', () => {
    const skill = read('skills/bengali-nlp/SKILL.md');
    const snippets = [...skill.matchAll(/```python\s*\n([\s\S]*?)```/g)].map(match => match[1]);
    assert.ok(snippets.length > 0, 'Expected at least one Python example');

    const python = findPython();
    if (!python) {
      console.log('    SKIP: Python interpreter is unavailable');
      return;
    }

    snippets.forEach((snippet, index) => {
      const result = spawnSync(
        python.command,
        [...python.prefix, '-c', "import sys; compile(sys.stdin.read(), '<bengali-nlp>', 'exec')"],
        { input: snippet, encoding: 'utf8' },
      );
      assert.strictEqual(
        result.status,
        0,
        `Python example ${index + 1} does not compile:\n${result.stderr || result.stdout}`,
      );
    });
  })) passed++; else failed++;

  if (test('Bengali skill is exported and installable', () => {
    const agentYaml = read('agent.yaml');
    const modules = readJson('manifests/install-modules.json').modules;
    const components = readJson('manifests/install-components.json').components;
    const packageFiles = readJson('package.json').files;
    const frameworkModule = modules.find(module => module.id === 'framework-language');
    const skillComponent = components.find(component => component.id === 'skill:bengali-nlp');

    assert.match(agentYaml, /^\s+- bengali-nlp\s*$/m);
    assert.ok(frameworkModule?.paths.includes('skills/bengali-nlp'));
    assert.ok(skillComponent?.modules.includes('framework-language'));
    assert.ok(packageFiles.includes('skills/bengali-nlp/'));
  })) passed++; else failed++;

  if (test('Bengali reviewer is discoverable through the shared agent surface', () => {
    const agentsGuide = read('AGENTS.md');
    const modules = readJson('manifests/install-modules.json').modules;
    const agentsModule = modules.find(module => module.id === 'agents-core');

    assert.ok(fs.existsSync(path.join(ROOT, 'agents', 'bengali-reviewer.md')));
    assert.match(agentsGuide, /^\| bengali-reviewer \|/m);
    assert.ok(agentsModule?.paths.includes('agents'));
  })) passed++; else failed++;

  if (test('Bengali documentation has an installable locale route', () => {
    const modules = readJson('manifests/install-modules.json').modules;
    const components = readJson('manifests/install-components.json').components;
    const packageFiles = readJson('package.json').files;
    const docsModule = modules.find(module => module.id === 'docs-bn');
    const localeComponent = components.find(component => component.id === 'locale:bn');

    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'bn', 'README.md')));
    assert.deepStrictEqual(docsModule?.paths, ['docs/bn']);
    assert.ok(localeComponent?.modules.includes('docs-bn'));
    assert.ok(packageFiles.includes('docs/bn/'));
    assert.match(read('README.md'), /href="docs\/bn\/README\.md">বাংলা<\/a>/);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
