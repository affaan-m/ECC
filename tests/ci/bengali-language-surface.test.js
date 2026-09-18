#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const { resolveInstallPlan } = require(path.join(ROOT, 'scripts', 'lib', 'install-manifests.js'));

// Every file that carries a language selector linking to the Bengali README.
// Root-level files link via `docs/bn/README.md`; translated docs link via `../bn/README.md`.
const SELECTOR_FILES = [
  'README.md',
  'README.zh-CN.md',
  'docs/de-DE/README.md',
  'docs/es/README.md',
  'docs/ja-JP/README.md',
  'docs/ko-KR/README.md',
  'docs/pt-BR/README.md',
  'docs/ru/README.md',
  'docs/th/README.md',
  'docs/tr/README.md',
  'docs/uk-UA/README.md',
  'docs/ur/README.md',
  'docs/vi-VN/README.md',
  'docs/zh-CN/README.md',
  'docs/zh-TW/README.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    if (error instanceof SkipError) {
      console.log(`  ○ ${name} (SKIPPED: ${error.message})`);
      skipped++;
      return;
    }
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed++;
  }
}

class SkipError extends Error {}

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

// Walks every fence in the document so an unclosed ```python block fails loudly
// instead of being silently dropped by a non-greedy regex.
function extractFencedBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let open = null;
  let buffer = [];

  lines.forEach((line, index) => {
    const fence = /^\s*```(.*)$/.exec(line);
    if (!fence) {
      if (open) buffer.push(line);
      return;
    }

    const info = fence[1].trim();
    if (!open) {
      open = { language: info.split(/\s+/)[0] || '', line: index + 1 };
      buffer = [];
      return;
    }

    if (info !== '') {
      throw new Error(
        `Fence opened at line ${open.line} is closed by an info-string fence at line ${index + 1}`,
      );
    }

    blocks.push({ language: open.language, code: buffer.join('\n'), line: open.line });
    open = null;
    buffer = [];
  });

  if (open) {
    throw new Error(`Unclosed \`\`\`${open.language} fence opened at line ${open.line}`);
  }

  return blocks;
}

function run() {
  console.log('\n=== Testing Bengali language surfaces ===\n');

  test('Bengali Python examples are syntactically valid', () => {
    const skill = read('skills/bengali-nlp/SKILL.md');
    const blocks = extractFencedBlocks(skill);
    const snippets = blocks.filter(block => block.language === 'python');
    assert.ok(snippets.length > 0, 'Expected at least one Python example');

    const python = findPython();
    if (!python) {
      throw new SkipError('no Python 3 interpreter on PATH');
    }

    snippets.forEach(snippet => {
      const result = spawnSync(
        python.command,
        [...python.prefix, '-c', "import sys; compile(sys.stdin.read(), '<bengali-nlp>', 'exec')"],
        { input: snippet.code, encoding: 'utf8' },
      );
      assert.strictEqual(
        result.status,
        0,
        `Python example at line ${snippet.line} does not compile:\n${result.stderr || result.stdout}`,
      );
    });
  });

  test('Bengali skill is exported and installable', () => {
    const agentYaml = read('agent.yaml');
    const modules = readJson('manifests/install-modules.json').modules;
    const packageFiles = readJson('package.json').files;
    const frameworkModule = modules.find(module => module.id === 'framework-language');

    assert.match(agentYaml, /^\s+- bengali-nlp\s*$/m);
    assert.ok(frameworkModule?.paths.includes('skills/bengali-nlp'));
    assert.ok(packageFiles.includes('skills/bengali-nlp/'));
  });

  test('Selecting the Bengali skill installs only the Bengali skill', () => {
    const plan = resolveInstallPlan({ includeComponentIds: ['skill:bengali-nlp'] });
    const paths = plan.selectedModules.flatMap(module => module.paths || []);

    assert.deepStrictEqual(plan.selectedModuleIds, ['skill-bengali-nlp']);
    assert.deepStrictEqual(paths, ['skills/bengali-nlp']);
  });

  test('Bengali reviewer is discoverable through the shared agent surface', () => {
    const agentsGuide = read('AGENTS.md');
    const modules = readJson('manifests/install-modules.json').modules;
    const agentsModule = modules.find(module => module.id === 'agents-core');

    assert.ok(fs.existsSync(path.join(ROOT, 'agents', 'bengali-reviewer.md')));
    assert.match(agentsGuide, /^\| bengali-reviewer \|/m);
    assert.ok(agentsModule?.paths.includes('agents'));
  });

  test('Bengali documentation has an installable locale route', () => {
    const modules = readJson('manifests/install-modules.json').modules;
    const components = readJson('manifests/install-components.json').components;
    const packageFiles = readJson('package.json').files;
    const docsModule = modules.find(module => module.id === 'docs-bn');
    const localeComponent = components.find(component => component.id === 'locale:bn');

    assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'bn', 'README.md')));
    assert.deepStrictEqual(docsModule?.paths, ['docs/bn']);
    assert.ok(localeComponent?.modules.includes('docs-bn'));
    assert.ok(packageFiles.includes('docs/bn/'));
  });

  test('Every language selector links to the Bengali README', () => {
    SELECTOR_FILES.forEach(relativePath => {
      const contents = read(relativePath);
      const route = relativePath.includes('/') ? '../bn/README.md' : 'docs/bn/README.md';
      assert.ok(
        contents.includes(`](${route})`) || contents.includes(`href="${route}"`),
        `${relativePath} is missing the Bengali language link (${route})`,
      );
      assert.ok(contents.includes('বাংলা'), `${relativePath} is missing the বাংলা label`);
    });
  });

  test('Bengali README offers the same languages as the root README', () => {
    const rootLabels = [...read('README.md')
      .matchAll(/<a href="(?:docs\/[\w-]+\/)?README(?:\.[\w-]+)?\.md">([^<]+)<\/a>/g)]
      .map(match => match[1].trim());
    assert.ok(rootLabels.length > 5, 'Expected the root README language selector to be parsed');

    const bengali = read('docs/bn/README.md');
    rootLabels.forEach(label => {
      assert.ok(bengali.includes(label), `docs/bn/README.md is missing the ${label} link`);
    });
  });

  console.log(`\nPassed: ${passed}`);
  if (skipped > 0) console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
