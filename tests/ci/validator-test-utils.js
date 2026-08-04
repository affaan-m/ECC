/**
 * Shared helpers for the CI validator test suite (tests/ci/*.test.js).
 *
 * Provides fixture builders and wrappers that run the real validator
 * scripts against temporary directories, plus a small test() / finish()
 * harness that tracks pass/fail counts per test file.
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

// Test harness: per-process pass/fail counters, reported by finish()
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    // Assertion failures are self-describing; anything else is a test bug
    // where the stack is needed to locate the crash.
    const detail = err instanceof assert.AssertionError ? err.message : err.stack || err.message;
    console.log(`    Error: ${detail}`);
    failed++;
  }
}

function finish() {
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ci-validator-test-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

/**
 * Create a temp fixture directory, run fn(testDir), and always clean up —
 * even when an assertion inside fn throws.
 */
function withTestDir(fn) {
  const testDir = createTestDir();
  try {
    return fn(testDir);
  } finally {
    cleanupTestDir(testDir);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeInstallComponentsManifest(testDir, components) {
  writeJson(path.join(testDir, 'manifests', 'install-components.json'), {
    version: 1,
    components
  });
}

function writeInstallModulesManifest(testDir, modules) {
  writeJson(path.join(testDir, 'manifests', 'install-modules.json'), {
    version: 1,
    modules
  });
}

function writeInstallProfilesManifest(testDir, profiles) {
  writeJson(path.join(testDir, 'manifests', 'install-profiles.json'), {
    version: 1,
    profiles
  });
}

function writeSkillFixture(testDir, skillId, description) {
  const skillDir = path.join(testDir, 'skills', skillId);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${skillId}\ndescription: ${description}\n---\n# ${skillId}\n`);
}

function stripShebang(source) {
  let s = source;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  return s;
}

/**
 * Run modified source via a temp file (avoids Windows node -e shebang issues).
 * The temp file is written inside the repo so require() can resolve node_modules.
 * Captures stderr on both success and failure so WARN-only output is visible.
 * @param {string} source - JavaScript source to execute
 * @param {Record<string, string>} [envOverrides] - extra env vars for the child
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runSourceViaTempFile(source, envOverrides = {}) {
  const tmpFile = path.join(repoRoot, `.tmp-validator-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, source, 'utf8');
    const r = spawnSync('node', [tmpFile], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: repoRoot,
      env: { ...process.env, ...envOverrides }
    });
    if (r.error) {
      return { code: 1, stdout: r.stdout || '', stderr: r.stderr || r.error.message };
    }
    return {
      code: typeof r.status === 'number' ? r.status : 1,
      stdout: r.stdout || '',
      stderr: r.stderr || ''
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (cleanupErr) {
      console.error(`[validator-test-utils] Failed to remove temp file ${tmpFile}: ${cleanupErr.message}`);
    }
  }
}

/**
 * Replace a `const NAME = ...;` declaration in validator source, throwing when
 * the declaration is absent so a renamed constant fails loudly instead of
 * silently running the validator against the real project. Uses a replacement
 * function so values containing `$` (e.g. Windows paths) are inserted literally.
 */
function replaceConstant(source, constant, value) {
  const declRegex = new RegExp(`const ${constant} = .*?;`);
  if (!declRegex.test(source)) {
    throw new Error(`Could not find "const ${constant} = ...;" in validator source to override`);
  }
  return source.replace(declRegex, () => `const ${constant} = ${JSON.stringify(value)};`);
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
  return runValidatorWithDirs(validatorName, { [dirConstant]: overridePath });
}

/**
 * Run a validator script with multiple directory overrides and optional
 * extra source substitutions.
 * @param {string} validatorName
 * @param {Record<string, string>} overrides - map of constant name to path
 * @param {Array<{pattern: RegExp, replacement: string}>} [extraReplacements]
 */
function runValidatorWithDirs(validatorName, overrides, extraReplacements = []) {
  const validatorPath = path.join(validatorsDir, `${validatorName}.js`);

  // Remove the shebang line so wrappers also work against CRLF-checked-out files on Windows.
  let source = stripShebang(fs.readFileSync(validatorPath, 'utf8'));

  for (const [constant, overridePath] of Object.entries(overrides)) {
    source = replaceConstant(source, constant, overridePath);
  }
  for (const { pattern, replacement } of extraReplacements) {
    if (!pattern.test(source)) {
      throw new Error(`Extra replacement pattern ${pattern} did not match validator source`);
    }
    source = source.replace(pattern, () => replacement);
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
      timeout: 15000
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || ''
    };
  }
}

function runCatalogValidator(overrides = {}) {
  const { argv: argvOverride, ...constantOverrides } = overrides;
  const validatorPath = path.join(validatorsDir, 'catalog.js');
  let source = stripShebang(fs.readFileSync(validatorPath, 'utf8'));
  const argv = Array.isArray(argvOverride) && argvOverride.length > 0 ? argvOverride : ['--text'];
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
    ...constantOverrides
  };

  for (const [constant, overridePath] of Object.entries(resolvedOverrides)) {
    source = replaceConstant(source, constant, overridePath);
  }

  return runSourceViaTempFile(source);
}

