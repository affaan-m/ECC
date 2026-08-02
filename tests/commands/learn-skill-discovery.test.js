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
  return match ? source.slice(match.index, match.index + 3000) : '';
}

function extractGuardedWrite(source) {
  const marker = 'guarded-write requirements:';
  const index = source.indexOf(marker);
  return index >= 0 ? source.slice(index, index + 1800) : '';
}

function getWriteInstructionLines(source) {
  const lines = source.split(/\r?\n/);
  const selected = new Set();

  lines.forEach((line, index) => {
    if (!/\b(create|write|save)\b/i.test(line)) return;
    for (let offset = 0; offset <= 3 && index + offset < lines.length; offset++) {
      selected.add(index + offset);
    }
  });

  return Array.from(selected)
    .sort((left, right) => left - right)
    .map(index => lines[index])
    .join('\n');
}

console.log('\n=== Testing generated skill discoverability ===\n');

for (const name of commandNames) {
  test(`/${name} generates a directory-based SKILL.md`, () => {
    const source = readCommand(name);
    const writeInstructions = getWriteInstructionLines(source);
    const requiredWritePaths = {
      learn: /~\/\.claude\/skills\/<pattern-name>\/SKILL\.md/,
      'learn-eval': /<location>\/<pattern-name>\/SKILL\.md/,
      'skill-create': /<output-dir>\/<skill-name>\/SKILL\.md/,
    };

    assert.match(
      writeInstructions,
      requiredWritePaths[name],
      `Expected /${name} write instructions to require a <name>/SKILL.md path`,
    );
    assert.doesNotMatch(
      writeInstructions,
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
    assert.doesNotMatch(template, /^origin:/m, `Expected /${name} not to emit unsupported origin frontmatter`);
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
    assert.match(verification, /remove|quarantine/i, `Expected /${name} to handle invalid output`);
    assert.match(verification, /fresh\s+explicit\s+approval/i, `Expected /${name} to re-approve repaired output`);
    assert.match(verification, /stop[^.]*success|do not\s+report\s+success/i, `Expected /${name} to fail closed`);
  });

  test(`/${name} guards generated skill writes`, () => {
    const guardedWrite = extractGuardedWrite(readCommand(name));

    assert.ok(guardedWrite, `Expected /${name} to define guarded-write requirements`);
    assert.match(guardedWrite, /redact[^.]*secrets[^.]*PII/is, `Expected /${name} to redact sensitive content`);
    assert.match(guardedWrite, /exclude[^.]*prompt-injection[^.]*untrusted\s+instructions/is, `Expected /${name} to exclude unsafe instructions`);
    assert.match(guardedWrite, /validate[\s\S]*?slug[\s\S]*?reject path\s+separators[\s\S]*?path traversal/i, `Expected /${name} to reject unsafe names`);
    assert.match(guardedWrite, /resolve[\s\S]*?inside[\s\S]*?approved (?:skill|export) root/i, `Expected /${name} to confine the resolved target`);
    assert.match(guardedWrite, /already exists[^.]*show the diff[^.]*explicit overwrite\s+approval/is, `Expected /${name} to protect existing skills`);
    assert.match(guardedWrite, /require explicit\s+approval[^.]*persistence/is, `Expected /${name} to approve content before persistence`);
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

test('/skill-create normalizes repository names before path validation', () => {
  const source = readCommand('skill-create');

  assert.match(source, /lowercase[\s\S]*?replace[\s\S]*?spaces[\s\S]*?underscores[\s\S]*?path separators/i);
  assert.match(source, /trim[^.]*hyphens[^.]*append[^.]*-patterns/is);
  assert.match(source, /My Repo_API\/Client[\s\S]*?my-repo-api-client-patterns/);
  assert.match(source, /validate the\s+final[^.]*skill-name/i);
});

test('/learn-eval treats comparison files as untrusted', () => {
  const guardedWrite = extractGuardedWrite(readCommand('learn-eval'));

  assert.match(guardedWrite, /MEMORY\.md/);
  assert.match(guardedWrite, /\.claude\/skills/);
  assert.match(guardedWrite, /never follow[^.]*instructions/i);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
