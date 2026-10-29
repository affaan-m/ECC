'use strict';

// Regression test for #3595: the multi-* commands ship codeagent-wrapper
// calls copied from ccg-workflow templates. ccg-workflow's installer
// substitutes {{LITE_MODE_FLAG}} and {{GEMINI_MODEL_FLAG}} at install time;
// ECC has no such step, so an unrendered token reaches bash as a literal
// argument and the wrapper exits 1 on every call.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandsDir = path.join(repoRoot, 'commands');
const docsDir = path.join(repoRoot, 'docs');

const WRAPPER = 'codeagent-wrapper';
const TEMPLATE_TOKEN = /\{\{[A-Z0-9_]+\}\}/;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function listMultiCommandFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(fileName => /^multi-.*\.md$/.test(fileName))
    .map(fileName => path.join(dir, fileName))
    .sort();
}

function listTranslatedCommandDirs() {
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(docsDir, entry.name, 'commands'))
    .filter(dir => fs.existsSync(dir));
}

function findWrapperTokenLines(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    if (line.includes(WRAPPER) && TEMPLATE_TOKEN.test(line)) {
      hits.push(`${path.relative(repoRoot, filePath)}:${index + 1}`);
    }
  });
  return hits;
}

console.log('\n=== Testing multi-* command wrapper invocations ===\n');

test('token scanner flags an unrendered ccg-workflow placeholder', () => {
  const line = '~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend codex - "$PWD"';
  assert.ok(TEMPLATE_TOKEN.test(line));
  assert.ok(!TEMPLATE_TOKEN.test('~/.claude/bin/codeagent-wrapper --backend codex - "$PWD"'));
});

test('commands/multi-*.md exist and call codeagent-wrapper', () => {
  const files = listMultiCommandFiles(commandsDir);
  assert.ok(files.length >= 5, `expected at least 5 multi-* commands, found ${files.length}`);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes(WRAPPER), `${path.relative(repoRoot, file)} does not call ${WRAPPER}`);
  }
});

test('commands/multi-*.md pass no {{TEMPLATE}} tokens to codeagent-wrapper', () => {
  const hits = listMultiCommandFiles(commandsDir).flatMap(findWrapperTokenLines);
  assert.deepStrictEqual(hits, [], `unrendered template tokens at:\n${hits.join('\n')}`);
});

test('translated docs/*/commands/multi-*.md pass no {{TEMPLATE}} tokens to codeagent-wrapper', () => {
  const hits = listTranslatedCommandDirs().flatMap(listMultiCommandFiles).flatMap(findWrapperTokenLines);
  assert.deepStrictEqual(hits, [], `unrendered template tokens at:\n${hits.join('\n')}`);
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
