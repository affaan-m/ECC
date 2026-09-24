/**
 * Tests for plugin manifests:
 *   - .claude-plugin/plugin.json (Claude Code plugin)
 *   - .codex-plugin/plugin.json (Codex native plugin)
 *   - .mcp.json (MCP server config at plugin root)
 *   - .agents/plugins/marketplace.json (Codex marketplace discovery)
 *
 * Enforces rules from:
 *   - .claude-plugin/PLUGIN_SCHEMA_NOTES.md (Claude Code validator rules)
 *   - https://platform.openai.com/docs/codex/plugins (Codex official docs)
 *
 * Run with: node tests/run-all.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageLockPath = path.join(repoRoot, 'package-lock.json');
const rootAgentsPath = path.join(repoRoot, 'AGENTS.md');
const trAgentsPath = path.join(repoRoot, 'docs', 'tr', 'AGENTS.md');
const zhCnAgentsPath = path.join(repoRoot, 'docs', 'zh-CN', 'AGENTS.md');
const ptBrReadmePath = path.join(repoRoot, 'docs', 'pt-BR', 'README.md');
const trReadmePath = path.join(repoRoot, 'docs', 'tr', 'README.md');
const rootZhCnReadmePath = path.join(repoRoot, 'README.zh-CN.md');
const agentYamlPath = path.join(repoRoot, 'agent.yaml');
const versionFilePath = path.join(repoRoot, 'VERSION');
const zhCnReadmePath = path.join(repoRoot, 'docs', 'zh-CN', 'README.md');
const selectiveInstallArchitecturePath = path.join(repoRoot, 'docs', 'SELECTIVE-INSTALL-ARCHITECTURE.md');
const opencodePackageJsonPath = path.join(repoRoot, '.opencode', 'package.json');
const opencodePackageLockPath = path.join(repoRoot, '.opencode', 'package-lock.json');
const opencodeHooksPluginPath = path.join(repoRoot, '.opencode', 'plugins', 'ecc-hooks.ts');
const semverPattern = '[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function loadJsonObject(filePath, label) {
  assert.ok(fs.existsSync(filePath), `Expected ${label} to exist`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    assert.fail(`Expected ${label} to contain valid JSON: ${error.message}`);
  }

  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), `Expected ${label} to contain a JSON object`);

  return parsed;
}

function collectMarkdownFiles(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const stat = fs.statSync(rootPath);
  if (stat.isFile()) {
    return rootPath.endsWith('.md') ? [rootPath] : [];
  }

  const files = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(nextPath));
    } else if (entry.isFile() && nextPath.endsWith('.md')) {
      files.push(nextPath);
    }
  }
  return files;
}

const rootPackage = loadJsonObject(packageJsonPath, 'package.json');
const packageLock = loadJsonObject(packageLockPath, 'package-lock.json');
const opencodePackageLock = loadJsonObject(opencodePackageLockPath, '.opencode/package-lock.json');
const expectedVersion = rootPackage.version;

test('package.json has version field', () => {
  assert.ok(expectedVersion, 'Expected package.json version field');
});

test('package-lock.json root version matches package.json', () => {
  assert.strictEqual(packageLock.version, expectedVersion);
  assert.ok(packageLock.packages && packageLock.packages[''], 'Expected package-lock root package entry');
  assert.strictEqual(packageLock.packages[''].version, expectedVersion);
});

test('AGENTS.md version line matches package.json', () => {
  const agentsSource = fs.readFileSync(rootAgentsPath, 'utf8');
  const match = agentsSource.match(new RegExp(`^\\*\\*Version:\\*\\* (${semverPattern})$`, 'm'));
  assert.ok(match, 'Expected AGENTS.md to declare a top-level version line');
  assert.strictEqual(match[1], expectedVersion);
});

test('docs/tr/AGENTS.md version line matches package.json', () => {
  const agentsSource = fs.readFileSync(trAgentsPath, 'utf8');
  const match = agentsSource.match(new RegExp(`^\\*\\*Sürüm:\\*\\* (${semverPattern})$`, 'm'));
  assert.ok(match, 'Expected docs/tr/AGENTS.md to declare a top-level version line');
  assert.strictEqual(match[1], expectedVersion);
});

test('docs/zh-CN/AGENTS.md version line matches package.json', () => {
  const agentsSource = fs.readFileSync(zhCnAgentsPath, 'utf8');
  const match = agentsSource.match(new RegExp(`^\\*\\*版本:\\*\\* (${semverPattern})$`, 'm'));
  assert.ok(match, 'Expected docs/zh-CN/AGENTS.md to declare a top-level version line');
  assert.strictEqual(match[1], expectedVersion);
});

test('agent.yaml version matches package.json', () => {
  const agentYamlSource = fs.readFileSync(agentYamlPath, 'utf8');
  const match = agentYamlSource.match(new RegExp(`^version:\\s*(${semverPattern})$`, 'm'));
  assert.ok(match, 'Expected agent.yaml to declare a top-level version field');
  assert.strictEqual(match[1], expectedVersion);
});

test('agent.yaml uses canonical ECC identity', () => {
  const agentYamlSource = fs.readFileSync(agentYamlPath, 'utf8');
  assert.ok(/^name:\s*ecc$/m.test(agentYamlSource), 'Expected agent.yaml to use the ecc name');
});

test('VERSION file matches package.json', () => {
  const versionFile = fs.readFileSync(versionFilePath, 'utf8').trim();
  assert.ok(versionFile, 'Expected VERSION file to be non-empty');
  assert.strictEqual(versionFile, expectedVersion);
});

test('docs/SELECTIVE-INSTALL-ARCHITECTURE.md repoVersion example matches package.json', () => {
  const source = fs.readFileSync(selectiveInstallArchitecturePath, 'utf8');
  const match = source.match(new RegExp(`"repoVersion":\\s*"(${semverPattern})"`));
  assert.ok(match, 'Expected docs/SELECTIVE-INSTALL-ARCHITECTURE.md to declare a repoVersion example');
  assert.strictEqual(match[1], expectedVersion);
});

test('.opencode/plugins/ecc-hooks.ts active plugin banner matches package.json', () => {
  const source = fs.readFileSync(opencodeHooksPluginPath, 'utf8');
  const match = source.match(new RegExp(`## Active Plugin: ECC v(${semverPattern})`));
  assert.ok(match, 'Expected .opencode/plugins/ecc-hooks.ts to declare an active plugin banner');
  assert.strictEqual(match[1], expectedVersion);
});

test('docs/pt-BR/README.md latest release heading matches package.json', () => {
  const source = fs.readFileSync(ptBrReadmePath, 'utf8');
  assert.ok(source.includes(`### v${expectedVersion} `), 'Expected docs/pt-BR/README.md to advertise the current release heading');
});

test('docs/tr/README.md latest release heading matches package.json', () => {
  const source = fs.readFileSync(trReadmePath, 'utf8');
  assert.ok(source.includes(`### v${expectedVersion} `), 'Expected docs/tr/README.md to advertise the current release heading');
});

test('README.zh-CN.md latest release heading matches package.json', () => {
  const source = fs.readFileSync(rootZhCnReadmePath, 'utf8');
  assert.ok(source.includes(`### v${expectedVersion} `), 'Expected README.zh-CN.md to advertise the current release heading');
});

test('docs/zh-CN/README.md latest release heading matches package.json', () => {
  const source = fs.readFileSync(zhCnReadmePath, 'utf8');
  assert.ok(source.includes(`### v${expectedVersion} `), 'Expected docs/zh-CN/README.md to advertise the current release heading');
});

// ── Claude plugin manifest ────────────────────────────────────────────────────
console.log('\n=== .claude-plugin/plugin.json ===\n');

const claudePluginPath = path.join(repoRoot, '.claude-plugin', 'plugin.json');
const claudeMarketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');

test('claude plugin.json exists', () => {
  assert.ok(fs.existsSync(claudePluginPath), 'Expected .claude-plugin/plugin.json to exist');
});

const claudePlugin = loadJsonObject(claudePluginPath, '.claude-plugin/plugin.json');

test('claude plugin.json has version field', () => {
  assert.ok(claudePlugin.version, 'Expected version field');
});

test('claude plugin.json version matches package.json', () => {
  assert.strictEqual(claudePlugin.version, expectedVersion);
});

test('claude plugin.json uses short plugin slug', () => {
  assert.strictEqual(claudePlugin.name, 'ecc');
});

test('claude plugin.json does NOT have agents field (unsupported by Claude Code validator)', () => {
  assert.ok(!('agents' in claudePlugin), 'agents field must NOT be declared — Claude Code plugin validator rejects it');
});

test('claude plugin.json skills is an array', () => {
  assert.ok(Array.isArray(claudePlugin.skills), 'Expected skills to be an array');
});

test('claude plugin.json commands is an array', () => {
  assert.ok(Array.isArray(claudePlugin.commands), 'Expected commands to be an array');
});

test('claude plugin.json disables bundled MCP servers for provider tool-name compatibility', () => {
  const legacyPluginName = 'everything-claude-code';
  const reportedOverlongToolName = `mcp__plugin_${legacyPluginName}_github__create_pull_request_review`;

  assert.ok(reportedOverlongToolName.length > 64, 'Expected the reported GitHub MCP tool name to exceed strict provider limits without the MCP opt-out');
  assert.ok(Object.prototype.hasOwnProperty.call(claudePlugin, 'mcpServers'), 'Expected mcpServers to be explicitly declared so Claude Code does not auto-load root .mcp.json');
  assert.deepStrictEqual(claudePlugin.mcpServers, {}, 'Claude plugin installs must not auto-bundle root MCP servers; document/manual MCP install remains supported');
});

test('claude plugin.json does NOT have explicit hooks declaration', () => {
  assert.ok(!('hooks' in claudePlugin), 'hooks field must NOT be declared — Claude Code v2.1+ auto-loads hooks/hooks.json by convention');
});

console.log('\n=== .claude-plugin/marketplace.json ===\n');

test('claude marketplace.json exists', () => {
  assert.ok(fs.existsSync(claudeMarketplacePath), 'Expected .claude-plugin/marketplace.json to exist');
});

const claudeMarketplace = loadJsonObject(claudeMarketplacePath, '.claude-plugin/marketplace.json');

test('claude marketplace.json keeps only Claude-supported top-level keys', () => {
  const unsupportedTopLevelKeys = ['$schema', 'description'];
  for (const key of unsupportedTopLevelKeys) {
    assert.ok(!(key in claudeMarketplace), `.claude-plugin/marketplace.json must not declare unsupported top-level key "${key}"`);
  }
});

test('claude marketplace.json has plugins array with the published plugin entry', () => {
  assert.ok(Array.isArray(claudeMarketplace.plugins) && claudeMarketplace.plugins.length > 0, 'Expected plugins array');
  assert.strictEqual(claudeMarketplace.name, 'ecc');
  assert.strictEqual(claudeMarketplace.plugins[0].name, 'ecc');
});

test('claude marketplace.json plugin version matches package.json', () => {
  assert.strictEqual(claudeMarketplace.plugins[0].version, expectedVersion);
});

// ── Codex plugin manifest ─────────────────────────────────────────────────────
// Per official docs: https://platform.openai.com/docs/codex/plugins
// - .codex-plugin/plugin.json is the required manifest
// - skills, mcpServers, apps are STRING paths relative to plugin root (not arrays)
// - .mcp.json must be at plugin root (NOT inside .codex-plugin/)
console.log('\n=== .codex-plugin/plugin.json ===\n');

const codexPluginPath = path.join(repoRoot, '.codex-plugin', 'plugin.json');

test('codex plugin.json exists', () => {
  assert.ok(fs.existsSync(codexPluginPath), 'Expected .codex-plugin/plugin.json to exist');
});

const codexPlugin = loadJsonObject(codexPluginPath, '.codex-plugin/plugin.json');

test('codex plugin.json has name field', () => {
  assert.ok(codexPlugin.name, 'Expected name field');
});

test('codex plugin.json uses short plugin slug', () => {
  assert.strictEqual(codexPlugin.name, 'ecc');
});

test('codex plugin.json has version field', () => {
  assert.ok(codexPlugin.version, 'Expected version field');
});

test('codex plugin.json version matches package.json', () => {
  assert.strictEqual(codexPlugin.version, expectedVersion);
});

test('codex plugin.json skills is a string (not array) per official spec', () => {
  assert.strictEqual(typeof codexPlugin.skills, 'string', 'skills must be a string path per Codex official docs, not an array');
});

test('codex plugin.json mcpServers is a string path (not array) per official spec', () => {
  assert.strictEqual(typeof codexPlugin.mcpServers, 'string', 'mcpServers must be a string path per Codex official docs');
});

test('codex plugin.json mcpServers exactly matches "./.mcp.json"', () => {
  assert.strictEqual(codexPlugin.mcpServers, './.mcp.json', 'mcpServers must point exactly to "./.mcp.json" per official docs');
  const mcpPath = path.join(repoRoot, codexPlugin.mcpServers.replace(/^\.\//, ''));
  assert.ok(fs.existsSync(mcpPath), `mcpServers file missing at plugin root: ${codexPlugin.mcpServers}`);
});

test('codex plugin.json has interface.displayName', () => {
  assert.ok(codexPlugin.interface && codexPlugin.interface.displayName, 'Expected interface.displayName for plugin directory presentation');
});

test('codex plugin.json uses canonical ECC repo and display name', () => {
  assert.strictEqual(codexPlugin.repository, 'https://github.com/affaan-m/ECC');
  assert.strictEqual(codexPlugin.interface.displayName, 'ECC');
});

test('codex plugin presentation assets exist and ship in npm package', () => {
  assert.ok(Array.isArray(rootPackage.files), 'Expected package.json files array');
  const packageFiles = new Set(rootPackage.files);

  for (const field of ['composerIcon', 'logo']) {
    const assetPath = codexPlugin.interface[field];
    assert.ok(assetPath, `Expected interface.${field}`);
    assert.ok(assetPath.startsWith('./assets/'), `Expected interface.${field} to point at a root assets path, got ${assetPath}`);

    const packagePath = assetPath.replace(/^\.\//, '');
    assert.ok(fs.existsSync(path.join(repoRoot, packagePath)), `Expected interface.${field} asset to exist: ${packagePath}`);
    assert.ok(packageFiles.has(packagePath), `Expected package.json files to include interface.${field} asset: ${packagePath}`);
  }
});

// ── .mcp.json at plugin root ──────────────────────────────────────────────────
// Per official docs: keep .mcp.json at plugin root, NOT inside .codex-plugin/
console.log('\n=== .mcp.json (plugin root) ===\n');

const mcpJsonPath = path.join(repoRoot, '.mcp.json');

test('.mcp.json exists at plugin root (not inside .codex-plugin/)', () => {
  assert.ok(fs.existsSync(mcpJsonPath), 'Expected .mcp.json at repo root (plugin root)');
  assert.ok(!fs.existsSync(path.join(repoRoot, '.codex-plugin', '.mcp.json')), '.mcp.json must NOT be inside .codex-plugin/ — only plugin.json belongs there');
});

const mcpConfig = loadJsonObject(mcpJsonPath, '.mcp.json');

test('.mcp.json has mcpServers object', () => {
  assert.ok(mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object', 'Expected mcpServers object');
});

test('.mcp.json default set follows the connector policy', () => {
  const servers = Object.keys(mcpConfig.mcpServers);
  assert.ok(servers.includes('chrome-devtools'), 'Expected chrome-devtools as the default browser connector');
  assert.ok(servers.length <= 2, `Default connector set must stay minimal per docs/MCP-CONNECTOR-POLICY.md (found ${servers.length})`);
});

test('.mcp.json does not reintroduce retired default connectors', () => {
  const retired = ['github', 'context7', 'exa', 'memory', 'playwright', 'sequential-thinking'];
  const servers = Object.keys(mcpConfig.mcpServers);
  for (const name of retired) {
    assert.ok(!servers.includes(name), `${name} was retired from the default set (June 2026 audit) — it lives in mcp-configs/mcp-servers.json as opt-in; see docs/MCP-CONNECTOR-POLICY.md`);
  }
});

// ── Codex marketplace file ────────────────────────────────────────────────────
// Per official docs: repo marketplace lives at $REPO_ROOT/.agents/plugins/marketplace.json
console.log('\n=== .agents/plugins/marketplace.json ===\n');

const marketplacePath = path.join(repoRoot, '.agents', 'plugins', 'marketplace.json');

test('marketplace.json exists at .agents/plugins/', () => {
  assert.ok(fs.existsSync(marketplacePath), 'Expected .agents/plugins/marketplace.json for Codex repo marketplace discovery');
});

const marketplace = loadJsonObject(marketplacePath, '.agents/plugins/marketplace.json');
const opencodePackage = loadJsonObject(opencodePackageJsonPath, '.opencode/package.json');

test('marketplace.json has name field', () => {
  assert.ok(marketplace.name, 'Expected name field');
});

test('marketplace.json uses short marketplace slug', () => {
  assert.strictEqual(marketplace.name, 'ecc');
});

test('marketplace.json has plugins array with at least one entry', () => {
  assert.ok(Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0, 'Expected plugins array');
});

test('marketplace.json plugin entries have required fields', () => {
  for (const plugin of marketplace.plugins) {
    assert.ok(plugin.name, `Plugin entry missing name`);
    assert.ok(plugin.version, `Plugin "${plugin.name}" missing version`);
    assert.ok(plugin.source && plugin.source.source, `Plugin "${plugin.name}" missing source.source`);
    assert.ok(plugin.policy && plugin.policy.installation, `Plugin "${plugin.name}" missing policy.installation`);
    assert.ok(plugin.category, `Plugin "${plugin.name}" missing category`);
  }
});

test('marketplace.json plugin entry uses short plugin slug', () => {
  assert.strictEqual(marketplace.plugins[0].name, 'ecc');
});

test('marketplace.json plugin version matches package.json', () => {
  assert.strictEqual(marketplace.plugins[0].version, expectedVersion);
});

test('marketplace local plugin path resolves to a concrete plugin subdirectory (#2128)', () => {
  // Codex does not discover plugins whose local marketplace source.path is the
  // marketplace root itself ("./") — verified against Codex CLI 0.137.0 and
  // the official docs ($REPO_ROOT/plugins/<name>). The entry must point at a
  // real plugin folder strictly inside the repo.
  for (const plugin of marketplace.plugins) {
    if (!plugin.source || plugin.source.source !== 'local') {
      continue;
    }

    assert.ok(plugin.source.path.startsWith('./'), `Codex marketplace source.path must be ./-prefixed: ${plugin.source.path}`);
    const resolvedRoot = path.resolve(repoRoot, plugin.source.path);
    assert.notStrictEqual(resolvedRoot, repoRoot, `Codex never discovers "./" marketplace roots — source.path must target a plugin subdirectory (#2128), got: ${plugin.source.path}`);
    assert.ok(resolvedRoot.startsWith(repoRoot + path.sep), `Expected local marketplace path to stay inside the repo, got: ${plugin.source.path}`);
    assert.ok(fs.existsSync(path.join(resolvedRoot, '.codex-plugin', 'plugin.json')), `Codex plugin manifest missing under resolved plugin folder: ${plugin.source.path}`);
  }
});

// ── plugins/ecc marketplace plugin folder ─────────────────────────────────────
// Thin Codex plugin target for the repo marketplace. Content is single-sourced
// at the repo root (no vendored skills/MCP copies) per the maintainer direction
// on #2097; these tests pin the manifest sync and the parent-relative refs.
console.log('\n=== plugins/ecc Codex marketplace plugin folder ===\n');

const marketplacePluginManifestPath = path.join(repoRoot, 'plugins', 'ecc', '.codex-plugin', 'plugin.json');
const marketplacePluginManifest = loadJsonObject(marketplacePluginManifestPath, 'plugins/ecc/.codex-plugin/plugin.json');
const rootCodexManifest = loadJsonObject(path.join(repoRoot, '.codex-plugin', 'plugin.json'), '.codex-plugin/plugin.json');

test('plugins/ecc manifest name matches the root Codex manifest', () => {
  assert.strictEqual(marketplacePluginManifest.name, rootCodexManifest.name);
});

test('plugins/ecc manifest version matches package.json', () => {
  assert.strictEqual(marketplacePluginManifest.version, expectedVersion);
});

test('plugins/ecc manifest version matches the root Codex manifest', () => {
  assert.strictEqual(marketplacePluginManifest.version, rootCodexManifest.version);
});

test('plugins/ecc manifest reuses root skills and MCP config without vendoring', () => {
  const pluginDir = path.dirname(path.dirname(marketplacePluginManifestPath));

  const skillsTarget = path.resolve(pluginDir, marketplacePluginManifest.skills);
  assert.strictEqual(skillsTarget, path.join(repoRoot, 'skills'), `skills ref must resolve to the root skills/ directory, got: ${marketplacePluginManifest.skills}`);
  assert.ok(fs.existsSync(skillsTarget), 'Root skills/ directory missing');

  const mcpTarget = path.resolve(pluginDir, marketplacePluginManifest.mcpServers);
  assert.strictEqual(mcpTarget, path.join(repoRoot, '.mcp.json'), `mcpServers ref must resolve to the root .mcp.json, got: ${marketplacePluginManifest.mcpServers}`);
  assert.ok(fs.existsSync(mcpTarget), 'Root .mcp.json missing');

  assert.ok(!fs.existsSync(path.join(pluginDir, 'skills')), 'plugins/ecc must not vendor a second skills/ copy (see #2097 review)');
  assert.ok(!fs.existsSync(path.join(pluginDir, '.mcp.json')), 'plugins/ecc must not vendor a second .mcp.json (see #2097 review)');
});

test('plugins/ecc manifest interface assets resolve to root assets', () => {
  const pluginDir = path.dirname(path.dirname(marketplacePluginManifestPath));

  for (const ref of [marketplacePluginManifest.interface.composerIcon, marketplacePluginManifest.interface.logo]) {
    const target = path.resolve(pluginDir, ref);
    assert.ok(target.startsWith(path.join(repoRoot, 'assets') + path.sep), `Asset ref must resolve under root assets/: ${ref}`);
    assert.ok(fs.existsSync(target), `Asset ref target missing: ${ref}`);
  }
});

test('plugins/ecc README documents the upstream Codex fragility', () => {
  const readmePath = path.join(repoRoot, 'plugins', 'ecc', 'README.md');
  assert.ok(fs.existsSync(readmePath), 'Expected plugins/ecc/README.md');
  const source = fs.readFileSync(readmePath, 'utf8');
  assert.ok(source.includes('openai/codex'), 'plugins/ecc README must link the upstream Codex discovery issue');
  assert.ok(source.includes('sync-ecc-to-codex.sh'), 'plugins/ecc README must point at the supported manual sync flow');
});

test('.opencode/package.json version matches package.json', () => {
  assert.strictEqual(opencodePackage.version, expectedVersion);
});

test('.opencode/package-lock.json root version matches package.json', () => {
  assert.strictEqual(opencodePackageLock.version, expectedVersion);
  assert.ok(opencodePackageLock.packages && opencodePackageLock.packages[''], 'Expected .opencode/package-lock root package entry');
  assert.strictEqual(opencodePackageLock.packages[''].version, expectedVersion);
});

test('README version row matches package.json', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const match = readme.match(new RegExp(`^\\| \\*\\*Version\\*\\* \\| Plugin \\| Plugin \\| Reference config \\| (${semverPattern}) \\|(?: Instruction layer \\|)?$`, 'm'));
  assert.ok(match, 'Expected README version summary row');
  assert.strictEqual(match[1], expectedVersion);
});

test('user-facing docs do not use overlong legacy marketplace install commands', () => {
  const markdownFiles = [
    path.join(repoRoot, 'README.md'),
    path.join(repoRoot, 'README.zh-CN.md'),
    path.join(repoRoot, 'skills', 'configure-ecc', 'SKILL.md'),
    ...collectMarkdownFiles(path.join(repoRoot, 'docs'))
  ].filter(filePath => !path.relative(repoRoot, filePath).startsWith(`docs${path.sep}drafts${path.sep}`));

  const offenders = [];
  for (const filePath of markdownFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (/\/plugin\s+(install|list)\s+everything-claude-code(?:@everything-claude-code)?\b/.test(source)) {
      offenders.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepStrictEqual(offenders, [], `Overlong legacy install commands must not appear in user-facing docs: ${offenders.join(', ')}`);
});

test('user-facing docs do not use the legacy non-URL marketplace add form', () => {
  const markdownFiles = [path.join(repoRoot, 'README.md'), path.join(repoRoot, 'README.zh-CN.md'), ...collectMarkdownFiles(path.join(repoRoot, 'docs'))];

  const offenders = [];
  for (const filePath of markdownFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('/plugin marketplace add affaan-m/everything-claude-code')) {
      offenders.push(path.relative(repoRoot, filePath));
    }
  }

  assert.deepStrictEqual(offenders, [], `Legacy non-URL marketplace add form must not appear in user-facing docs: ${offenders.join(', ')}`);
});

test('.codex-plugin README uses current marketplace add flow', () => {
  const readme = fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'README.md'), 'utf8');
  assert.ok(readme.includes('codex plugin marketplace add'), 'Expected .codex-plugin README to document codex plugin marketplace add');
  assert.ok(readme.includes('codex plugin marketplace add affaan-m/ECC'), 'Expected .codex-plugin README to document the canonical ECC repo marketplace source');
  assert.ok(readme.includes('Official Plugin Directory publishing is coming soon'), 'Expected .codex-plugin README to document current official directory status');
  assert.ok(!/\bcodex plugin install\b/.test(readme), 'codex plugin install is not a current Codex CLI command');
});

test('docs/zh-CN/README.md version row matches package.json', () => {
  const readme = fs.readFileSync(zhCnReadmePath, 'utf8');
  const match = readme.match(new RegExp(`^\\| \\*\\*版本\\*\\* \\| 插件 \\| 插件 \\| 参考配置 \\| (${semverPattern}) \\|$`, 'm'));
  assert.ok(match, 'Expected docs/zh-CN/README.md version summary row');
  assert.strictEqual(match[1], expectedVersion);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
