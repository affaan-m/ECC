'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandNames = ['learn', 'learn-eval', 'skill-create'];

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

function readCommand(name) {
  return fs.readFileSync(path.join(repoRoot, 'commands', `${name}.md`), 'utf8');
}

function extractGeneratedSkillTemplate(source) {
  const match = source.match(/```markdown\r?\n(---\r?\n[\s\S]*?\r?\n---[\s\S]*?)\r?\n```/);
  return match ? match[1] : '';
}

function extractVerification(source) {
  const match = source.match(/\*\*Verify discoverability[^\n]*\*\*|\*\*Verification[^\n]*\*\*/i);
  return match ? source.slice(match.index, match.index + 1200) : '';
}

function getWriteInstructionLines(source) {
  return source
    .split(/\r?\n/)
    .filter(line => /\b(create|write|save)\b/i.test(line))
    .join('\n');
}

console.log('\n=== Testing generated skill discoverability ===\n');

for (const name of commandNames) {
  test(`/${name} generates a directory-based SKILL.md`, () => {
    const source = readCommand(name);

    assert.match(
      source,
      /<[^>]*name[^>]*>\/SKILL\.md|\{[^}]*name[^}]*\}[^\n`]*\/SKILL\.md/,
      `Expected /${name} to specify a <name>/SKILL.md output path`,
    );
    assert.doesNotMatch(
      getWriteInstructionLines(source),
      /skills\/learned\/(?:\[[^\]]*name[^\]]*\]|<[^>]*name[^>]*>|\{[^}]*name[^}]*\})\.md/i,
      `Expected /${name} not to instruct writing a flat learned skill file`,
    );
  });

  test(`/${name} uses trigger-first generated skill metadata`, () => {
    const template = extractGeneratedSkillTemplate(readCommand(name));

    assert.match(template, /^---\r?\n/, `Expected /${name} template to start with frontmatter`);
    assert.match(template, /\r?\n---(?:\r?\n|$)/, `Expected /${name} template to close frontmatter`);
    assert.match(template, /^name:\s*\S+/m, `Expected /${name} template to define name`);
    assert.match(
      template,
      /^description:\s*["']?Use when\b.+/m,
      `Expected /${name} to generate a description beginning with "Use when"`,
    );
  });

  test(`/${name} verifies discoverability and fails closed`, () => {
    const verification = extractVerification(readCommand(name));

    assert.ok(verification, `Expected /${name} to include an explicit discoverability check`);
    assert.match(verification, /SKILL\.md/, `Expected /${name} to verify the entrypoint name`);
    assert.match(verification, /---/, `Expected /${name} to verify frontmatter delimiters`);
    assert.match(verification, /valid YAML|parseable YAML/i, `Expected /${name} to verify valid YAML`);
    assert.match(verification, /name:/, `Expected /${name} to verify the frontmatter name`);
    assert.match(verification, /description:/, `Expected /${name} to verify the description`);
    assert.match(verification, /Use when/, `Expected /${name} to verify a trigger-first description`);
    assert.match(verification, /repair or\s+remove/i, `Expected /${name} to handle invalid output`);
    assert.match(verification, /stop[^.]*success|do not report success/i, `Expected /${name} to fail closed`);
  });

  test(`/${name} guards generated skill writes`, () => {
    const source = readCommand(name);

    assert.match(source, /secret|PII|sensitive/i, `Expected /${name} to prevent sensitive-data persistence`);
    assert.match(source, /prompt injection|policy-override|untrusted instruction/i, `Expected /${name} to filter unsafe instructions`);
    assert.match(source, /path separator|path traversal/i, `Expected /${name} to validate the generated name`);
    assert.match(source, /approved skill root/i, `Expected /${name} to constrain the output path`);
    assert.match(source, /already exists|overwrite/i, `Expected /${name} to protect existing skills`);
    assert.match(source, /explicit\s+approval/i, `Expected /${name} to require approval before persistence`);
  });
}

test('/skill-create uses one skill-name for the directory and frontmatter', () => {
  const source = readCommand('skill-create');
  const template = extractGeneratedSkillTemplate(source);

  assert.match(source, /skill-name[^\n]*default[^\n]*\{repo-name\}-patterns/i);
  assert.match(source, /<output-dir>\/<skill-name>\/SKILL\.md/);
  assert.match(template, /^name:\s*\{skill-name\}$/m);
});

test('/skill-create does not call an arbitrary custom output discoverable', () => {
  const source = readCommand('skill-create');

  assert.match(source, /custom[^\n]*--output|--output[^\n]*custom/i);
  assert.match(source, /configured skill root/i);
  assert.match(source, /export-only/i);
  assert.match(source, /do not report[^.]*discoverab/i);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
