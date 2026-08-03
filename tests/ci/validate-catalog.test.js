/**
 * Tests for catalog.js — README/AGENTS/plugin manifest count consistency.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-catalog.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { test, createTestDir, cleanupTestDir, runValidatorWithDir, runCatalogValidator, writeCatalogFixture, finish } = require('./validator-test-utils');

console.log('\ncatalog.js:');

test('passes on real project catalog counts', () => {
  const result = runCatalogValidator();
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Documentation counts match the repository catalog.'), 'Should report matching counts');
});

test('fails when README and AGENTS catalog counts drift', () => {
  const testDir = createTestDir();
  const { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, zhAgentsPath, pluginJsonPath, marketplaceJsonPath } = writeCatalogFixture(testDir, {
    readmeCounts: { agents: 99, skills: 99, commands: 99 },
    readmeTableCounts: { agents: 99, skills: 99, commands: 99 },
    readmeParityCounts: { agents: 99, skills: 99, commands: 99 },
    summaryCounts: { agents: 99, skills: 99, commands: 99 },
    structureLines: ['agents/          — 99 specialized subagents', 'skills/          — 99 workflow skills and domain knowledge', 'commands/        — 99 slash commands'],
    zhRootReadmeCounts: { agents: 99, skills: 99, commands: 99 },
    zhDocsReadmeCounts: { agents: 99, skills: 99, commands: 99 },
    zhDocsTableCounts: { agents: 99, skills: 99, commands: 99 },
    zhDocsParityCounts: { agents: 99, skills: 99, commands: 99 },
    zhAgentsSummaryCounts: { agents: 99, skills: 99, commands: 99 },
    zhAgentsStructureLines: ['agents/          — 99 个专业子代理', 'skills/          — 99 个工作流技能和领域知识', 'commands/        — 99 个斜杠命令']
  });

  const result = runCatalogValidator({
    ROOT: testDir,
    README_PATH: readmePath,
    AGENTS_PATH: agentsPath,
    README_ZH_CN_PATH: zhRootReadmePath,
    DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
    DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
    PLUGIN_JSON_PATH: pluginJsonPath,
    MARKETPLACE_JSON_PATH: marketplaceJsonPath
  });

  assert.strictEqual(result.code, 1, 'Should fail when catalog counts drift');
  assert.ok((result.stdout + result.stderr).includes('Documentation count mismatches found:'), 'Should report mismatches');
  cleanupTestDir(testDir);
});

test('fails when README parity table counts drift', () => {
  const testDir = createTestDir();
  const { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, zhAgentsPath, pluginJsonPath, marketplaceJsonPath } = writeCatalogFixture(testDir, {
    readmeCounts: { agents: 1, skills: 1, commands: 1 },
    readmeTableCounts: { agents: 1, skills: 1, commands: 1 },
    readmeParityCounts: { agents: 9, skills: 8, commands: 7 },
    summaryCounts: { agents: 1, skills: 1, commands: 1 }
  });

  const result = runCatalogValidator({
    ROOT: testDir,
    README_PATH: readmePath,
    AGENTS_PATH: agentsPath,
    README_ZH_CN_PATH: zhRootReadmePath,
    DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
    DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
    PLUGIN_JSON_PATH: pluginJsonPath,
    MARKETPLACE_JSON_PATH: marketplaceJsonPath
  });

  assert.strictEqual(result.code, 1, 'Should fail when README parity table drifts');
  assert.ok((result.stdout + result.stderr).includes('README.md parity table'), 'Should mention the README parity table mismatch');
  cleanupTestDir(testDir);
});

test('fails when a tracked catalog document is missing', () => {
  const testDir = createTestDir();
  const { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, pluginJsonPath, marketplaceJsonPath } = writeCatalogFixture(testDir);
  const missingZhAgentsPath = path.join(testDir, 'docs', 'zh-CN', 'AGENTS.md');
  fs.rmSync(missingZhAgentsPath);

  const result = runCatalogValidator({
    ROOT: testDir,
    README_PATH: readmePath,
    AGENTS_PATH: agentsPath,
    README_ZH_CN_PATH: zhRootReadmePath,
    DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
    DOCS_ZH_CN_AGENTS_PATH: missingZhAgentsPath,
    PLUGIN_JSON_PATH: pluginJsonPath,
    MARKETPLACE_JSON_PATH: marketplaceJsonPath
  });

  assert.strictEqual(result.code, 1, 'Should fail when a tracked doc is missing');
  assert.ok((result.stdout + result.stderr).includes('Failed to read AGENTS.md'), 'Should mention the missing tracked document');
  cleanupTestDir(testDir);
});

function assertEnglishDocsSynced(readme, agentsDoc) {
  assert.ok(readme.includes('Access to 1 agents, 1 skills, and 1 legacy command shims'), 'Should sync README quick-start summary');
  assert.ok(readme.includes('actual OSS surface: 9 agents, 9 skills, and 9 legacy command shims'), 'Should preserve historical README release-note summary');
  assert.ok(readme.includes('|-- agents/           # 1 specialized subagents for delegation'), 'Should sync README project tree agents count');
  assert.ok(readme.includes('| Agents | PASS: 1 agents |'), 'Should sync README comparison table');
  assert.ok(readme.includes('| Skills | 16 | .agents/skills/ |'), 'Should not rewrite unrelated README tables');
  assert.ok(readme.includes('| **Agents** | 1 | Shared (AGENTS.md) | Shared (AGENTS.md) | 12 |'), 'Should sync README parity table');
  assert.ok(agentsDoc.includes('providing 1 specialized agents, 1 skills, 1 commands'), 'Should sync AGENTS summary');
  assert.ok(agentsDoc.includes('skills/          — 1 workflow skills and domain knowledge'), 'Should sync AGENTS structure');
}

function assertChineseDocsSynced(zhRootReadme, zhDocsReadme, zhAgentsDoc) {
  assert.ok(zhRootReadme.includes('你现在可以使用 1 个代理、1 个技能和 1 个命令'), 'Should sync README.zh-CN quick-start summary');
  assert.ok(zhDocsReadme.includes('你现在可以使用 1 个智能体、1 项技能和 1 个命令了'), 'Should sync docs/zh-CN/README quick-start summary');
  assert.ok(zhDocsReadme.includes('| 智能体 | \u2705 1 个 |'), 'Should sync docs/zh-CN/README comparison table');
  assert.ok(zhDocsReadme.includes('| 技能 | 16 | .agents/skills/ |'), 'Should not rewrite unrelated docs/zh-CN/README tables');
  assert.ok(zhDocsReadme.includes('| **智能体** | 1 | 共享 (AGENTS.md) | 共享 (AGENTS.md) | 12 |'), 'Should sync docs/zh-CN/README parity table');
  assert.ok(zhAgentsDoc.includes('提供 1 个专业代理、1 项技能、1 条命令'), 'Should sync docs/zh-CN/AGENTS summary');
  assert.ok(zhAgentsDoc.includes('commands/        — 1 个斜杠命令'), 'Should sync docs/zh-CN/AGENTS structure');
}

test('syncs tracked catalog docs in write mode without rewriting unrelated tables', () => {
  const testDir = createTestDir();
  const { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, zhAgentsPath, pluginJsonPath, marketplaceJsonPath } = writeCatalogFixture(testDir, {
    readmeCounts: { agents: 9, skills: 9, commands: 9 },
    readmeTableCounts: { agents: 8, skills: 8, commands: 8 },
    readmeParityCounts: { agents: 7, skills: 7, commands: 7 },
    summaryCounts: { agents: 6, skills: 6, commands: 6 },
    zhRootReadmeCounts: { agents: 10, skills: 10, commands: 10 },
    zhDocsReadmeCounts: { agents: 11, skills: 11, commands: 11 },
    zhDocsTableCounts: { agents: 12, skills: 12, commands: 12 },
    zhDocsParityCounts: { agents: 13, skills: 13, commands: 13 },
    zhAgentsSummaryCounts: { agents: 14, skills: 14, commands: 14 },
    pluginCounts: { agents: 18, skills: 18, commands: 18 },
    marketplaceCounts: { agents: 19, skills: 19, commands: 19 },
    zhAgentsStructureLines: ['agents/          — 15 个专业子代理', 'skills/          — 16 个工作流技能和领域知识', 'commands/        — 17 个斜杠命令']
  });

  const result = runCatalogValidator({
    argv: ['--write', '--text'],
    ROOT: testDir,
    README_PATH: readmePath,
    AGENTS_PATH: agentsPath,
    README_ZH_CN_PATH: zhRootReadmePath,
    DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
    DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
    PLUGIN_JSON_PATH: pluginJsonPath,
    MARKETPLACE_JSON_PATH: marketplaceJsonPath
  });

  assert.strictEqual(result.code, 0, `Should sync and pass, got stderr: ${result.stderr}`);

  const pluginJson = fs.readFileSync(pluginJsonPath, 'utf8');
  const marketplaceJson = fs.readFileSync(marketplaceJsonPath, 'utf8');

  assertEnglishDocsSynced(fs.readFileSync(readmePath, 'utf8'), fs.readFileSync(agentsPath, 'utf8'));
  assertChineseDocsSynced(fs.readFileSync(zhRootReadmePath, 'utf8'), fs.readFileSync(zhDocsReadmePath, 'utf8'), fs.readFileSync(zhAgentsPath, 'utf8'));
  assert.ok(pluginJson.includes('1 agents, 1 skills, 1 legacy command shims'), 'Should sync plugin manifest catalog description');
  assert.ok(marketplaceJson.includes('1 agents, 1 skills, 1 legacy command shims'), 'Should sync marketplace plugin catalog description');

  cleanupTestDir(testDir);
});

test('accepts AGENTS project structure entries with varied spacing and dash styles', () => {
  const testDir = createTestDir();
  const { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, zhAgentsPath, pluginJsonPath, marketplaceJsonPath } = writeCatalogFixture(testDir, {
    structureLines: ['  agents/   -   1 specialized subagents   ', '\tskills/\t–\t1+ workflow skills and domain knowledge\t', ' commands/ — 1 slash commands '],
    zhAgentsStructureLines: ['  agents/   -   1 个专业子代理   ', '\tskills/\t–\t1+ 个工作流技能和领域知识\t', ' commands/ — 1 个斜杠命令 ']
  });

  const result = runCatalogValidator({
    ROOT: testDir,
    README_PATH: readmePath,
    AGENTS_PATH: agentsPath,
    README_ZH_CN_PATH: zhRootReadmePath,
    DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
    DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
    PLUGIN_JSON_PATH: pluginJsonPath,
    MARKETPLACE_JSON_PATH: marketplaceJsonPath
  });

  assert.strictEqual(result.code, 0, `Should accept formatting variations, got stderr: ${result.stderr}`);
  cleanupTestDir(testDir);
});

test('exits 0 when hooks.json does not exist', () => {
  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', '/nonexistent/hooks.json');
  assert.strictEqual(result.code, 0, 'Should skip when no hooks.json');
});

test('fails on invalid JSON', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, '{ not valid json }}}');

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on invalid JSON');
  assert.ok(result.stderr.includes('Invalid JSON'), 'Should report invalid JSON');
  cleanupTestDir(testDir);
});

test('fails on invalid event type', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        InvalidEventType: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo hi' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on invalid event type');
  assert.ok(result.stderr.includes('Invalid event type'), 'Should report invalid event type');
  cleanupTestDir(testDir);
});

test('fails on hook entry missing type field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ command: 'echo hi' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing type');
  assert.ok(result.stderr.includes('type'), 'Should report missing type');
  cleanupTestDir(testDir);
});

test('fails on hook entry missing command field', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing command');
  assert.ok(result.stderr.includes('command'), 'Should report missing command');
  cleanupTestDir(testDir);
});

test('fails on invalid async field type', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', async: 'yes' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on non-boolean async');
  assert.ok(result.stderr.includes('async'), 'Should report async type error');
  cleanupTestDir(testDir);
});

test('fails on negative timeout', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', timeout: -5 }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on negative timeout');
  assert.ok(result.stderr.includes('timeout'), 'Should report timeout error');
  cleanupTestDir(testDir);
});

test('fails on invalid inline JS syntax', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "function {"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on invalid inline JS');
  assert.ok(result.stderr.includes('invalid inline JS'), 'Should report JS syntax error');
  cleanupTestDir(testDir);
});

test('passes valid inline JS commands', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "console.log(1+2)"' }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should pass valid inline JS');
  cleanupTestDir(testDir);
});

test('validates array command format', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', '-e', 'console.log(1)'] }] }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept array command format');
  cleanupTestDir(testDir);
});

test('validates legacy array format', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(hooksFile, JSON.stringify([{ matcher: 'test', hooks: [{ type: 'command', command: 'echo ok' }] }]));

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 0, 'Should accept legacy array format');
  cleanupTestDir(testDir);
});

test('fails on matcher missing hooks array', () => {
  const testDir = createTestDir();
  const hooksFile = path.join(testDir, 'hooks.json');
  fs.writeFileSync(
    hooksFile,
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test' }]
      }
    })
  );

  const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
  assert.strictEqual(result.code, 1, 'Should fail on missing hooks array');
  cleanupTestDir(testDir);
});

finish();
