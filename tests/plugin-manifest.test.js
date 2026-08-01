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

test('claude plugin.json exposes only supported durable hook preferences', () => {
  assert.deepStrictEqual(
    Object.keys(claudePlugin.userConfig || {}).sort(),
    ['hook_profile', 'hooks_enabled']
  );

  const hooksEnabled = claudePlugin.userConfig.hooks_enabled;
  assert.deepStrictEqual(
    Object.keys(hooksEnabled).sort(),
    ['default', 'description', 'title', 'type']
  );
  assert.strictEqual(hooksEnabled.type, 'boolean');
  assert.strictEqual(hooksEnabled.default, true);
  assert.ok(typeof hooksEnabled.title === 'string' && hooksEnabled.title.trim());
  assert.ok(typeof hooksEnabled.description === 'string' && hooksEnabled.description.trim());

  const hookProfile = claudePlugin.userConfig.hook_profile;
  assert.deepStrictEqual(
    Object.keys(hookProfile).sort(),
    ['default', 'description', 'title', 'type'],
    'Claude userConfig does not support enum'
  );
  assert.strictEqual(hookProfile.type, 'string');
  assert.strictEqual(hookProfile.default, 'standard');
  assert.ok(typeof hookProfile.title === 'string' && hookProfile.title.trim());
  assert.ok(typeof hookProfile.description === 'string' && hookProfile.description.trim());
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

test('codex plugin.json explicitly declares the supported lifecycle hook bundle', () => {
  assert.strictEqual(
    codexPlugin.hooks,
    './hooks/codex-hooks.json',
    'Codex supports a top-level hooks path; keep the ECC hook bundle explicit instead of inventing provider-specific settings'
  );
  const hooksPath = path.join(repoRoot, codexPlugin.hooks.replace(/^\.\//, ''));
  assert.ok(fs.existsSync(hooksPath), `Codex hooks file missing at plugin root: ${codexPlugin.hooks}`);
});

test('codex lifecycle hook bundle contains only Codex 0.146-supported schema', () => {
  const hooksPath = path.join(repoRoot, 'hooks', 'codex-hooks.json');
  const config = loadJsonObject(hooksPath, 'hooks/codex-hooks.json');
  assert.deepStrictEqual(Object.keys(config).sort(), ['description', 'hooks'], 'Codex rejects Claude\'s top-level $schema field');

  const supportedEvents = new Set([
    'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact',
    'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop',
    'UserPromptSubmit', 'Stop'
  ]);
  assert.deepStrictEqual(
    Object.keys(config.hooks || {}),
    ['SessionStart'],
    'Only the verified, non-blocking SessionStart hook ships natively; Claude hook profiles are not Codex hook profiles'
  );
  assert.deepStrictEqual(
    config.hooks.SessionStart.map(group => group.id),
    ['session:start'],
    'Do not ship Claude handlers that surface hook failures in Codex'
  );

  for (const [event, groups] of Object.entries(config.hooks || {})) {
    assert.ok(supportedEvents.has(event), `Unsupported Codex hook event: ${event}`);
    assert.ok(Array.isArray(groups) && groups.length > 0, `Expected non-empty matcher groups for ${event}`);
    for (const group of groups) {
      assert.ok(Array.isArray(group.hooks) && group.hooks.length > 0, `Expected non-empty handlers for ${event}`);
      for (const handler of group.hooks) {
        assert.strictEqual(handler.type, 'command', `Codex 0.146 only executes command handlers (${event})`);
        assert.ok(!Object.prototype.hasOwnProperty.call(handler, 'async'), `Codex 0.146 skips async handlers (${event})`);
        assert.ok(
          handler.command.includes('process.env.CLAUDE_PLUGIN_ROOT=process.env.PLUGIN_ROOT'),
          `Codex plugin hooks must pin Claude-compatible bootstrap resolution to Codex PLUGIN_ROOT (${event})`
        );
        if (event === 'SessionEnd' && Number.isFinite(handler.timeout)) {
          assert.ok(handler.timeout <= 3, 'Codex clamps SessionEnd timeouts to 3 seconds');
        }
      }
    }
  }

  const claudeConfig = loadJsonObject(path.join(repoRoot, 'hooks', 'hooks.json'), 'hooks/hooks.json');
  const sourceSessionStart = claudeConfig.hooks.SessionStart.find(group => group.id === 'session:start');
  const expectedSessionStart = {
    ...sourceSessionStart,
    hooks: sourceSessionStart.hooks.map(handler => ({
      ...handler,
      command: handler.command.replace(
        'node -e "',
        'node -e "if(!process.env.PLUGIN_ROOT)throw new Error(\'Missing Codex PLUGIN_ROOT\');process.env.CLAUDE_PLUGIN_ROOT=process.env.PLUGIN_ROOT;'
      )
    }))
  };
  assert.deepStrictEqual(config.hooks.SessionStart[0], expectedSessionStart, 'Codex SessionStart hook must track its canonical implementation with a Codex-root bootstrap');
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

test('marketplace local plugin source is a self-contained native Codex bundle', () => {
  // Codex 0.146.0 accepts the marketplace root as a plugin source and copies
  // that source into its install cache. Parent-relative references from a thin
  // subdirectory are broken after that copy, so every bundled path must remain
  // inside the selected source root.
  for (const plugin of marketplace.plugins) {
    if (!plugin.source || plugin.source.source !== 'local') {
      continue;
    }

    assert.ok(plugin.source.path.startsWith('./'), `Codex marketplace source.path must be ./-prefixed: ${plugin.source.path}`);
    const sourceRoot = path.resolve(repoRoot, plugin.source.path);
    assert.strictEqual(sourceRoot, repoRoot, `ECC's native Codex bundle must use the self-contained repository root, got: ${plugin.source.path}`);

    const manifest = loadJsonObject(path.join(sourceRoot, '.codex-plugin', 'plugin.json'), 'marketplace Codex plugin manifest');
    for (const field of ['skills', 'mcpServers', 'hooks']) {
      assert.strictEqual(typeof manifest[field], 'string', `Expected Codex manifest ${field} path`);
      const target = path.resolve(sourceRoot, manifest[field]);
      assert.ok(target === sourceRoot || target.startsWith(sourceRoot + path.sep), `${field} escapes the installed source root: ${manifest[field]}`);
      assert.ok(fs.existsSync(target), `${field} target is missing from the installed source root: ${manifest[field]}`);
    }

    assert.ok(fs.existsSync(path.join(sourceRoot, 'scripts', 'hooks', 'plugin-hook-bootstrap.js')), 'Codex hook runtime must ship inside the installed source root');
    assert.ok(fs.existsSync(path.join(sourceRoot, 'skills', 'configure-ecc', 'SKILL.md')), 'Codex configure-ecc skill must ship inside the installed source root');
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

test('plugins/ecc README marks the thin folder as a legacy compatibility artifact', () => {
  const readmePath = path.join(repoRoot, 'plugins', 'ecc', 'README.md');
  assert.ok(fs.existsSync(readmePath), 'Expected plugins/ecc/README.md');
  const source = fs.readFileSync(readmePath, 'utf8');
  assert.ok(source.includes('legacy compatibility artifact'));
  assert.ok(source.includes('repository root'));
  assert.ok(source.includes('check-plugin-cache.js'), 'plugins/ecc README must point at the cache health check');
  assert.ok(!source.includes('points at this directory'));
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
  assert.ok(readme.includes('codex plugin add ecc@ecc'), 'Expected .codex-plugin README to document the current Codex install command');
  assert.ok(readme.includes('codex plugin list --json'), 'Expected .codex-plugin README to document a machine-checkable verification command');
  assert.ok(readme.includes('safe to run again'), 'Expected .codex-plugin README to explain idempotent marketplace and plugin registration');
  assert.ok(/does not\s+use Claude's `user`, `project`, or `local` install scopes/.test(readme), 'Expected .codex-plugin README to distinguish Codex plugin state from Claude scopes');
  assert.ok(readme.includes('review and trust'), 'Expected .codex-plugin README to explain Codex hook trust');
  assert.ok(readme.includes('legacy managed sync'), 'Expected .codex-plugin README to distinguish native plugins from the legacy managed sync');
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
