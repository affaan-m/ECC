/**
 * Tests for CI validator scripts
 *
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validators.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const validatorsDir = path.join(__dirname, '..', '..', 'scripts', 'ci');
const repoRoot = path.join(__dirname, '..', '..');
const modulesSchemaPath = path.join(repoRoot, 'schemas', 'install-modules.schema.json');
const profilesSchemaPath = path.join(repoRoot, 'schemas', 'install-profiles.schema.json');
const componentsSchemaPath = path.join(repoRoot, 'schemas', 'install-components.schema.json');

// Test helpers
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ci-validator-test-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeInstallComponentsManifest(testDir, components) {
  writeJson(path.join(testDir, 'manifests', 'install-components.json'), {
    version: 1,
    components,
  });
}

function stripShebang(source) {
  let s = source;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  return s;
}

/**
 * Run modified source via a temp file (avoids Windows node -e shebang issues).
 * The temp file is written inside the repo so require() can resolve node_modules.
 * @param {string} source - JavaScript source to execute
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runSourceViaTempFile(source) {
  const tmpFile = path.join(repoRoot, `.tmp-validator-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, source, 'utf8');
    const stdout = execFileSync('node', [tmpFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
  }
}

/**
 * Run a validator script via a wrapper that overrides its directory constant.
 * This allows testing error cases without modifying real project files.
 *
 * @param {string} validatorName - e.g., 'validate-agents'
 * @param {string} dirConstant - the constant name to override (e.g., 'AGENTS_DIR')
 * @param {string} overridePath - the temp directory to use
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runValidatorWithDir(validatorName, dirConstant, overridePath) {
  const validatorPath = path.join(validatorsDir, `${validatorName}.js`);

  // Read the validator source, replace the directory constant, and run as a wrapper
  let source = fs.readFileSync(validatorPath, 'utf8');

  // Remove the shebang line so wrappers also work against CRLF-checked-out files on Windows.
  source = stripShebang(source);

  // Replace the directory constant with our override path
  const dirRegex = new RegExp(`const ${dirConstant} = .*?;`);
  source = source.replace(dirRegex, `const ${dirConstant} = ${JSON.stringify(overridePath)};`);

  return runSourceViaTempFile(source);
}

/**
 * Run a validator script with multiple directory overrides.
 * @param {string} validatorName
 * @param {Record<string, string>} overrides - map of constant name to path
 */
function runValidatorWithDirs(validatorName, overrides) {
  const validatorPath = path.join(validatorsDir, `${validatorName}.js`);
  let source = fs.readFileSync(validatorPath, 'utf8');
  source = stripShebang(source);
  for (const [constant, overridePath] of Object.entries(overrides)) {
    const dirRegex = new RegExp(`const ${constant} = .*?;`);
    source = source.replace(dirRegex, `const ${constant} = ${JSON.stringify(overridePath)};`);
  }
  return runSourceViaTempFile(source);
}

/**
 * Run a validator script directly (tests real project)
 */