// Run validate-skills.js against a fixture dir, optionally passing
// extra argv (e.g. '--strict') and env overrides (e.g. CI_STRICT_SKILLS=1)
// so the frontmatter finding suite can exercise both warn and strict modes
// via argv and env code paths.
function runSkillsValidator(testDir, argv = [], envOverrides = {}) {
  const validatorPath = path.join(validatorsDir, 'validate-skills.js');
  let source = stripShebang(fs.readFileSync(validatorPath, 'utf8'));
  source = replaceConstant(source, 'SKILLS_DIR', testDir);
  if (argv.length > 0) {
    const argvPreamble = argv.map(arg => `process.argv.push(${JSON.stringify(arg)});`).join('\n');
    source = `${argvPreamble}\n${source}`;
  }
  return runSourceViaTempFile(source, { CI_STRICT_SKILLS: '', ...envOverrides });
}

function writeCatalogFixture(testDir, options = {}) {
  const {
    readmeCounts = { agents: 1, skills: 1, commands: 1 },
    readmeProjectTreeAgents = readmeCounts.agents,
    readmeTableCounts = readmeCounts,
    readmeParityCounts = readmeCounts,
    readmeUnrelatedSkillsCount = 16,
    summaryCounts = { agents: 1, skills: 1, commands: 1 },
    structureLines = ['agents/          — 1 specialized subagents', 'skills/          — 1 workflow skills and domain knowledge', 'commands/        — 1 slash commands'],
    zhRootReadmeCounts = { agents: 1, skills: 1, commands: 1 },
    zhDocsReadmeCounts = { agents: 1, skills: 1, commands: 1 },
    zhDocsTableCounts = zhDocsReadmeCounts,
    zhDocsParityCounts = zhDocsReadmeCounts,
    zhDocsUnrelatedSkillsCount = 16,
    zhAgentsSummaryCounts = { agents: 1, skills: 1, commands: 1 },
    zhAgentsStructureLines = ['agents/          — 1 个专业子代理', 'skills/          — 1 个工作流技能和领域知识', 'commands/        — 1 个斜杠命令'],
    pluginCounts = { agents: 1, skills: 1, commands: 1 },
    marketplaceCounts = { agents: 1, skills: 1, commands: 1 }
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

  fs.writeFileSync(
    readmePath,
    `Access to ${readmeCounts.agents} agents, ${readmeCounts.skills} skills, and ${readmeCounts.commands} commands.\n- **Public surface synced to the live repo** - metadata, catalog counts, plugin manifests, and install-facing docs now match the actual OSS surface: ${readmeCounts.agents} agents, ${readmeCounts.skills} skills, and ${readmeCounts.commands} legacy command shims.\n|-- agents/           # ${readmeProjectTreeAgents} specialized subagents for delegation\n| Feature | Claude Code | Cursor IDE | Codex CLI | OpenCode |\n|---------|------------|------------|-----------|----------|\n| Agents | PASS: ${readmeTableCounts.agents} agents | Shared | Shared | 1 |\n| Commands | PASS: ${readmeTableCounts.commands} commands | Shared | Shared | 1 |\n| Skills | PASS: ${readmeTableCounts.skills} skills | Shared | Shared | 1 |\n\n| Feature | Count | Format |\n|-----------|-------|---------|\n| Skills | ${readmeUnrelatedSkillsCount} | .agents/skills/ |\n\n## Cross-Tool Feature Parity\n\n| Feature | Claude Code | Cursor IDE | Codex CLI | OpenCode |\n|---------|------------|------------|-----------|----------|\n| **Agents** | ${readmeParityCounts.agents} | Shared (AGENTS.md) | Shared (AGENTS.md) | 12 |\n| **Commands** | ${readmeParityCounts.commands} | Shared | Instruction-based | 31 |\n| **Skills** | ${readmeParityCounts.skills} | Shared | 10 (native format) | 37 |\n`
  );
  fs.writeFileSync(
    agentsPath,
    `This is a **production-ready AI coding plugin** providing ${summaryCounts.agents} specialized agents, ${summaryCounts.skills} skills, ${summaryCounts.commands} commands, and automated hook workflows for software development.\n\n\`\`\`\n${structureLines.join('\n')}\n\`\`\`\n`
  );
  fs.writeFileSync(zhRootReadmePath, `**完成！** 你现在可以使用 ${zhRootReadmeCounts.agents} 个代理、${zhRootReadmeCounts.skills} 个技能和 ${zhRootReadmeCounts.commands} 个命令。\n`);
  fs.writeFileSync(
    zhDocsReadmePath,
    `**搞定！** 你现在可以使用 ${zhDocsReadmeCounts.agents} 个智能体、${zhDocsReadmeCounts.skills} 项技能和 ${zhDocsReadmeCounts.commands} 个命令了。\n| 功能特性 | Claude Code | OpenCode | 状态 |\n|---------|-------------|----------|--------|\n| 智能体 | \u2705 ${zhDocsTableCounts.agents} 个 | \u2705 12 个 | **Claude Code 领先** |\n| 命令 | \u2705 ${zhDocsTableCounts.commands} 个 | \u2705 31 个 | **Claude Code 领先** |\n| 技能 | \u2705 ${zhDocsTableCounts.skills} 项 | \u2705 37 项 | **Claude Code 领先** |\n\n| 功能特性 | 数量 | 格式 |\n|-----------|-------|---------|\n| 技能 | ${zhDocsUnrelatedSkillsCount} | .agents/skills/ |\n\n## 跨工具功能对等\n\n| 功能特性 | Claude Code | Cursor IDE | Codex CLI | OpenCode |\n|---------|------------|------------|-----------|----------|\n| **智能体** | ${zhDocsParityCounts.agents} | 共享 (AGENTS.md) | 共享 (AGENTS.md) | 12 |\n| **命令** | ${zhDocsParityCounts.commands} | 共享 | 基于指令 | 31 |\n| **技能** | ${zhDocsParityCounts.skills} | 共享 | 10 (原生格式) | 37 |\n`
  );
  fs.writeFileSync(
    zhAgentsPath,
    `这是一个**生产就绪的 AI 编码插件**，提供 ${zhAgentsSummaryCounts.agents} 个专业代理、${zhAgentsSummaryCounts.skills} 项技能、${zhAgentsSummaryCounts.commands} 条命令以及自动化钩子工作流，用于软件开发。\n\n\`\`\`\n${zhAgentsStructureLines.join('\n')}\n\`\`\`\n`
  );
  fs.writeFileSync(
    pluginJsonPath,
    JSON.stringify(
      {
        name: 'ecc',
        description: `Battle-tested plugin — ${pluginCounts.agents} agents, ${pluginCounts.skills} skills, ${pluginCounts.commands} legacy command shims`
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    marketplaceJsonPath,
    JSON.stringify(
      {
        plugins: [
          {
            name: 'ecc',
            description: `Marketplace plugin — ${marketplaceCounts.agents} agents, ${marketplaceCounts.skills} skills, ${marketplaceCounts.commands} legacy command shims`
          }
        ]
      },
      null,
      2
    )
  );

  return { readmePath, agentsPath, zhRootReadmePath, zhDocsReadmePath, zhAgentsPath, pluginJsonPath, marketplaceJsonPath };
}

module.exports = {
  test,
  finish,
  createTestDir,
  cleanupTestDir,
  withTestDir,
  writeJson,
  writeInstallComponentsManifest,
  writeInstallModulesManifest,
  writeInstallProfilesManifest,
  writeSkillFixture,
  stripShebang,
  runSourceViaTempFile,
  runValidatorWithDir,
  runValidatorWithDirs,
  runValidator,
  runCatalogValidator,
  runSkillsValidator,
  writeCatalogFixture,
  validatorsDir,
  repoRoot,
  modulesSchemaPath,
  profilesSchemaPath,
  componentsSchemaPath
};
