'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

const publicInstallDocs = [
  'README.md',
  'README.zh-CN.md',
  'docs/pt-BR/README.md',
  'docs/zh-CN/README.md',
  'docs/ja-JP/skills/configure-ecc/SKILL.md',
  'docs/zh-CN/skills/configure-ecc/SKILL.md',
];

console.log('\n=== Testing public install identifiers ===\n');

for (const relativePath of publicInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} does not use the overlong legacy marketplace plugin identifier`, () => {
    assert.ok(!content.includes('everything-claude-code@everything-claude-code'));
  });

  test(`${relativePath} documents the short marketplace plugin identifier`, () => {
    assert.ok(content.includes('ecc@ecc'));
  });
}

const pluginAndManualInstallDocs = [
  'README.md',
  'README.zh-CN.md',
  'docs/zh-CN/README.md',
];

const publicCommandNamespaceDocs = [
  'README.md',
  'README.zh-CN.md',
  'docs/pt-BR/README.md',
  'docs/tr/README.md',
  'docs/ko-KR/README.md',
  'docs/ja-JP/README.md',
  'docs/zh-CN/README.md',
  'docs/zh-TW/README.md',
];

const manualClaudeSkillInstallDocs = [
  'README.md',
  'docs/de-DE/README.md',
  'docs/ru/README.md',
];

const rootReadme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const languageSwitcher = rootReadme.match(
  /<p align="center">\s*<strong>Language:<\/strong>([\s\S]*?)<\/p>/
);

assert.ok(languageSwitcher, 'Expected README.md to contain the public language switcher');

const languageSwitcherReadmes = Array.from(
  languageSwitcher[1].matchAll(/href="([^"]+\.md)"/g),
  (match) => match[1]
);

assert.ok(
  languageSwitcherReadmes.length > 0,
  'Expected the public language switcher to link at least one README'
);

const publicUniversalInstallDocs = [
  ...languageSwitcherReadmes,
  'docs/zh-CN/README.md',
  'docs/MIGRATION-1X-TO-2.0.md',
  'docs/token-optimization.md',
];

function executableLegacyInstallerLines(content) {
  const executableLines = [];
  const codeBlocks = content.matchAll(/```[^\n]*\n([\s\S]*?)```/g);

  for (const codeBlock of codeBlocks) {
    for (const line of codeBlock[1].split('\n')) {
      if (/^\s*(?:(?:\$|PS>)\s*)?npx\s+ecc-install(?:\s|$)/i.test(line)) {
        executableLines.push(line.trim());
      }
    }
  }

  return executableLines;
}

function unrelatedEccPackageLines(content) {
  return content
    .split('\n')
    .filter(line => /\bnpx\s+ecc(?=\s|$)/i.test(line))
    .map(line => line.trim());
}

function trackedMarkdownFiles(directoryPath) {
  const ignoredDirectories = new Set(['.git', 'coverage', 'node_modules']);
  const files = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...trackedMarkdownFiles(path.join(directoryPath, entry.name)));
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(directoryPath, entry.name));
    }
  }

  return files;
}

for (const relativePath of publicUniversalInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} does not invoke the unpublished ecc-install package`, () => {
    const executableLines = executableLegacyInstallerLines(content);

    assert.deepStrictEqual(
      executableLines,
      [],
      `Replace executable npx ecc-install commands with npx ecc-universal install: ${executableLines.join(', ')}`
    );
  });

  test(`${relativePath} does not invoke the unrelated ecc package`, () => {
    const executableLines = unrelatedEccPackageLines(content);

    assert.deepStrictEqual(
      executableLines,
      [],
      `Replace npx ecc commands with npx ecc-universal: ${executableLines.join(', ')}`
    );
  });
}

test('repository Markdown does not invoke the unrelated ecc package', () => {
  const offenders = [];

  for (const filePath of trackedMarkdownFiles(repoRoot)) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of unrelatedEccPackageLines(content)) {
      offenders.push(`${path.relative(repoRoot, filePath)}: ${line}`);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `Replace npx ecc commands with npx ecc-universal: ${offenders.join(', ')}`
  );
});

test('repository Markdown does not execute the unpublished ecc-install package', () => {
  const offenders = [];

  for (const filePath of trackedMarkdownFiles(repoRoot)) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of executableLegacyInstallerLines(content)) {
      offenders.push(`${path.relative(repoRoot, filePath)}: ${line}`);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `Replace executable npx ecc-install commands with npx ecc-universal install: ${offenders.join(', ')}`
  );
});

for (const relativePath of pluginAndManualInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} warns not to run the full installer after plugin install`, () => {
    assert.ok(
      content.includes('--profile full'),
      'Expected docs to mention the full installer explicitly'
    );
    assert.ok(
      content.includes('/plugin install'),
      'Expected docs to mention plugin install explicitly'
    );
    assert.ok(
      content.includes('不要再运行')
      || content.includes('do not run'),
      'Expected docs to warn that plugin install and full install are not sequential'
    );
  });
}

for (const relativePath of publicCommandNamespaceDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} uses the canonical plugin command namespace`, () => {
    assert.ok(
      !content.includes('/everything-claude-code:'),
      'Expected docs not to advertise the overlong legacy plugin command namespace'
    );
    assert.ok(
      content.includes('/ecc:plan'),
      'Expected docs to show the short plugin command namespace'
    );
  });
}

for (const relativePath of manualClaudeSkillInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} keeps manual Claude skill installs top-level`, () => {
    assert.ok(
      !/^\s*#?\s*(mkdir\s+-p|md\s+.*|cp\s+.*|copy\s+.*|cpi\s+.*|New-Item\s+.*|Copy-Item\s+.*)\s+.*(~|\$HOME)[\\/]\.claude[\\/]skills[\\/]ecc([\\/]|\b)/mi.test(content),
      'Claude Code does not discover skills installed by commands targeting ~/.claude/skills/ecc'
    );
    assert.ok(
      content.includes('~/.claude/skills/'),
      'Expected manual install docs to copy skills into direct ~/.claude/skills children'
    );
  });
}

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