function runValidator(validatorName) {
  const validatorPath = path.join(validatorsDir, `${validatorName}.js`);
  try {
    const stdout = execFileSync('node', [validatorPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

function runCatalogValidator(overrides = {}) {
  const validatorPath = path.join(validatorsDir, 'catalog.js');
  let source = fs.readFileSync(validatorPath, 'utf8');
  source = stripShebang(source);
  const argv = Array.isArray(overrides.argv) && overrides.argv.length > 0
    ? overrides.argv
    : ['--text'];
  const argvPreamble = argv.map(arg => `process.argv.push(${JSON.stringify(arg)});`).join('\n');
  source = `${argvPreamble}\n${source}`;

  const resolvedOverrides = {
    ROOT: repoRoot,
    README_PATH: path.join(repoRoot, 'README.md'),
    AGENTS_PATH: path.join(repoRoot, 'AGENTS.md'),
    README_ZH_CN_PATH: path.join(repoRoot, 'README.zh-CN.md'),
    DOCS_ZH_CN_README_PATH: path.join(repoRoot, 'docs', 'zh-CN', 'README.md'),
    DOCS_ZH_CN_AGENTS_PATH: path.join(repoRoot, 'docs', 'zh-CN', 'AGENTS.md'),
    PLUGIN_JSON_PATH: path.join(repoRoot, '.claude-plugin', 'plugin.json'),
    MARKETPLACE_JSON_PATH: path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
    ...overrides,
  };

  for (const [constant, overridePath] of Object.entries(resolvedOverrides)) {
    const dirRegex = new RegExp(`const ${constant} = .*?;`);
    source = source.replace(dirRegex, `const ${constant} = ${JSON.stringify(overridePath)};`);
  }

  return runSourceViaTempFile(source);
}

// Run validate-skills.js against a fixture dir, optionally passing
// extra argv (e.g. '--strict') and env overrides (e.g.
// CI_STRICT_SKILLS=1) so the frontmatter finding suite can exercise
// both warn and strict modes via argv and env code paths.
//
// Captures stderr on both success and failure (the shared
// runSourceViaTempFile helper only surfaces stderr when the child
// exits non-zero, which hides WARN lines in the default mode).
function runSkillsValidator(testDir, argv = [], envOverrides = {}) {
  const validatorPath = path.join(validatorsDir, 'validate-skills.js');
  let source = fs.readFileSync(validatorPath, 'utf8');
  source = stripShebang(source);
  source = source.replace(
    /const SKILLS_DIR = .*?;/,
    `const SKILLS_DIR = ${JSON.stringify(testDir)};`,
  );
  if (argv.length > 0) {
    const argvPreamble = argv
      .map(arg => `process.argv.push(${JSON.stringify(arg)});`)
      .join('\n');
    source = `${argvPreamble}\n${source}`;
  }
  const tmpFile = path.join(repoRoot,
    `.tmp-validator-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, source, 'utf8');
    const r = spawnSync('node', [tmpFile], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: repoRoot,
      env: { ...process.env, CI_STRICT_SKILLS: '', ...envOverrides },
    });
    return {
      code: typeof r.status === 'number' ? r.status : 1,
      stdout: r.stdout || '',
      stderr: r.stderr || '',
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

function writeCatalogFixture(testDir, options = {}) {
  const {
    readmeCounts = { agents: 1, skills: 1, commands: 1 },
    readmeProjectTreeAgents = readmeCounts.agents,
    readmeTableCounts = readmeCounts,
    readmeParityCounts = readmeCounts,
    readmeUnrelatedSkillsCount = 16,
    summaryCounts = { agents: 1, skills: 1, commands: 1 },
    structureLines = [
      'agents/          — 1 specialized subagents',
      'skills/          — 1 workflow skills and domain knowledge',
      'commands/        — 1 slash commands',
    ],
    zhRootReadmeCounts = { agents: 1, skills: 1, commands: 1 },
    zhDocsReadmeCounts = { agents: 1, skills: 1, commands: 1 },
    zhDocsTableCounts = zhDocsReadmeCounts,
    zhDocsParityCounts = zhDocsReadmeCounts,
    zhDocsUnrelatedSkillsCount = 16,
    zhAgentsSummaryCounts = { agents: 1, skills: 1, commands: 1 },
    zhAgentsStructureLines = [
      'agents/          — 1 个专业子代理',
      'skills/          — 1 个工作流技能和领域知识',
      'commands/        — 1 个斜杠命令',
    ],
    pluginCounts = { agents: 1, skills: 1, commands: 1 },
    marketplaceCounts = { agents: 1, skills: 1, commands: 1 },
  } = options;

  const readmePath = path.join(testDir, 'README.md');
  const agentsPath = path.join(testDir, 'AGENTS.md');
  const zhRootReadmePath = path.join(testDir, 'README.zh-CN.md');
  const zhDocsReadmePath = path.join(testDir, 'docs', 'zh-CN', 'README.md');
  const zhAgentsPath = path.join(testDir, 'docs', 'zh-CN', 'AGENTS.md');
  const pluginJsonPath = path.join(testDir, '.claude-plugin', 'plugin.json');
  const marketplaceJsonPath = path.join(testDir, '.claude-plugin', 'marketplace.json');

  fs.mkdirSync(path.join(testDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'skills', 'demo-skill'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'docs', 'zh-CN'), { recursive: true });
  fs.mkdirSync(path.join(testDir, '.claude-plugin'), { recursive: true });

  fs.writeFileSync(path.join(testDir, 'agents', 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# Planner');
  fs.writeFileSync(path.join(testDir, 'commands', 'plan.md'), '---\ndescription: Plan\n---\n# Plan');
  fs.writeFileSync(path.join(testDir, 'skills', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo skill\norigin: ECC\n---\n# Demo Skill');

  fs.writeFileSync(readmePath, `Access to ${readmeCounts.agents} agents, ${readmeCounts.skills} skills, and ${readmeCounts.commands} commands.\n- **Public surface synced to the live repo** - metadata, catalog counts, plugin manifests, and install-facing docs now match the actual OSS surface: ${readmeCounts.agents} agents, ${readmeCounts.skills} skills, and ${readmeCounts.commands} legacy command shims.\n|-- agents/           # ${readmeProjectTreeAgents} specialized subagents for delegation\n| Feature | Claude Code | Cursor IDE | Codex CLI | OpenCode |\n|---------|------------|------------|-----------|----------|\n| Agents | PASS: ${readmeTableCounts.agents} agents | Shared | Shared | 1 |\n| Commands | PASS: ${readmeTableCounts.commands} commands | Shared | Shared | 1 |\n| Skills | PASS: ${readmeTableCounts.skills} skills | Shared | Shared | 1 |\n\n| Feature | Count | Format |\n|-----------|-------|---------|\n| Skills | ${readmeUnrelatedSkillsCount} | .agents/skills/ |\n\n## Cross-Tool Feature Parity\n\n| Feature | Claude Code | Cursor IDE | Codex CLI | OpenCode |\n|---------|------------|------------|-----------|----------|\n| **Agents** | ${readmeParityCounts.agents} | Shared (AGENTS.md) | Shared (AGENTS.md) | 12 |\n| **Commands** | ${readmeParityCounts.commands} | Shared | Instruction-based | 31 |\n| **Skills** | ${readmeParityCounts.skills} | Shared | 10 (native format) | 37 |\n`);
  fs.writeFileSync(agentsPath, `This is a **production-ready AI coding plugin** providing ${summaryCounts.agents} specialized agents, ${summaryCounts.skills} skills, ${summaryCounts.commands} commands, and automated hook workflows for software development.\n\n\`\`\`\n${structureLines.join('\n')}\n\`\`\`\n`);
  fs.writeFileSync(zhRootReadmePath, `**完成！** 你现在可以使用 ${zhRootReadmeCounts.agents} 个代理、${zhRootReadmeCounts.skills} 个技能和 ${zhRootReadmeCounts.commands} 个命令。\n`);
  fs.writeFileSync(zhDocsReadmePath, `**搞定！** 你现在可以使用 ${zhDocsReadmeCounts.agents} 个智能体、${zhDocsReadmeCounts.skills} 项技能和 ${zhDocsReadmeCounts.commands} 个命令了。\n| 功能特性 | Claude Code | OpenCode | 状态 |\n|---------|-------------|----------|--------|\n| 智能体 | \u2705 ${zhDocsTableCounts.agents} 个 | \u2705 12 个 | **Claude Code 领先** |\n| 命令 | \u2705 ${zhDocsTableCounts.commands} 个 | \u2705 31 个 | **Claude Code 领先** |\n| 技能 | \u2705 ${zhDocsTableCounts.skills} 项 | \u2705 37 项 | **Claude Code 领先** |\n\n| 功能特性 | 数量 | 格式 |\n|-----------|-------|---------|\n| 技能 | ${zhDocsUnrelatedSkillsCount} | .agents/skills/ |\n\n## 跨工具功能对等\n\n| 功能特性 | Claude Code | Cursor IDE | Codex CLI | OpenCode |\n|---------|------------|------------|-----------|----------|\n| **智能体** | ${zhDocsParityCounts.agents} | 共享 (AGENTS.md) | 共享 (AGENTS.md) | 12 |\n| **命令** | ${zhDocsParityCounts.commands} | 共享 | 基于指令 | 31 |\n| **技能** | ${zhDocsParityCounts.skills} | 共享 | 10 (原生格式) | 37 |\n`);
  fs.writeFileSync(zhAgentsPath, `这是一个**生产就绪的 AI 编码插件**，提供 ${zhAgentsSummaryCounts.agents} 个专业代理、${zhAgentsSummaryCounts.skills} 项技能、${zhAgentsSummaryCounts.commands} 条命令以及自动化钩子工作流，用于软件开发。\n\n\`\`\`\n${zhAgentsStructureLines.join('\n')}\n\`\`\`\n`);
  fs.writeFileSync(pluginJsonPath, JSON.stringify({
    name: 'ecc',
    description: `Battle-tested plugin — ${pluginCounts.agents} agents, ${pluginCounts.skills} skills, ${pluginCounts.commands} legacy command shims`,
  }, null, 2));
  fs.writeFileSync(marketplaceJsonPath, JSON.stringify({
    plugins: [{
      name: 'ecc',
      description: `Marketplace plugin — ${marketplaceCounts.agents} agents, ${marketplaceCounts.skills} skills, ${marketplaceCounts.commands} legacy command shims`,
    }],
  }, null, 2));

  return { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, zhAgentsPath, pluginJsonPath, marketplaceJsonPath };
}

function runTests() {
  console.log('\n=== Testing CI Validators ===\n');

  let passed = 0;
  let failed = 0;

  // ==========================================
  // validate-agents.js
  // ==========================================
  console.log('validate-agents.js:');

  if (test('strips CRLF shebangs before writing temp wrappers', () => {
    const source = '#!/usr/bin/env node\r\nconsole.log("ok");';
    assert.strictEqual(stripShebang(source), 'console.log("ok");');
  })) passed++; else failed++;

  if (test('passes on real project agents', () => {
    const result = runValidator('validate-agents');
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
  })) passed++; else failed++;

  if (test('fails on agent without frontmatter', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'bad-agent.md'), '# No frontmatter here\nJust content.');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should exit 1 for missing frontmatter');
    assert.ok(result.stderr.includes('Missing frontmatter'), 'Should report missing frontmatter');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on agent missing required model field', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'no-model.md'), '---\ntools: Read, Write\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should exit 1 for missing model');
    assert.ok(result.stderr.includes('model'), 'Should report missing model field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on agent missing required tools field', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'no-tools.md'), '---\nmodel: sonnet\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should exit 1 for missing tools');
    assert.ok(result.stderr.includes('tools'), 'Should report missing tools field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('passes on valid agent with all required fields', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'good-agent.md'), '---\nmodel: sonnet\ntools: Read, Write\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass for valid agent');
    assert.ok(result.stdout.includes('Validated 1'), 'Should report 1 validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles frontmatter with BOM and CRLF', () => {
    const testDir = createTestDir();
    const content = '\uFEFF---\r\nmodel: sonnet\r\ntools: Read, Write\r\n---\r\n# Agent';
    fs.writeFileSync(path.join(testDir, 'bom-agent.md'), content);

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should handle BOM and CRLF');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles frontmatter with colons in values', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'colon-agent.md'), '---\nmodel: sonnet\ntools: Read, Write, Bash\ndescription: Run this: always check: everything\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should handle colons in values');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('skips non-md files', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'readme.txt'), 'Not an agent');
    fs.writeFileSync(path.join(testDir, 'valid.md'), '---\nmodel: sonnet\ntools: Read\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should only validate .md files');
    assert.ok(result.stdout.includes('Validated 1'), 'Should count only .md files');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('exits 0 when directory does not exist', () => {
    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', '/nonexistent/dir');
    assert.strictEqual(result.code, 0, 'Should skip when no agents dir');
    assert.ok(result.stdout.includes('skipping'), 'Should say skipping');
  })) passed++; else failed++;

  if (test('rejects agent with empty model value', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'empty.md'), '---\nmodel:\ntools: Read, Write\n---\n# Empty model');
    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject empty model');
    assert.ok(result.stderr.includes('model'), 'Should mention model field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects agent with empty tools value', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'empty.md'), '---\nmodel: claude-sonnet-4-5-20250929\ntools:\n---\n# Empty tools');
    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject empty tools');
    assert.ok(result.stderr.includes('tools'), 'Should mention tools field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ==========================================
  // validate-hooks.js
  // ==========================================
  console.log('\nvalidate-hooks.js:');

  if (test('passes on real project hooks.json', () => {
    const result = runValidator('validate-hooks');
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
  })) passed++; else failed++;

  // ==========================================
  // catalog.js
  // ==========================================
  console.log('\ncatalog.js:');

  if (test('passes on real project catalog counts', () => {
    const result = runCatalogValidator();
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Documentation counts match the repository catalog.'), 'Should report matching counts');
  })) passed++; else failed++;

  if (test('fails when README and AGENTS catalog counts drift', () => {
    const testDir = createTestDir();
    const {
      readmePath,
      agentsPath,
      zhRootReadmePath,
      zhDocsReadmePath,
      zhAgentsPath,
      pluginJsonPath,
      marketplaceJsonPath,
    } = writeCatalogFixture(testDir, {
      readmeCounts: { agents: 99, skills: 99, commands: 99 },
      readmeTableCounts: { agents: 99, skills: 99, commands: 99 },
      readmeParityCounts: { agents: 99, skills: 99, commands: 99 },
      summaryCounts: { agents: 99, skills: 99, commands: 99 },
      structureLines: [
        'agents/          — 99 specialized subagents',
        'skills/          — 99 workflow skills and domain knowledge',
        'commands/        — 99 slash commands',
      ],
      zhRootReadmeCounts: { agents: 99, skills: 99, commands: 99 },
      zhDocsReadmeCounts: { agents: 99, skills: 99, commands: 99 },
      zhDocsTableCounts: { agents: 99, skills: 99, commands: 99 },
      zhDocsParityCounts: { agents: 99, skills: 99, commands: 99 },
      zhAgentsSummaryCounts: { agents: 99, skills: 99, commands: 99 },
      zhAgentsStructureLines: [
        'agents/          — 99 个专业子代理',
        'skills/          — 99 个工作流技能和领域知识',
        'commands/        — 99 个斜杠命令',
      ],
    });

    const result = runCatalogValidator({
      ROOT: testDir,
      README_PATH: readmePath,
      AGENTS_PATH: agentsPath,
      README_ZH_CN_PATH: zhRootReadmePath,
      DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
      DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
      PLUGIN_JSON_PATH: pluginJsonPath,
      MARKETPLACE_JSON_PATH: marketplaceJsonPath,
    });

    assert.strictEqual(result.code, 1, 'Should fail when catalog counts drift');
    assert.ok((result.stdout + result.stderr).includes('Documentation count mismatches found:'), 'Should report mismatches');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails when README parity table counts drift', () => {
    const testDir = createTestDir();
    const {
      readmePath,
      agentsPath,
      zhRootReadmePath,
      zhDocsReadmePath,
      zhAgentsPath,
      pluginJsonPath,
      marketplaceJsonPath,
    } = writeCatalogFixture(testDir, {
      readmeCounts: { agents: 1, skills: 1, commands: 1 },
      readmeTableCounts: { agents: 1, skills: 1, commands: 1 },
      readmeParityCounts: { agents: 9, skills: 8, commands: 7 },
      summaryCounts: { agents: 1, skills: 1, commands: 1 },
    });

    const result = runCatalogValidator({
      ROOT: testDir,
      README_PATH: readmePath,
      AGENTS_PATH: agentsPath,
      README_ZH_CN_PATH: zhRootReadmePath,
      DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
      DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
      PLUGIN_JSON_PATH: pluginJsonPath,
      MARKETPLACE_JSON_PATH: marketplaceJsonPath,
    });

    assert.strictEqual(result.code, 1, 'Should fail when README parity table drifts');
    assert.ok(
      (result.stdout + result.stderr).includes('README.md parity table'),
      'Should mention the README parity table mismatch'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails when a tracked catalog document is missing', () => {
    const testDir = createTestDir();
    const {
      readmePath,
      agentsPath,
      zhRootReadmePath,
      zhDocsReadmePath,
      pluginJsonPath,
      marketplaceJsonPath,
    } = writeCatalogFixture(testDir);
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
      MARKETPLACE_JSON_PATH: marketplaceJsonPath,
    });

    assert.strictEqual(result.code, 1, 'Should fail when a tracked doc is missing');
    assert.ok(
      (result.stdout + result.stderr).includes('Failed to read AGENTS.md'),
      'Should mention the missing tracked document'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('syncs tracked catalog docs in write mode without rewriting unrelated tables', () => {
    const testDir = createTestDir();
    const {
      readmePath,
      agentsPath,
      zhRootReadmePath,
      zhDocsReadmePath,
      zhAgentsPath,
      pluginJsonPath,
      marketplaceJsonPath,
    } = writeCatalogFixture(testDir, {
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
      zhAgentsStructureLines: [
        'agents/          — 15 个专业子代理',
        'skills/          — 16 个工作流技能和领域知识',
        'commands/        — 17 个斜杠命令',
      ],
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
      MARKETPLACE_JSON_PATH: marketplaceJsonPath,
    });

    assert.strictEqual(result.code, 0, `Should sync and pass, got stderr: ${result.stderr}`);

    const readme = fs.readFileSync(readmePath, 'utf8');
    const agentsDoc = fs.readFileSync(agentsPath, 'utf8');
    const zhRootReadme = fs.readFileSync(zhRootReadmePath, 'utf8');
    const zhDocsReadme = fs.readFileSync(zhDocsReadmePath, 'utf8');
    const zhAgentsDoc = fs.readFileSync(zhAgentsPath, 'utf8');
    const pluginJson = fs.readFileSync(pluginJsonPath, 'utf8');
    const marketplaceJson = fs.readFileSync(marketplaceJsonPath, 'utf8');

    assert.ok(readme.includes('Access to 1 agents, 1 skills, and 1 legacy command shims'), 'Should sync README quick-start summary');
    assert.ok(readme.includes('actual OSS surface: 9 agents, 9 skills, and 9 legacy command shims'), 'Should preserve historical README release-note summary');
    assert.ok(readme.includes('|-- agents/           # 1 specialized subagents for delegation'), 'Should sync README project tree agents count');
    assert.ok(readme.includes('| Agents | PASS: 1 agents |'), 'Should sync README comparison table');
    assert.ok(readme.includes('| Skills | 16 | .agents/skills/ |'), 'Should not rewrite unrelated README tables');
    assert.ok(readme.includes('| **Agents** | 1 | Shared (AGENTS.md) | Shared (AGENTS.md) | 12 |'), 'Should sync README parity table');
    assert.ok(agentsDoc.includes('providing 1 specialized agents, 1 skills, 1 commands'), 'Should sync AGENTS summary');
    assert.ok(agentsDoc.includes('skills/          — 1 workflow skills and domain knowledge'), 'Should sync AGENTS structure');
    assert.ok(zhRootReadme.includes('你现在可以使用 1 个代理、1 个技能和 1 个命令'), 'Should sync README.zh-CN quick-start summary');
    assert.ok(zhDocsReadme.includes('你现在可以使用 1 个智能体、1 项技能和 1 个命令了'), 'Should sync docs/zh-CN/README quick-start summary');
    assert.ok(zhDocsReadme.includes('| 智能体 | \u2705 1 个 |'), 'Should sync docs/zh-CN/README comparison table');
    assert.ok(zhDocsReadme.includes('| 技能 | 16 | .agents/skills/ |'), 'Should not rewrite unrelated docs/zh-CN/README tables');
    assert.ok(zhDocsReadme.includes('| **智能体** | 1 | 共享 (AGENTS.md) | 共享 (AGENTS.md) | 12 |'), 'Should sync docs/zh-CN/README parity table');
    assert.ok(zhAgentsDoc.includes('提供 1 个专业代理、1 项技能、1 条命令'), 'Should sync docs/zh-CN/AGENTS summary');
    assert.ok(zhAgentsDoc.includes('commands/        — 1 个斜杠命令'), 'Should sync docs/zh-CN/AGENTS structure');
    assert.ok(pluginJson.includes('1 agents, 1 skills, 1 legacy command shims'), 'Should sync plugin manifest catalog description');
    assert.ok(marketplaceJson.includes('1 agents, 1 skills, 1 legacy command shims'), 'Should sync marketplace plugin catalog description');

    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts AGENTS project structure entries with varied spacing and dash styles', () => {
    const testDir = createTestDir();
    const {
      readmePath,
      agentsPath,
      zhRootReadmePath,
      zhDocsReadmePath,
      zhAgentsPath,
      pluginJsonPath,
      marketplaceJsonPath,
    } = writeCatalogFixture(testDir, {
      structureLines: [
        '  agents/   -   1 specialized subagents   ',
        '\tskills/\t–\t1+ workflow skills and domain knowledge\t',
        ' commands/ — 1 slash commands ',
      ],
      zhAgentsStructureLines: [
        '  agents/   -   1 个专业子代理   ',
        '\tskills/\t–\t1+ 个工作流技能和领域知识\t',
        ' commands/ — 1 个斜杠命令 ',
      ],
    });

    const result = runCatalogValidator({
      ROOT: testDir,
      README_PATH: readmePath,
      AGENTS_PATH: agentsPath,
      README_ZH_CN_PATH: zhRootReadmePath,
      DOCS_ZH_CN_README_PATH: zhDocsReadmePath,
      DOCS_ZH_CN_AGENTS_PATH: zhAgentsPath,
      PLUGIN_JSON_PATH: pluginJsonPath,
      MARKETPLACE_JSON_PATH: marketplaceJsonPath,
    });

    assert.strictEqual(result.code, 0, `Should accept formatting variations, got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('exits 0 when hooks.json does not exist', () => {
    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', '/nonexistent/hooks.json');
    assert.strictEqual(result.code, 0, 'Should skip when no hooks.json');
  })) passed++; else failed++;

  if (test('fails on invalid JSON', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, '{ not valid json }}}');

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on invalid JSON');
    assert.ok(result.stderr.includes('Invalid JSON'), 'Should report invalid JSON');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on invalid event type', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        InvalidEventType: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo hi' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on invalid event type');
    assert.ok(result.stderr.includes('Invalid event type'), 'Should report invalid event type');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on hook entry missing type field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ command: 'echo hi' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on missing type');
    assert.ok(result.stderr.includes('type'), 'Should report missing type');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on hook entry missing command field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on missing command');
    assert.ok(result.stderr.includes('command'), 'Should report missing command');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on invalid async field type', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', async: 'yes' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on non-boolean async');
    assert.ok(result.stderr.includes('async'), 'Should report async type error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on negative timeout', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', timeout: -5 }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on negative timeout');
    assert.ok(result.stderr.includes('timeout'), 'Should report timeout error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on invalid inline JS syntax', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "function {"' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on invalid inline JS');
    assert.ok(result.stderr.includes('invalid inline JS'), 'Should report JS syntax error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('passes valid inline JS commands', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "console.log(1+2)"' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should pass valid inline JS');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('validates array command format', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', '-e', 'console.log(1)'] }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept array command format');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('validates legacy array format', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify([
      { matcher: 'test', hooks: [{ type: 'command', command: 'echo ok' }] }
    ]));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept legacy array format');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on matcher missing hooks array', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test' }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on missing hooks array');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ==========================================
  // validate-skills.js
  // ==========================================
  console.log('\nvalidate-skills.js:');

  if (test('passes on real project skills', () => {
    const result = runValidator('validate-skills');
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
  })) passed++; else failed++;

  if (test('exits 0 when directory does not exist', () => {
    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', '/nonexistent/dir');
    assert.strictEqual(result.code, 0, 'Should skip when no skills dir');
  })) passed++; else failed++;

  if (test('fails on skill directory without SKILL.md', () => {
    const testDir = createTestDir();
    fs.mkdirSync(path.join(testDir, 'broken-skill'));
    // No SKILL.md inside

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail on missing SKILL.md');
    assert.ok(result.stderr.includes('Missing SKILL.md'), 'Should report missing SKILL.md');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on empty SKILL.md', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'empty-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail on empty SKILL.md');
    assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('passes on valid skill directory', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'good-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\nDescription here.');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass for valid skill');
    assert.ok(result.stdout.includes('Validated 1'), 'Should report 1 validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('ignores non-directory entries', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'not-a-skill.md'), '# README');
    const skillDir = path.join(testDir, 'real-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should ignore non-directory entries');
    assert.ok(result.stdout.includes('Validated 1'), 'Should count only directories');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on whitespace-only SKILL.md', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'blank-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '   \n\t\n  ');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only SKILL.md');
    assert.ok(result.stderr.includes('Empty file'), 'Should report empty file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('warns when frontmatter is missing name (default mode)', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'no-name-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\ndescription: "X"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir);
    assert.strictEqual(result.code, 0,
      `Default mode must not fail CI; got stderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes('WARN') && result.stderr.includes('missing required field: name'),
      `Should warn on missing name; got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('errors when frontmatter is missing name (strict mode)', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'no-name-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\ndescription: "X"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir, ['--strict']);
    assert.strictEqual(result.code, 1, '--strict must fail CI on missing name');
    assert.ok(result.stderr.includes('missing required field: name'),
      'Should report missing name');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('warns on literal block-scalar description (|-)', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'block-desc-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\nname: block-desc-skill\ndescription: |-\n  line one\n  line two\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir);
    assert.strictEqual(result.code, 0, 'Default mode should not fail CI');
    assert.ok(
      result.stderr.includes('WARN') && result.stderr.includes('literal block scalar'),
      `Should warn on |- description; got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts folded (>) and inline descriptions', () => {
    const testDir = createTestDir();
    const folded = path.join(testDir, 'folded-skill');
    fs.mkdirSync(folded);
    fs.writeFileSync(path.join(folded, 'SKILL.md'),
      '---\nname: folded-skill\ndescription: >\n  joined\n  on spaces\norigin: ECC\n---\n# Skill');
    const inline = path.join(testDir, 'inline-skill');
    fs.mkdirSync(inline);
    fs.writeFileSync(path.join(inline, 'SKILL.md'),
      '---\nname: inline-skill\ndescription: "single line"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir, ['--strict']);
    assert.strictEqual(result.code, 0,
      `Folded and inline should pass strict; got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated 2'),
      `Should count both skills; got stdout: ${result.stdout}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('skips hidden directories under skills/', () => {
    const testDir = createTestDir();
    // A dot-prefixed directory (e.g. .DS_Store-adjacent junk or legacy
    // cache) must not count as a skill and must not error.
    fs.mkdirSync(path.join(testDir, '.cache'));
    fs.writeFileSync(path.join(testDir, '.cache', 'SKILL.md'), '# ignored');
    const real = path.join(testDir, 'real-skill');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'SKILL.md'),
      '---\nname: real-skill\ndescription: "x"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir, ['--strict']);
    assert.strictEqual(result.code, 0, 'Hidden dirs should be skipped');
    assert.ok(result.stdout.includes('Validated 1'),
      `Should only count the non-hidden skill; got stdout: ${result.stdout}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('warns when name: value is empty or whitespace', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'empty-name-skill');
    fs.mkdirSync(skillDir);
    // `name:` key present but value is blank.
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\nname:    \ndescription: "X"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir);
    assert.strictEqual(result.code, 0,
      `Default mode must not fail CI; got stderr: ${result.stderr}`);
    assert.ok(
      result.stderr.includes('WARN') && result.stderr.includes("'name' is empty"),
      `Should warn on empty name; got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('warns on literal block-scalar description with |+ chomp', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'keep-desc-skill');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\nname: keep-desc-skill\ndescription: |+\n  line one\n  line two\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir);
    assert.strictEqual(result.code, 0, 'Default mode should not fail CI');
    assert.ok(result.stderr.includes('literal block scalar'),
      `Should warn on |+ description; got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('warns on block-scalar description with indent indicator and trailing comment', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'indent-desc-skill');
    fs.mkdirSync(skillDir);
    // `|-2  # note` is still a literal block scalar in YAML 1.2.
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\nname: indent-desc-skill\ndescription: |-2  # trimmed two-space indent\n    line one\n    line two\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir);
    assert.strictEqual(result.code, 0, 'Default mode should not fail CI');
    assert.ok(result.stderr.includes('literal block scalar'),
      `Should warn on |-2 description; got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('honors CI_STRICT_SKILLS=1 env flag', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'no-name-skill-env');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\ndescription: "X"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir, [], { CI_STRICT_SKILLS: '1' });
    assert.strictEqual(result.code, 1, 'CI_STRICT_SKILLS=1 must fail CI on missing name');
    assert.ok(result.stderr.includes('missing required field: name'),
      'Should report missing name');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('flags comment-only name value as empty (strict)', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'comment-only-name');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '---\nname: # todo\ndescription: "X"\norigin: ECC\n---\n# Skill');

    const result = runSkillsValidator(testDir, ['--strict']);
    assert.strictEqual(result.code, 1, 'Strict mode must fail CI on empty name');
    assert.ok(result.stderr.includes("'name' is empty"),
      `Should report empty name; got stderr: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('tolerates ---trailing text outside frontmatter block', () => {
    // A SKILL.md whose body contains a line starting with '---text'
    // must not be parsed as frontmatter. Regression guard for
    // closing-delimiter tightening: the old regex would greedily
    // match '---trailing'.
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'no-frontmatter-dashes');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'),
      '# Skill\n\nSome body text.\n\n---trailing content\nmore body\n');

    const result = runSkillsValidator(testDir, ['--strict']);
    assert.strictEqual(result.code, 0,
      `Should not flag frontmatter findings when no valid frontmatter exists; got stderr: ${result.stderr}`);
    assert.ok(!result.stderr.includes('missing required field: name'),
      'Must not treat ---trailing as a frontmatter closer');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ==========================================
  // validate-commands.js
  // ==========================================
  console.log('\nvalidate-commands.js:');

  if (test('passes on real project commands', () => {
    const result = runValidator('validate-commands');
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
  })) passed++; else failed++;

  if (test('exits 0 when directory does not exist', () => {
    const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', '/nonexistent/dir');
    assert.strictEqual(result.code, 0, 'Should skip when no commands dir');
  })) passed++; else failed++;

  if (test('fails on empty command file', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'empty.md'), '');

    const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail on empty file');
    assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('passes on valid command files', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'deploy.md'), '# Deploy\nDeploy the application.');
    fs.writeFileSync(path.join(testDir, 'test.md'), '# Test\nRun all tests.');

    const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass for valid commands');
    assert.ok(result.stdout.includes('Validated 2'), 'Should report 2 validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('ignores non-md files', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'script.js'), 'console.log(1)');
    fs.writeFileSync(path.join(testDir, 'valid.md'), '# Command');

    const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should ignore non-md files');
    assert.ok(result.stdout.includes('Validated 1'), 'Should count only .md files');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('detects broken command cross-reference', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'my-cmd.md'), '# Command\nUse `/nonexistent-cmd` to do things.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail on broken command ref');
    assert.ok(result.stderr.includes('nonexistent-cmd'), 'Should report broken command');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('detects broken agent path reference', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nAgent: `agents/fake-agent.md`');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail on broken agent ref');
    assert.ok(result.stderr.includes('fake-agent'), 'Should report broken agent');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('skips references inside fenced code blocks', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'cmd.md'),
      '# Command\n\n```\nagents/example-agent.md\n`/example-cmd`\n```\n');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should skip refs inside code blocks');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('detects broken workflow agent reference', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# A');
    fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nWorkflow:\nplanner -> ghost-agent');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail on broken workflow agent');
    assert.ok(result.stderr.includes('ghost-agent'), 'Should report broken workflow agent');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('skips command references on creates: lines', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // "Creates: `/new-table`" should NOT flag /new-table as a broken ref
    fs.writeFileSync(path.join(testDir, 'gen.md'),
      '# Generator\n\n→ Creates: `/new-table`\nWould create: `/new-endpoint`');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should skip creates: lines');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('accepts valid cross-reference between commands', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'build.md'), '# Build\nSee also `/deploy` for deployment.');
    fs.writeFileSync(path.join(testDir, 'deploy.md'), '# Deploy\nRun `/build` first.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should accept valid cross-refs');
    assert.ok(result.stdout.includes('Validated 2'), 'Should validate both');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('checks references in unclosed code blocks', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Unclosed code block: the ``` regex won't strip it, so refs inside are checked
    fs.writeFileSync(path.join(testDir, 'bad.md'),
      '# Command\n\n```\n`/phantom-cmd`\nno closing block');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    // Unclosed code blocks are NOT stripped, so refs inside are validated
    assert.strictEqual(result.code, 1, 'Should check refs in unclosed code blocks');
    assert.ok(result.stderr.includes('phantom-cmd'), 'Should report broken ref from unclosed block');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('captures ALL command references on a single line (multi-ref)', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Line with two command references — both should be detected
    fs.writeFileSync(path.join(testDir, 'multi.md'),
      '# Multi\nUse `/ghost-a` and `/ghost-b` together.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail on broken refs');
    // BOTH ghost-a AND ghost-b must be reported (this was the greedy regex bug)
    assert.ok(result.stderr.includes('ghost-a'), 'Should report first ref /ghost-a');
    assert.ok(result.stderr.includes('ghost-b'), 'Should report second ref /ghost-b');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('captures three command refs on one line', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'triple.md'),
      '# Triple\nChain `/alpha`, `/beta`, and `/gamma` in order.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail on all three broken refs');
    assert.ok(result.stderr.includes('alpha'), 'Should report /alpha');
    assert.ok(result.stderr.includes('beta'), 'Should report /beta');
    assert.ok(result.stderr.includes('gamma'), 'Should report /gamma');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('multi-ref line with one valid and one invalid ref', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // "real-cmd" exists, "fake-cmd" does not
    fs.writeFileSync(path.join(testDir, 'real-cmd.md'), '# Real\nA real command.');
    fs.writeFileSync(path.join(testDir, 'mixed.md'),
      '# Mixed\nRun `/real-cmd` then `/fake-cmd`.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail for the fake ref');
    assert.ok(result.stderr.includes('fake-cmd'), 'Should report /fake-cmd');
    // real-cmd should NOT appear in errors
    assert.ok(!result.stderr.includes('real-cmd'), 'Should not report valid /real-cmd');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('creates: line with multiple refs skips entire line', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Both refs on a "Creates:" line should be skipped entirely
    fs.writeFileSync(path.join(testDir, 'gen.md'),
      '# Generator\nCreates: `/new-a` and `/new-b`');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should skip all refs on creates: line');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('validates valid workflow diagram with known agents', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# P');
    fs.writeFileSync(path.join(agentsDir, 'reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# R');
    fs.writeFileSync(path.join(testDir, 'flow.md'), '# Workflow\n\nplanner -> reviewer');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should pass on valid workflow');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // ==========================================
  // validate-rules.js
  // ==========================================
  console.log('\nvalidate-rules.js:');

  if (test('passes on real project rules', () => {
    const result = runValidator('validate-rules');
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
  })) passed++; else failed++;

  if (test('exits 0 when directory does not exist', () => {
    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', '/nonexistent/dir');
    assert.strictEqual(result.code, 0, 'Should skip when no rules dir');
  })) passed++; else failed++;

  if (test('fails on empty rule file', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'empty.md'), '');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail on empty rule file');
    assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('passes on valid rule files', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'coding.md'), '# Coding Rules\nUse immutability.');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass for valid rules');
    assert.ok(result.stdout.includes('Validated 1'), 'Should report 1 validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on whitespace-only rule file', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'blank.md'), '   \n\t\n  ');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only rule file');
    assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('validates rules in subdirectories recursively', () => {
    const testDir = createTestDir();
    const subDir = path.join(testDir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(testDir, 'top.md'), '# Top Level Rule');
    fs.writeFileSync(path.join(subDir, 'nested.md'), '# Nested Rule');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should validate nested rules');
    assert.ok(result.stdout.includes('Validated 2'), 'Should find both rules');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ==========================================
  // Round 19: Whitespace and edge-case tests
  // ==========================================

  // --- validate-hooks.js whitespace/null edge cases ---
  console.log('\nvalidate-hooks.js (whitespace edge cases):');

  if (test('rejects whitespace-only command string', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: '   \t  ' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only command');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects null command value', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: null }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject null command');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects numeric command value', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 42 }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject numeric command');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // --- validate-agents.js whitespace edge cases ---
  console.log('\nvalidate-agents.js (whitespace edge cases):');

  if (test('rejects agent with whitespace-only model value', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'ws-model.md'), '---\nmodel:   \t  \ntools: Read, Write\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only model');
    assert.ok(result.stderr.includes('model'), 'Should report model field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects agent with whitespace-only tools value', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'ws-tools.md'), '---\nmodel: sonnet\ntools:   \t  \n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only tools');
    assert.ok(result.stderr.includes('tools'), 'Should report tools field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts agent with extra unknown frontmatter fields', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'extra.md'), '---\nmodel: sonnet\ntools: Read, Write\ncustom_field: some value\nauthor: test\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should accept extra unknown fields');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects agent with invalid model value', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'bad-model.md'), '---\nmodel: gpt-4\ntools: Read\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject invalid model');
    assert.ok(result.stderr.includes('Invalid model'), 'Should report invalid model');
    assert.ok(result.stderr.includes('gpt-4'), 'Should show the invalid value');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // --- validate-commands.js additional edge cases ---
  console.log('\nvalidate-commands.js (additional edge cases):');

  if (test('reports all invalid agents in mixed agent references', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'real-agent.md'), '---\nmodel: sonnet\ntools: Read\n---\n# A');
    fs.writeFileSync(path.join(testDir, 'cmd.md'),
      '# Cmd\nSee agents/real-agent.md and agents/fake-one.md and agents/fake-two.md');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail on invalid agent refs');
    assert.ok(result.stderr.includes('fake-one'), 'Should report first invalid agent');
    assert.ok(result.stderr.includes('fake-two'), 'Should report second invalid agent');
    assert.ok(!result.stderr.includes('real-agent'), 'Should NOT report valid agent');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('validates workflow with hyphenated agent names', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'tdd-guide.md'), '---\nmodel: sonnet\ntools: Read\n---\n# T');
    fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# C');
    fs.writeFileSync(path.join(testDir, 'flow.md'), '# Workflow\n\ntdd-guide -> code-reviewer');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should pass on hyphenated agent names in workflow');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('detects skill directory reference warning', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Reference a non-existent skill directory
    fs.writeFileSync(path.join(testDir, 'cmd.md'),
      '# Command\nSee skills/nonexistent-skill/ for details.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    // Should pass (warnings don't cause exit 1) but stderr should have warning
    assert.strictEqual(result.code, 0, 'Skill warnings should not cause failure');
    assert.ok(result.stdout.includes('warning'), 'Should report warning count');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // ==========================================
  // Round 22: Hook schema edge cases & empty directory paths
  // ==========================================

  // --- validate-hooks.js: schema edge cases ---
  console.log('\nvalidate-hooks.js (schema edge cases):');

  if (test('rejects event type value that is not an array', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: { PreToolUse: 'not-an-array' }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on non-array event type value');
    assert.ok(result.stderr.includes('must be an array'), 'Should report must be an array');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects matcher entry that is null', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: { PreToolUse: [null] }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on null matcher entry');
    assert.ok(result.stderr.includes('is not an object'), 'Should report not an object');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects matcher entry that is a string', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: { PreToolUse: ['just-a-string'] }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on string matcher entry');
    assert.ok(result.stderr.includes('is not an object'), 'Should report not an object');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects top-level data that is a string', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, '"just a string"');

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on string data');
    assert.ok(result.stderr.includes('must be an object or array'), 'Should report must be object or array');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects top-level data that is a number', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, '42');

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on numeric data');
    assert.ok(result.stderr.includes('must be an object or array'), 'Should report must be object or array');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects empty string command', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: '' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject empty string command');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects empty array command', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: [] }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject empty array command');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects array command with non-string elements', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', 123, null] }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject non-string array elements');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects non-string type field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 42, command: 'echo hi' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject non-string type');
    assert.ok(result.stderr.includes('type'), 'Should report type field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects non-number timeout type', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', timeout: 'fast' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject string timeout');
    assert.ok(result.stderr.includes('timeout'), 'Should report timeout type error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts timeout of exactly 0', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo', timeout: 0 }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept timeout of 0');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('validates object format without wrapping hooks key', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    // data.hooks is undefined, so fallback to data itself
    fs.writeFileSync(hooksFile, JSON.stringify({
      PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo ok' }] }]
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept object format without hooks wrapper');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // --- validate-hooks.js: legacy format error paths ---
  console.log('\nvalidate-hooks.js (legacy format errors):');

  if (test('legacy format: rejects matcher missing matcher field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify([
      { hooks: [{ type: 'command', command: 'echo ok' }] }
    ]));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on missing matcher in legacy format');
    assert.ok(result.stderr.includes('matcher'), 'Should report missing matcher');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('legacy format: rejects matcher missing hooks array', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify([
      { matcher: 'test' }
    ]));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on missing hooks array in legacy format');
    assert.ok(result.stderr.includes('hooks'), 'Should report missing hooks');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // --- validate-agents.js: empty directory ---
  console.log('\nvalidate-agents.js (empty directory):');

  if (test('passes on empty agents directory', () => {
    const testDir = createTestDir();
    // No .md files, just an empty dir

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass on empty directory');
    assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // --- validate-commands.js: whitespace-only file ---
  console.log('\nvalidate-commands.js (whitespace edge cases):');

  if (test('fails on whitespace-only command file', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'blank.md'), '   \n\t\n  ');

    const result = runValidatorWithDir('validate-commands', 'COMMANDS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only command file');
    assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts valid skill directory reference', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Create a matching skill directory
    fs.mkdirSync(path.join(skillsDir, 'my-skill'));
    fs.writeFileSync(path.join(testDir, 'cmd.md'),
      '# Command\nSee skills/my-skill/ for details.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should pass on valid skill reference');
    assert.ok(!result.stdout.includes('warning'), 'Should have no warnings');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // --- validate-rules.js: mixed valid/invalid ---
  console.log('\nvalidate-rules.js (mixed files):');

  if (test('fails on mix of valid and empty rule files', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'good.md'), '# Good Rule\nContent here.');
    fs.writeFileSync(path.join(testDir, 'bad.md'), '');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail when any rule is empty');
    assert.ok(result.stderr.includes('bad.md'), 'Should report the bad file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 27: hook validation edge cases ──
  console.log('\nvalidate-hooks.js (Round 27 edge cases):');

  if (test('rejects array command with empty string element', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: ['node', '', 'script.js'] }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject array with empty string element');
    assert.ok(result.stderr.includes('command'), 'Should report command field error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects negative timeout', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo hi', timeout: -5 }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject negative timeout');
    assert.ok(result.stderr.includes('timeout'), 'Should report timeout error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects non-boolean async field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo ok', async: 'yes' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject non-boolean async');
    assert.ok(result.stderr.includes('async'), 'Should report async type error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('reports correct index for error in deeply nested hook', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    const manyHooks = [];
    for (let i = 0; i < 5; i++) {
      manyHooks.push({ type: 'command', command: 'echo ok' });
    }
    // Add an invalid hook at index 5
    manyHooks.push({ type: 'command', command: '' });
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: manyHooks }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on invalid hook at high index');
    assert.ok(result.stderr.includes('hooks[5]'), 'Should report correct hook index 5');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('validates node -e with escaped quotes in inline JS', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'node -e "const x = 1 + 2; process.exit(0)"' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should pass valid multi-statement inline JS');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts multiple valid event types in single hooks file', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo pre' }] }],
        PostToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo post' }] }],
        Stop: [{ matcher: 'test', hooks: [{ type: 'command', command: 'echo stop' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept multiple valid event types');
    assert.ok(result.stdout.includes('3'), 'Should report 3 matchers validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 27: command validation edge cases ──
  console.log('\nvalidate-commands.js (Round 27 edge cases):');

  if (test('validates multiple command refs on same non-creates line', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Create two valid commands
    fs.writeFileSync(path.join(testDir, 'cmd-a.md'), '# Command A\nBasic command.');
    fs.writeFileSync(path.join(testDir, 'cmd-b.md'), '# Command B\nBasic command.');
    // Create a third command that references both on one line
    fs.writeFileSync(path.join(testDir, 'cmd-c.md'),
      '# Command C\nUse `/cmd-a` and `/cmd-b` together.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should pass when multiple refs on same line are all valid');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('fails when one of multiple refs on same line is invalid', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Only cmd-a exists
    fs.writeFileSync(path.join(testDir, 'cmd-a.md'), '# Command A\nBasic command.');
    // cmd-c references cmd-a (valid) and cmd-z (invalid) on same line
    fs.writeFileSync(path.join(testDir, 'cmd-c.md'),
      '# Command C\nUse `/cmd-a` and `/cmd-z` together.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail when any ref is invalid');
    assert.ok(result.stderr.includes('cmd-z'), 'Should report the invalid reference');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('code blocks are stripped before checking references', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Reference inside a code block should not be validated
    fs.writeFileSync(path.join(testDir, 'cmd-x.md'),
      '# Command X\n```\n`/nonexistent-cmd` in code block\n```\nEnd.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should ignore command refs inside code blocks');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // --- validate-skills.js: mixed valid/invalid ---
  console.log('\nvalidate-skills.js (mixed dirs):');

  if (test('fails on mix of valid and invalid skill directories', () => {
    const testDir = createTestDir();
    // Valid skill
    const goodSkill = path.join(testDir, 'good-skill');
    fs.mkdirSync(goodSkill);
    fs.writeFileSync(path.join(goodSkill, 'SKILL.md'), '# Good Skill');
    // Missing SKILL.md
    const badSkill = path.join(testDir, 'bad-skill');
    fs.mkdirSync(badSkill);
    // Empty SKILL.md
    const emptySkill = path.join(testDir, 'empty-skill');
    fs.mkdirSync(emptySkill);
    fs.writeFileSync(path.join(emptySkill, 'SKILL.md'), '');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail when any skill is invalid');
    assert.ok(result.stderr.includes('bad-skill'), 'Should report missing SKILL.md');
    assert.ok(result.stderr.includes('empty-skill'), 'Should report empty SKILL.md');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 30: validate-commands skill warnings and workflow edge cases ──
  console.log('\nRound 30: validate-commands (skill warnings):');

  if (test('warns (not errors) when skill directory reference is not found', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Create a command that references a skill via path (skills/name/) format
    // but the skill doesn't exist — should warn, not error
    fs.writeFileSync(path.join(testDir, 'cmd-a.md'),
      '# Command A\nSee skills/nonexistent-skill/ for details.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    // Skill directory references produce warnings, not errors — exit 0
    assert.strictEqual(result.code, 0, 'Skill path references should warn, not error');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('passes when command has no slash references at all', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'cmd-simple.md'),
      '# Simple Command\nThis command has no references to other commands.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should pass with no references');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  console.log('\nRound 30: validate-agents (model validation):');

  if (test('rejects agent with unrecognized model value', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'bad-model.md'),
      '---\nmodel: gpt-4\ntools: Read, Write\n---\n# Bad Model Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject unrecognized model');
    assert.ok(result.stderr.includes('gpt-4'), 'Should mention the invalid model');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('accepts all valid model values (haiku, sonnet, opus)', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'haiku.md'),
      '---\nmodel: haiku\ntools: Read\n---\n# Haiku Agent');
    fs.writeFileSync(path.join(testDir, 'sonnet.md'),
      '---\nmodel: sonnet\ntools: Read, Write\n---\n# Sonnet Agent');
    fs.writeFileSync(path.join(testDir, 'opus.md'),
      '---\nmodel: opus\ntools: Read, Write, Bash\n---\n# Opus Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'All valid models should pass');
    assert.ok(result.stdout.includes('3'), 'Should validate 3 agent files');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects agent with duplicate top-level frontmatter keys', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'dup-model.md'),
      '---\nname: dup\nmodel: sonnet\ntools: Read, Write\ndescription: test\nmodel: opus\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject duplicate top-level YAML keys');
    assert.ok(result.stderr.includes('Duplicate frontmatter keys'), 'Should report duplicate keys');
    assert.ok(result.stderr.includes('model'), 'Should name the duplicated key');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('allows duplicate-looking nested frontmatter keys', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'nested.md'),
      '---\nmodel: sonnet\ntools: Read\nmetadata:\n  model: display-only\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Indented nested keys should not count as top-level duplicates');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 32: empty frontmatter & edge cases ──
  console.log('\nRound 32: validate-agents (empty frontmatter):');

  if (test('rejects agent with empty frontmatter block (no key-value pairs)', () => {
    const testDir = createTestDir();
    // Blank line between --- markers creates a valid but empty frontmatter block
    fs.writeFileSync(path.join(testDir, 'empty-fm.md'), '---\n\n---\n# Agent with empty frontmatter');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject empty frontmatter');
    assert.ok(result.stderr.includes('model'), 'Should report missing model');
    assert.ok(result.stderr.includes('tools'), 'Should report missing tools');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects agent with no content between --- markers (Missing frontmatter)', () => {
    const testDir = createTestDir();
    // ---\n--- with no blank line → regex doesn't match → "Missing frontmatter"
    fs.writeFileSync(path.join(testDir, 'no-fm.md'), '---\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject missing frontmatter');
    assert.ok(result.stderr.includes('Missing frontmatter'), 'Should report missing frontmatter');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects agent with partial frontmatter (only model, no tools)', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'partial.md'), '---\nmodel: haiku\n---\n# Partial agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject partial frontmatter');
    assert.ok(result.stderr.includes('tools'), 'Should report missing tools');
    assert.ok(!result.stderr.includes('model'), 'Should NOT report model (it is present)');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles multiple agents where only one is invalid', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'good.md'), '---\nmodel: sonnet\ntools: Read\n---\n# Good');
    fs.writeFileSync(path.join(testDir, 'bad.md'), '---\nmodel: invalid-model\ntools: Read\n---\n# Bad');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail when any agent is invalid');
    assert.ok(result.stderr.includes('bad.md'), 'Should identify the bad file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 32: validate-rules (non-file entries):');

  if (test('skips directory entries even if named with .md extension', () => {
    const testDir = createTestDir();
    // Create a directory named "tricky.md" — stat.isFile() should skip it
    fs.mkdirSync(path.join(testDir, 'tricky.md'));
    fs.writeFileSync(path.join(testDir, 'real.md'), '# A real rule');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should skip directory entries');
    assert.ok(result.stdout.includes('Validated 1'), 'Should count only the real file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles deeply nested rule in subdirectory', () => {
    const testDir = createTestDir();
    const deepDir = path.join(testDir, 'cat1', 'sub1');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, 'deep-rule.md'), '# Deep nested rule');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should validate deeply nested rules');
    assert.ok(result.stdout.includes('Validated 1'), 'Should find the nested rule');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 32: validate-commands (agent reference with valid workflow):');

  if (test('passes workflow with three chained agents', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# P');
    fs.writeFileSync(path.join(agentsDir, 'tdd-guide.md'), '---\nmodel: sonnet\ntools: Read\n---\n# T');
    fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# C');
    fs.writeFileSync(path.join(testDir, 'flow.md'), '# Flow\n\nplanner -> tdd-guide -> code-reviewer');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should pass on valid 3-agent workflow');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  if (test('detects broken agent in middle of workflow chain', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'planner.md'), '---\nmodel: sonnet\ntools: Read\n---\n# P');
    fs.writeFileSync(path.join(agentsDir, 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n# C');
    // missing-agent is NOT created
    fs.writeFileSync(path.join(testDir, 'flow.md'), '# Flow\n\nplanner -> missing-agent -> code-reviewer');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should detect broken agent in workflow chain');
    assert.ok(result.stderr.includes('missing-agent'), 'Should report the missing agent');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // ── Round 42: case sensitivity, space-before-colon, missing dirs, empty matchers ──
  console.log('\nRound 42: validate-agents (case sensitivity):');

  if (test('rejects uppercase model value (case-sensitive check)', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'upper.md'), '---\nmodel: Haiku\ntools: Read\n---\n# Uppercase model');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject capitalized model');
    assert.ok(result.stderr.includes('Invalid model'), 'Should report invalid model');
    assert.ok(result.stderr.includes('Haiku'), 'Should show the rejected value');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles space before colon in frontmatter key', () => {
    const testDir = createTestDir();
    // "model : sonnet" — space before colon. extractFrontmatter uses indexOf(':') + trim()
    fs.writeFileSync(path.join(testDir, 'space.md'), '---\nmodel : sonnet\ntools : Read, Write\n---\n# Agent with space-colon');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should accept space before colon (trim handles it)');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 42: validate-commands (missing agents dir):');

  if (test('flags agent path references when AGENTS_DIR does not exist', () => {
    const testDir = createTestDir();
    const skillsDir = createTestDir();
    // AGENTS_DIR points to non-existent path → validAgents set stays empty
    fs.writeFileSync(path.join(testDir, 'cmd.md'), '# Command\nSee agents/planner.md for details.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: '/nonexistent/agents-dir', SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 1, 'Should fail when agents dir missing but agent referenced');
    assert.ok(result.stderr.includes('planner'), 'Should report the unresolvable agent reference');
    cleanupTestDir(testDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  console.log('\nRound 42: validate-hooks (empty matchers array):');

  if (test('accepts event type with empty matchers array', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: []
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept empty matchers array');
    assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 matchers');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 47: escape sequence and frontmatter edge cases ──
  console.log('\nRound 47: validate-hooks (inline JS escape sequences):');

  if (test('validates inline JS with mixed escape sequences (newline + escaped quote)', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    // Command value after JSON parse: node -e "var a = \"ok\"\nconsole.log(a)"
    // Regex captures: var a = \"ok\"\nconsole.log(a)
    // After unescape chain: var a = "ok"\nconsole.log(a) (real newline) — valid JS
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command',
          command: 'node -e "var a = \\"ok\\"\\nconsole.log(a)"' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should handle escaped quotes and newline separators');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects inline JS with syntax error after unescaping', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    // After unescape this becomes: var x = { — missing closing brace
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command',
          command: 'node -e "var x = {"' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject JS syntax error after unescaping');
    assert.ok(result.stderr.includes('invalid inline JS'), 'Should report inline JS error');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 47: validate-agents (frontmatter lines without colon):');

  if (test('silently ignores frontmatter line without colon', () => {
    const testDir = createTestDir();
    // Line "just some text" has no colon — should be skipped, not cause crash
    fs.writeFileSync(path.join(testDir, 'mixed.md'),
      '---\nmodel: sonnet\njust some text without colon\ntools: Read\n---\n# Agent');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should ignore lines without colon in frontmatter');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 52: command inline backtick refs, workflow whitespace, code-only rules ──
  console.log('\nRound 52: validate-commands (inline backtick refs):');

  if (test('validates command refs inside inline backticks (not stripped by code block removal)', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'deploy.md'), '# Deploy\nDeploy the app.');
    // Inline backtick ref `/deploy` should be validated (only fenced blocks stripped)
    fs.writeFileSync(path.join(testDir, 'workflow.md'),
      '# Workflow\nFirst run `/deploy` to deploy the app.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Inline backtick command refs should be validated');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  console.log('\nRound 52: validate-commands (workflow whitespace):');

  if (test('validates workflow arrows with irregular whitespace', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    fs.writeFileSync(path.join(agentsDir, 'planner.md'), '# Planner');
    fs.writeFileSync(path.join(agentsDir, 'reviewer.md'), '# Reviewer');
    // Three workflow lines: no spaces, double spaces, tab-separated
    fs.writeFileSync(path.join(testDir, 'flow.md'),
      '# Workflow\n\nplanner->reviewer\nplanner  ->  reviewer');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Workflow arrows with irregular whitespace should be valid');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  console.log('\nRound 52: validate-rules (code-only content):');

  if (test('passes rule file containing only a fenced code block', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'code-only.md'),
      '```javascript\nfunction example() {\n  return true;\n}\n```');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Rule with only code block should pass (non-empty)');
    assert.ok(result.stdout.includes('Validated 1'), 'Should count the code-only file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 57: readFileSync error path, statSync catch block, adjacent code blocks ──
  console.log('\nRound 57: validate-skills.js (SKILL.md is a directory — readFileSync error):');

  if (test('fails gracefully when SKILL.md is a directory instead of a file', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'dir-skill');
    fs.mkdirSync(skillDir);
    // Create SKILL.md as a DIRECTORY, not a file — existsSync returns true
    // but readFileSync throws EISDIR, exercising the catch block (lines 33-37)
    fs.mkdirSync(path.join(skillDir, 'SKILL.md'));

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail when SKILL.md is a directory');
    assert.ok(result.stderr.includes('dir-skill'), 'Should report the problematic skill');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 57: validate-rules.js (broken symlink — statSync catch block):');

  if (test('reports error for broken symlink .md file in rules directory', () => {
    const testDir = createTestDir();
    // Create a valid rule first
    fs.writeFileSync(path.join(testDir, 'valid.md'), '# Valid Rule');
    // Create a broken symlink (dangling → target doesn't exist)
    // statSync follows symlinks and throws ENOENT, exercising catch (lines 35-38)
    try {
      fs.symlinkSync('/nonexistent/target.md', path.join(testDir, 'broken.md'));
    } catch {
      // Skip on systems that don't support symlinks
      console.log('    (skipped — symlinks not supported)');
      cleanupTestDir(testDir);
      return;
    }

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail on broken symlink');
    assert.ok(result.stderr.includes('broken.md'), 'Should report the broken symlink file');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 57: validate-commands.js (adjacent code blocks both stripped):');

  if (test('strips multiple adjacent code blocks before checking references', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Two adjacent code blocks, each with broken refs — BOTH must be stripped
    fs.writeFileSync(path.join(testDir, 'multi-blocks.md'),
      '# Multi Block\n\n' +
      '```\n`/phantom-a` in first block\n```\n\n' +
      'Content between blocks\n\n' +
      '```\n`/phantom-b` in second block\nagents/ghost-agent.md\n```\n\n' +
      'Final content');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0,
      'Both code blocks should be stripped — no broken refs reported');
    assert.ok(!result.stderr.includes('phantom-a'), 'First block ref should be stripped');
    assert.ok(!result.stderr.includes('phantom-b'), 'Second block ref should be stripped');
    assert.ok(!result.stderr.includes('ghost-agent'), 'Agent ref in second block should be stripped');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // ── Round 58: readFileSync catch block, colonIdx edge case, command-as-object ──
  console.log('\nRound 58: validate-agents.js (unreadable agent file — readFileSync catch):');

  if (test('reports error when agent .md file is unreadable (chmod 000)', () => {
    // Skip on Windows or when running as root (permissions won't work)
    if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
      console.log('    (skipped — not supported on this platform)');
      return;
    }
    const testDir = createTestDir();
    const agentFile = path.join(testDir, 'locked.md');
    fs.writeFileSync(agentFile, '---\nmodel: sonnet\ntools: Read\n---\n# Agent');
    fs.chmodSync(agentFile, 0o000);

    try {
      const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
      assert.strictEqual(result.code, 1, 'Should exit 1 on read error');
      assert.ok(result.stderr.includes('locked.md'), 'Should mention the unreadable file');
    } finally {
      fs.chmodSync(agentFile, 0o644);
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  console.log('\nRound 58: validate-agents.js (frontmatter line with colon at position 0):');

  if (test('rejects agent when required field key has colon at position 0 (no key name)', () => {
    const testDir = createTestDir();
    fs.writeFileSync(path.join(testDir, 'bad-colon.md'),
      '---\n:sonnet\ntools: Read\n---\n# Agent with leading colon');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should fail — model field is missing (colon at idx 0 skipped)');
    assert.ok(result.stderr.includes('model'), 'Should report missing model field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 58: validate-hooks.js (command is a plain object — not string or array):');

  if (test('rejects hook entry where command is a plain object', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'test', hooks: [{ type: 'command', command: { run: 'echo hi' } }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should reject object command (not string or array)');
    assert.ok(result.stderr.includes('command'), 'Should report invalid command field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 63: object-format missing matcher, unreadable command file, empty commands dir ──
  console.log('\nRound 63: validate-hooks.js (object-format matcher missing matcher field):');

  if (test('rejects object-format matcher entry missing matcher field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    // Object format: matcher entry has hooks array but NO matcher field
    fs.writeFileSync(hooksFile, JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ok' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on missing matcher field in object format');
    assert.ok(result.stderr.includes("missing 'matcher' field"), 'Should report missing matcher field');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 63: validate-commands.js (unreadable command file):');

  if (test('reports error when command .md file is unreadable (chmod 000)', () => {
    if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
      console.log('    (skipped — not supported on this platform)');
      return;
    }
    const testDir = createTestDir();
    const cmdFile = path.join(testDir, 'locked.md');
    fs.writeFileSync(cmdFile, '# Locked Command');
    fs.chmodSync(cmdFile, 0o000);

    try {
      const result = runValidatorWithDirs('validate-commands', {
        COMMANDS_DIR: testDir, AGENTS_DIR: '/nonexistent', SKILLS_DIR: '/nonexistent'
      });
      assert.strictEqual(result.code, 1, 'Should exit 1 on read error');
      assert.ok(result.stderr.includes('locked.md'), 'Should mention the unreadable file');
    } finally {
      fs.chmodSync(cmdFile, 0o644);
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  console.log('\nRound 63: validate-commands.js (empty commands directory):');

  if (test('passes on empty commands directory (no .md files)', () => {
    const testDir = createTestDir();
    // Only non-.md files — no .md files to validate
    fs.writeFileSync(path.join(testDir, 'readme.txt'), 'not a command');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: '/nonexistent', SKILLS_DIR: '/nonexistent'
    });
    assert.strictEqual(result.code, 0, 'Should pass on empty commands directory');
    assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 65: empty directories for rules and skills ──
  console.log('\nRound 65: validate-rules.js (empty directory — no .md files):');

  if (test('passes on rules directory with no .md files (Validated 0)', () => {
    const testDir = createTestDir();
    // Only non-.md files — readdirSync filter yields empty array
    fs.writeFileSync(path.join(testDir, 'notes.txt'), 'not a rule');
    fs.writeFileSync(path.join(testDir, 'config.json'), '{}');

    const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass on empty rules directory');
    assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated rule files');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 65: validate-skills.js (empty directory — no subdirectories):');

  if (test('passes on skills directory with only files, no subdirectories (Validated 0)', () => {
    const testDir = createTestDir();
    // Only files, no subdirectories — isDirectory filter yields empty array
    fs.writeFileSync(path.join(testDir, 'README.md'), '# Skills');
    fs.writeFileSync(path.join(testDir, '.gitkeep'), '');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 0, 'Should pass on skills directory with no subdirectories');
    assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated skill directories');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 70: validate-commands.js "would create:" line skip ──
  console.log('\nRound 70: validate-commands.js (would create: skip):');

  if (test('skips command references on "would create:" lines', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // "Would create:" is the alternate form checked by the regex at line 80:
    //   if (/creates:|would create:/i.test(line)) continue;
    // Only "creates:" was previously tested (Round 20). "Would create:" exercises
    // the second alternation in the regex.
    fs.writeFileSync(path.join(testDir, 'gen-cmd.md'),
      '# Generator Command\n\nWould create: `/phantom-cmd` in your project.\n\nThis is safe.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Should skip "would create:" lines');
    assert.ok(!result.stderr.includes('phantom-cmd'), 'Should not flag ref on "would create:" line');
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // ── Round 72: validate-hooks.js async/timeout type validation ──
  console.log('\nRound 72: validate-hooks.js (async and timeout type validation):');

  if (test('rejects hook with non-boolean async field', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      PreToolUse: [{
        matcher: 'Write',
        hooks: [{
          type: 'command',
          command: 'echo test',
          async: 'yes'  // Should be boolean, not string
        }]
      }]
    }));
    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on non-boolean async');
    assert.ok(result.stderr.includes('async'), 'Should mention async in error');
    assert.ok(result.stderr.includes('boolean'), 'Should mention boolean type');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('rejects hook with negative timeout value', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, JSON.stringify({
      PostToolUse: [{
        matcher: 'Edit',
        hooks: [{
          type: 'command',
          command: 'echo test',
          timeout: -5  // Must be non-negative
        }]
      }]
    }));
    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1, 'Should fail on negative timeout');
    assert.ok(result.stderr.includes('timeout'), 'Should mention timeout in error');
    assert.ok(result.stderr.includes('non-negative'), 'Should mention non-negative');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 73: validate-commands.js skill directory statSync catch ──
  console.log('\nRound 73: validate-commands.js (unreadable skill entry — statSync catch):');

  if (test('skips unreadable skill directory entries without error (broken symlink)', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();

    // Create one valid skill directory and one broken symlink
    const validSkill = path.join(skillsDir, 'valid-skill');
    fs.mkdirSync(validSkill, { recursive: true });
    // Broken symlink: target does not exist — statSync will throw ENOENT
    const brokenLink = path.join(skillsDir, 'broken-skill');
    try {
      fs.symlinkSync('/nonexistent/target/path', brokenLink);
    } catch (err) {
      // Skip only where symlink creation is blocked (e.g. Windows without
      // Developer Mode / admin rights → EPERM/EACCES); rethrow anything else
      // so real failures aren't masked.
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        console.log('    (skipped — symlinks not supported)');
        cleanupTestDir(testDir);
        cleanupTestDir(agentsDir);
        fs.rmSync(skillsDir, { recursive: true, force: true });
        return;
      }
      throw err;
    }

    // Command that references the valid skill (should resolve)
    fs.writeFileSync(path.join(testDir, 'cmd.md'),
      '# Command\nSee skills/valid-skill/ for details.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0,
      'Should pass — broken symlink in skills dir should be skipped silently');
    // The broken-skill should NOT be in validSkills, so referencing it would warn
    // but the valid-skill reference should resolve fine
    cleanupTestDir(testDir);
    cleanupTestDir(agentsDir);
    fs.rmSync(skillsDir, { recursive: true, force: true });
  })) passed++; else failed++;

  // ── Round 76: validate-hooks.js invalid JSON in hooks.json ──
  console.log('\nRound 76: validate-hooks.js (invalid JSON in hooks.json):');

  if (test('reports error for invalid JSON in hooks.json', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, '{not valid json!!!');

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 1,
      `Expected exit 1 for invalid JSON, got ${result.code}`);
    assert.ok(result.stderr.includes('Invalid JSON'),
      `stderr should mention Invalid JSON, got: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 78: validate-hooks.js wrapped { hooks: { ... } } format ──
  console.log('\nRound 78: validate-hooks.js (wrapped hooks format):');

  if (test('validates wrapped format { hooks: { PreToolUse: [...] } }', () => {
    const testDir = createTestDir();
    const hooksFile = path.join(testDir, 'hooks.json');
    // The production hooks.json uses this wrapped format — { hooks: { ... } }
    // data.hooks is the object with event types, not data itself
    fs.writeFileSync(hooksFile, JSON.stringify({
      "$schema": "https://json.schemastore.org/claude-code-settings.json",
      hooks: {
        PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo ok' }] }],
        PostToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo done' }] }]
      }
    }));

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0,
      `Should pass wrapped hooks format, got exit ${result.code}. stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated 2'),
      `Should validate 2 matchers, got: ${result.stdout}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 79: validate-commands.js warnings count suffix in output ──
  console.log('\nRound 79: validate-commands.js (warnings count in output):');

  if (test('output includes (N warnings) suffix when skill references produce warnings', () => {
    const testDir = createTestDir();
    const agentsDir = createTestDir();
    const skillsDir = createTestDir();
    // Create a command that references 2 non-existent skill directories
    // Each triggers a WARN (not error) — warnCount should be 2
    fs.writeFileSync(path.join(testDir, 'cmd-warn.md'),
      '# Command\nSee skills/fake-skill-a/ and skills/fake-skill-b/ for details.');

    const result = runValidatorWithDirs('validate-commands', {
      COMMANDS_DIR: testDir, AGENTS_DIR: agentsDir, SKILLS_DIR: skillsDir
    });
    assert.strictEqual(result.code, 0, 'Skill warnings should not cause error exit');
    // The validate-commands output appends "(N warnings)" when warnCount > 0
    assert.ok(result.stdout.includes('(2 warnings)'),
      `Output should include "(2 warnings)" suffix, got: ${result.stdout}`);
    cleanupTestDir(testDir); cleanupTestDir(agentsDir); cleanupTestDir(skillsDir);
  })) passed++; else failed++;

  // ── Round 80: validate-hooks.js legacy array format (lines 115-135) ──
  console.log('\nRound 80: validate-hooks.js (legacy array format):');

  if (test('validates hooks in legacy array format (hooks is an array, not object)', () => {
    const testDir = createTestDir();
    // The legacy array format wraps hooks as { hooks: [...] } where the array
    // contains matcher objects directly. This exercises lines 115-135 of
    // validate-hooks.js which use "Hook ${i}" error labels instead of "${eventType}[${i}]".
    const hooksJson = JSON.stringify({
      hooks: [
        {
          matcher: 'Edit',
          hooks: [{ type: 'command', command: 'echo legacy test' }]
        }
      ]
    });
    fs.writeFileSync(path.join(testDir, 'hooks.json'), hooksJson);

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', path.join(testDir, 'hooks.json'));
    assert.strictEqual(result.code, 0, 'Should pass on valid legacy array format');
    assert.ok(result.stdout.includes('Validated 1 hook'),
      `Should report 1 validated matcher, got: ${result.stdout}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 82: Notification and SubagentStop event types ──

  console.log('\nRound 82: validate-hooks (Notification and SubagentStop event types):');

  if (test('accepts Notification and SubagentStop as valid event types', () => {
    const testDir = createTestDir();
    const hooksJson = JSON.stringify({
      hooks: [
        {
          matcher: { type: 'Notification' },
          hooks: [{ type: 'command', command: 'echo notification' }]
        },
        {
          matcher: { type: 'SubagentStop' },
          hooks: [{ type: 'command', command: 'echo subagent stopped' }]
        }
      ]
    });
    fs.writeFileSync(path.join(testDir, 'hooks.json'), hooksJson);

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', path.join(testDir, 'hooks.json'));
    assert.strictEqual(result.code, 0, 'Should pass with Notification and SubagentStop events');
    assert.ok(result.stdout.includes('Validated 2 hook'),
      `Should report 2 validated matchers, got: ${result.stdout}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 82b: validate-hooks (current official events and hook types):');

  if (test('accepts UserPromptSubmit with omitted matcher and prompt/http/agent hooks', () => {
    const testDir = createTestDir();
    const hooksJson = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              { type: 'prompt', prompt: 'Summarize the request.' },
              { type: 'agent', prompt: 'Review for security issues.', model: 'gpt-5.4' },
              { type: 'http', url: 'https://example.com/hooks', headers: { Authorization: 'Bearer token' } }
            ]
          }
        ]
      }
    });
    const hooksFile = path.join(testDir, 'hooks.json');
    fs.writeFileSync(hooksFile, hooksJson);

    const result = runValidatorWithDir('validate-hooks', 'HOOKS_FILE', hooksFile);
    assert.strictEqual(result.code, 0, 'Should accept current official hook event/type combinations');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 83: validate-agents whitespace-only field, validate-skills empty SKILL.md ──

  console.log('\nRound 83: validate-agents (whitespace-only frontmatter field value):');

  if (test('rejects agent with whitespace-only model field (trim guard)', () => {
    const testDir = createTestDir();
    // model has only whitespace — extractFrontmatter produces { model: '   ', tools: 'Read' }
    // The condition: typeof frontmatter[field] === 'string' && !frontmatter[field].trim()
    // evaluates to true for model → "Missing required field: model"
    fs.writeFileSync(path.join(testDir, 'ws.md'), '---\nmodel:   \ntools: Read\n---\n# Whitespace model');

    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject whitespace-only model');
    assert.ok(result.stderr.includes('model'), 'Should report missing model field');
    assert.ok(!result.stderr.includes('tools'), 'tools field is valid and should NOT be flagged');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  console.log('\nRound 83: validate-skills (empty SKILL.md file):');

  if (test('rejects skill directory with empty SKILL.md file', () => {
    const testDir = createTestDir();
    const skillDir = path.join(testDir, 'empty-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    // Create SKILL.md with only whitespace (trim to zero length)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '   \n  \n');

    const result = runValidatorWithDir('validate-skills', 'SKILLS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should reject empty SKILL.md');
    assert.ok(result.stderr.includes('Empty file'),
      `Should report "Empty file", got: ${result.stderr}`);
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ==========================================
  // validate-install-manifests.js
  // ==========================================
  console.log('\nvalidate-install-manifests.js:');

  if (test('passes on real project install manifests', () => {
    const result = runValidator('validate-install-manifests');
    assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
  })) passed++; else failed++;

  if (test('exits 0 when install manifests do not exist', () => {
    const testDir = createTestDir();
    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json')
    });
    assert.strictEqual(result.code, 0, 'Should skip when manifests are missing');
    assert.ok(result.stdout.includes('skipping'), 'Should say skipping');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails on invalid install manifest JSON', () => {
    const testDir = createTestDir();
    const manifestsDir = path.join(testDir, 'manifests');
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.writeFileSync(path.join(manifestsDir, 'install-modules.json'), '{ invalid json');
    writeJson(path.join(manifestsDir, 'install-profiles.json'), {
      version: 1,
      profiles: {}
    });

    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(manifestsDir, 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(manifestsDir, 'install-profiles.json'),
      COMPONENTS_MANIFEST_PATH: path.join(manifestsDir, 'install-components.json'),
      MODULES_SCHEMA_PATH: modulesSchemaPath,
      PROFILES_SCHEMA_PATH: profilesSchemaPath,
      COMPONENTS_SCHEMA_PATH: componentsSchemaPath
    });
    assert.strictEqual(result.code, 1, 'Should fail on invalid JSON');
    assert.ok(result.stderr.includes('Invalid JSON'), 'Should report invalid JSON');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails when install module references a missing path', () => {
    const testDir = createTestDir();
    writeJson(path.join(testDir, 'manifests', 'install-modules.json'), {
      version: 1,
      modules: [
        {
          id: 'rules-core',
          kind: 'rules',
          description: 'Rules',
          paths: ['rules'],
          targets: ['claude'],
          dependencies: [],
          defaultInstall: true,
          cost: 'light',
          stability: 'stable'
        },
        {
          id: 'security',
          kind: 'skills',
          description: 'Security',
          paths: ['skills/security-review'],
          targets: ['codex'],
          dependencies: [],
          defaultInstall: false,
          cost: 'medium',
          stability: 'stable'
        }
      ]
    });
    writeJson(path.join(testDir, 'manifests', 'install-profiles.json'), {
      version: 1,
      profiles: {
        core: { description: 'Core', modules: ['rules-core'] },
        developer: { description: 'Developer', modules: ['rules-core'] },
        security: { description: 'Security', modules: ['rules-core', 'security'] },
        research: { description: 'Research', modules: ['rules-core'] },
        full: { description: 'Full', modules: ['rules-core', 'security'] }
      }
    });
    writeInstallComponentsManifest(testDir, [
      {
        id: 'baseline:rules',
        family: 'baseline',
        description: 'Rules',
        modules: ['rules-core']
      },
      {
        id: 'capability:security',
        family: 'capability',
        description: 'Security',
        modules: ['security']
      }
    ]);
    fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });

    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json'),
      COMPONENTS_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-components.json'),
      MODULES_SCHEMA_PATH: modulesSchemaPath,
      PROFILES_SCHEMA_PATH: profilesSchemaPath,
      COMPONENTS_SCHEMA_PATH: componentsSchemaPath
    });
    assert.strictEqual(result.code, 1, 'Should fail when a referenced path is missing');
    assert.ok(result.stderr.includes('references missing path'), 'Should report missing path');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails when two install modules claim the same path', () => {
    const testDir = createTestDir();
    writeJson(path.join(testDir, 'manifests', 'install-modules.json'), {
      version: 1,
      modules: [
        {
          id: 'agents-core',
          kind: 'agents',
          description: 'Agents',
          paths: ['agents'],
          targets: ['codex'],
          dependencies: [],
          defaultInstall: true,
          cost: 'light',
          stability: 'stable'
        },
        {
          id: 'commands-core',
          kind: 'commands',
          description: 'Commands',
          paths: ['agents'],
          targets: ['codex'],
          dependencies: [],
          defaultInstall: true,
          cost: 'light',
          stability: 'stable'
        }
      ]
    });
    writeJson(path.join(testDir, 'manifests', 'install-profiles.json'), {
      version: 1,
      profiles: {
        core: { description: 'Core', modules: ['agents-core', 'commands-core'] },
        developer: { description: 'Developer', modules: ['agents-core', 'commands-core'] },
        security: { description: 'Security', modules: ['agents-core', 'commands-core'] },
        research: { description: 'Research', modules: ['agents-core', 'commands-core'] },
        full: { description: 'Full', modules: ['agents-core', 'commands-core'] }
      }
    });
    writeInstallComponentsManifest(testDir, [
      {
        id: 'baseline:agents',
        family: 'baseline',
        description: 'Agents',
        modules: ['agents-core']
      },
      {
        id: 'baseline:commands',
        family: 'baseline',
        description: 'Commands',
        modules: ['commands-core']
      }
    ]);
    fs.mkdirSync(path.join(testDir, 'agents'), { recursive: true });

    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json'),
      COMPONENTS_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-components.json'),
      MODULES_SCHEMA_PATH: modulesSchemaPath,
      PROFILES_SCHEMA_PATH: profilesSchemaPath,
      COMPONENTS_SCHEMA_PATH: componentsSchemaPath
    });
    assert.strictEqual(result.code, 1, 'Should fail on duplicate claimed paths');
    assert.ok(result.stderr.includes('claimed by both'), 'Should report duplicate path claims');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails when an install profile references an unknown module', () => {
    const testDir = createTestDir();
    writeJson(path.join(testDir, 'manifests', 'install-modules.json'), {
      version: 1,
      modules: [
        {
          id: 'rules-core',
          kind: 'rules',
          description: 'Rules',
          paths: ['rules'],
          targets: ['claude'],
          dependencies: [],
          defaultInstall: true,
          cost: 'light',
          stability: 'stable'
        }
      ]
    });
    writeJson(path.join(testDir, 'manifests', 'install-profiles.json'), {
      version: 1,
      profiles: {
        core: { description: 'Core', modules: ['rules-core'] },
        developer: { description: 'Developer', modules: ['rules-core'] },
        security: { description: 'Security', modules: ['rules-core'] },
        research: { description: 'Research', modules: ['rules-core'] },
        full: { description: 'Full', modules: ['rules-core', 'ghost-module'] }
      }
    });
    writeInstallComponentsManifest(testDir, [
      {
        id: 'baseline:rules',
        family: 'baseline',
        description: 'Rules',
        modules: ['rules-core']
      }
    ]);
    fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });

    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json'),
      COMPONENTS_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-components.json'),
      MODULES_SCHEMA_PATH: modulesSchemaPath,
      PROFILES_SCHEMA_PATH: profilesSchemaPath,
      COMPONENTS_SCHEMA_PATH: componentsSchemaPath
    });
    assert.strictEqual(result.code, 1, 'Should fail on unknown profile module');
    assert.ok(result.stderr.includes('references unknown module ghost-module'),
      'Should report unknown module reference');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('passes on a valid standalone install manifest fixture', () => {
    const testDir = createTestDir();
    writeJson(path.join(testDir, 'manifests', 'install-modules.json'), {
      version: 1,
      modules: [
        {
          id: 'rules-core',
          kind: 'rules',
          description: 'Rules',
          paths: ['rules'],
          targets: ['claude'],
          dependencies: [],
          defaultInstall: true,
          cost: 'light',
          stability: 'stable'
        },
        {
          id: 'orchestration',
          kind: 'orchestration',
          description: 'Orchestration',
          paths: ['scripts/orchestrate-worktrees.js'],
          targets: ['codex'],
          dependencies: ['rules-core'],
          defaultInstall: false,
          cost: 'medium',
          stability: 'beta'
        }
      ]
    });
    writeJson(path.join(testDir, 'manifests', 'install-profiles.json'), {
      version: 1,
      profiles: {
        core: { description: 'Core', modules: ['rules-core'] },
        developer: { description: 'Developer', modules: ['rules-core', 'orchestration'] },
        security: { description: 'Security', modules: ['rules-core'] },
        research: { description: 'Research', modules: ['rules-core'] },
        full: { description: 'Full', modules: ['rules-core', 'orchestration'] }
      }
    });
    writeInstallComponentsManifest(testDir, [
      {
        id: 'baseline:rules',
        family: 'baseline',
        description: 'Rules',
        modules: ['rules-core']
      },
      {
        id: 'capability:orchestration',
        family: 'capability',
        description: 'Orchestration',
        modules: ['orchestration']
      }
    ]);
    fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'scripts', 'orchestrate-worktrees.js'), '#!/usr/bin/env node\n');

    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json'),
      COMPONENTS_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-components.json'),
      MODULES_SCHEMA_PATH: modulesSchemaPath,
      PROFILES_SCHEMA_PATH: profilesSchemaPath,
      COMPONENTS_SCHEMA_PATH: componentsSchemaPath
    });
    assert.strictEqual(result.code, 0, `Should pass valid fixture, got stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Validated 2 install modules, 2 install components, and 5 profiles'),
      'Should report validated install manifest counts');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('fails when an install component references an unknown module', () => {
    const testDir = createTestDir();
    writeJson(path.join(testDir, 'manifests', 'install-modules.json'), {
      version: 1,
      modules: [
        {
          id: 'rules-core',
          kind: 'rules',
          description: 'Rules',
          paths: ['rules'],
          targets: ['claude'],
          dependencies: [],
          defaultInstall: true,
          cost: 'light',
          stability: 'stable'
        }
      ]
    });
    writeJson(path.join(testDir, 'manifests', 'install-profiles.json'), {
      version: 1,
      profiles: {
        core: { description: 'Core', modules: ['rules-core'] },
        developer: { description: 'Developer', modules: ['rules-core'] },
        security: { description: 'Security', modules: ['rules-core'] },
        research: { description: 'Research', modules: ['rules-core'] },
        full: { description: 'Full', modules: ['rules-core'] }
      }
    });
    writeInstallComponentsManifest(testDir, [
      {
        id: 'capability:security',
        family: 'capability',
        description: 'Security',
        modules: ['ghost-module']
      }
    ]);
    fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });

    const result = runValidatorWithDirs('validate-install-manifests', {
      REPO_ROOT: testDir,
      MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
      PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json'),
      COMPONENTS_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-components.json'),
      MODULES_SCHEMA_PATH: modulesSchemaPath,
      PROFILES_SCHEMA_PATH: profilesSchemaPath,
      COMPONENTS_SCHEMA_PATH: componentsSchemaPath
    });
    assert.strictEqual(result.code, 1, 'Should fail on unknown component module');
    assert.ok(result.stderr.includes('references unknown module ghost-module'),
      'Should report unknown component module');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // Summary
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
