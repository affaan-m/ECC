'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

const configureEccDocs = [
  'skills/configure-ecc/SKILL.md',
  'docs/zh-CN/skills/configure-ecc/SKILL.md',
  'docs/ja-JP/skills/configure-ecc/SKILL.md',
];

const localizedWizardContract = {
  'skills/configure-ecc/SKILL.md': [
    'Ask exactly one scope question',
    'Ask exactly one hook-mode question',
    'Show exactly one confirmation summary',
  ],
  'docs/zh-CN/skills/configure-ecc/SKILL.md': [
    '只询问一次安装范围',
    '只询问一次 Hook 模式',
    '只显示一次确认摘要',
  ],
  'docs/ja-JP/skills/configure-ecc/SKILL.md': [
    'スコープについて 1 回だけ質問',
    'フックモードについて 1 回だけ質問',
    '確認サマリーは 1 回だけ表示',
  ],
};

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

function readConfigureEccDoc(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function countEntries(relativePath, predicate) {
  return fs.readdirSync(path.join(repoRoot, relativePath), { withFileTypes: true })
    .filter(predicate)
    .length;
}

console.log('\n=== Testing configure-ecc install path guidance ===\n');

for (const relativePath of configureEccDocs) {
  test(`${relativePath} delegates to guided plugin setup`, () => {
    const content = readConfigureEccDoc(relativePath);

    assert.ok(content.includes('ecc setup'));
    assert.ok(content.includes('npx ecc-universal setup'));
    assert.ok(content.includes('--mode claude-plugin'));
    assert.ok(content.includes('--scope <scope>'));
    assert.ok(content.includes('--hooks <hooks>'));
    assert.ok(content.includes('--move-scope'));
    assert.ok(!content.includes('rm -rf /tmp/everything-claude-code'));
    assert.ok(!content.includes('cp -R "$ECC_ROOT'));
  });

  test(`${relativePath} defines the Claude in-harness wizard contract`, () => {
    const content = readConfigureEccDoc(relativePath);

    for (const instruction of localizedWizardContract[relativePath]) {
      assert.ok(content.includes(instruction), `missing: ${instruction}`);
    }
    assert.ok(content.includes('claude plugin list --json'));
    assert.ok(content.includes('user | project | local'));
    assert.ok(content.includes('off | minimal | standard | strict'));
    assert.ok(content.includes('$CLAUDE_PLUGIN_ROOT'));
    assert.ok(content.includes('scripts/setup.js'));
    assert.ok(content.includes('--yes --json'));
    assert.ok(content.includes('<installed-version>'));
    assert.ok(content.includes('ECC_VERSION_PATTERN'));
    assert.ok(content.includes('argument array'));
  });

  test(`${relativePath} verifies before showing the welcome`, () => {
    const content = readConfigureEccDoc(relativePath);
    const applyIndex = content.indexOf('--yes --json');
    const verificationIndex = content.indexOf('claude plugin list --json', applyIndex);
    const welcomeIndex = content.indexOf('renderTerminalWelcome');

    assert.ok(applyIndex > -1, 'missing non-interactive apply command');
    assert.ok(verificationIndex > -1, 'missing post-setup plugin verification');
    assert.ok(welcomeIndex > verificationIndex, 'welcome must follow verification');
  });

  test(`${relativePath} keeps provider capabilities truthful`, () => {
    const content = readConfigureEccDoc(relativePath);

    assert.ok(content.includes('codex plugin add ecc@ecc --json'));
    assert.ok(content.includes('Codex'));
    assert.ok(content.includes('.kimi-code'));
    assert.ok(content.includes('--target kimi'));
    assert.ok(content.includes('hooks=unsupported'));
  });

  test(`${relativePath} verifies Codex and Kimi before their concrete welcomes`, () => {
    const content = readConfigureEccDoc(relativePath);
    const codexVerifyIndex = content.indexOf('codex plugin list --json');
    const codexWelcomeIndex = content.indexOf(
      '["<installedPath>/scripts/welcome.js", "--action", "configured", "--version", "<installed-version>"]'
    );
    const kimiVerifyIndex = content.indexOf('ecc doctor --target kimi');
    const kimiWelcomeIndex = content.indexOf('ecc welcome --action configured');

    assert.ok(codexVerifyIndex > -1, 'missing Codex verification');
    assert.ok(codexWelcomeIndex > codexVerifyIndex, 'Codex welcome must follow verification');
    assert.ok(
      content.includes('argument array'),
      'Codex welcome must use an executable plus argument array'
    );
    assert.ok(
      !content.includes('node "<installedPath>/scripts/welcome.js"'),
      'Codex JSON values must not be shown in a shell command'
    );
    assert.ok(kimiVerifyIndex > -1, 'missing Kimi verification');
    assert.ok(kimiWelcomeIndex > kimiVerifyIndex, 'Kimi welcome must follow verification');
  });
}

test('Codex legacy sync docs do not require an unrelated package install', () => {
  const content = readConfigureEccDoc('.codex-plugin/README.md');

  assert.ok(content.includes('bash scripts/sync-ecc-to-codex.sh'));
  assert.ok(!content.includes('npm install && bash scripts/sync-ecc-to-codex.sh'));
});

test('Kimi docs scope hooks and compatibility to the verified adapter', () => {
  const content = readConfigureEccDoc('.kimi/README.md');

  assert.ok(content.includes('verified against Kimi Code 0.31.x'));
  assert.ok(content.includes("newer provider releases are outside this adapter's verified range"));
  assert.ok(content.includes('does not configure or map provider lifecycle hooks'));
  assert.ok(!content.includes('Kimi Code 0.31.x does not expose'));
});

test('Turkish agent instructions report the live catalog counts', () => {
  const content = readConfigureEccDoc('docs/tr/AGENTS.md');
  const agentCount = countEntries('agents', entry => entry.isFile() && entry.name.endsWith('.md'));
  const skillCount = countEntries('skills', entry => entry.isDirectory());
  const commandCount = countEntries(
    'commands',
    entry => entry.isFile() && entry.name.endsWith('.md')
  );

  assert.ok(content.includes(`${agentCount} özel agent`));
  assert.ok(content.includes(`${skillCount} skill`));
  assert.ok(content.includes(`${commandCount} command`));
  assert.ok(content.includes(`agents/          — ${agentCount} özel subagent`));
  assert.ok(content.includes(`skills/          — ${skillCount} iş akışı`));
  assert.ok(content.includes(`commands/        — ${commandCount} slash command`));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
