/**
 * Profile plugin generation for the Claude Code plugin surface.
 *
 * The marketplace plugin path loads the frontmatter of every skill and
 * command into session context (~23k tokens for the full catalog), and it
 * ignores the selective-install manifests entirely — profiles only serve
 * installer targets today. This library closes that gap: it materializes any
 * install plan (profile, modules, or component selection) as a standalone
 * slim plugin directory that a project can enable instead of the full `ecc`
 * plugin, cutting per-session catalog cost while keeping hook runtime parity
 * and on-demand access to the full skill catalog via a generated index skill.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_REPO_ROOT, resolveInstallPlan } = require('./install-manifests');

const CATALOG_SKILL_ID = 'ecc-catalog';
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_MARKETPLACE_NAME = 'ecc-profiles';

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) {
    return { raw: '', description: '' };
  }
  const descriptionMatch = /^description:\s*(.+)$/m.exec(match[1]);
  const description = descriptionMatch
    ? descriptionMatch[1].trim().replace(/^["']|["']$/g, '')
    : '';
  return { raw: match[0], description };
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function toPosix(relPath) {
  return String(relPath).split(path.sep).join('/');
}

/**
 * Classify one install-module path into the plugin surface it feeds.
 * Runtime paths (hooks + scripts) cost zero session context but preserve
 * hook and command-script parity, so they are copied verbatim.
 */
function classifyModulePath(rawPath) {
  const relPath = toPosix(rawPath).replace(/\/+$/, '');
  if (relPath === 'skills' || relPath.startsWith('skills/')) {
    return { surface: 'skills', relPath };
  }
  if (relPath === 'agents' || relPath.startsWith('agents/')) {
    return { surface: 'agents', relPath };
  }
  if (relPath === 'commands' || relPath.startsWith('commands/')) {
    return { surface: 'commands', relPath };
  }
  if (relPath === 'hooks' || relPath.startsWith('hooks/') || relPath.startsWith('scripts/')) {
    return { surface: 'runtime', relPath };
  }
  return { surface: 'skipped', relPath };
}

function listChildDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function listMarkdownFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort();
}

/**
 * Resolve an install selection into a concrete plugin surface plan.
 *
 * Options mirror resolveInstallPlan: profileId, moduleIds,
 * includeComponentIds, excludeComponentIds — plus pluginName and
 * includeHooks (default true).
 */
function resolvePluginProfilePlan(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const includeHooks = options.includeHooks !== false;
  const installPlan = resolveInstallPlan({
    repoRoot,
    profileId: options.profileId || null,
    moduleIds: options.moduleIds || [],
    includeComponentIds: options.includeComponentIds || [],
    excludeComponentIds: options.excludeComponentIds || [],
  });

  const defaultName = `ecc-${installPlan.profileId || 'custom'}`;
  const pluginName = options.pluginName || defaultName;
  if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new Error(`Invalid plugin name "${pluginName}"; expected lowercase letters, digits, and hyphens`);
  }

  const skillDirs = new Set();
  const agentFiles = new Set();
  const commandFiles = new Set();
  const runtimePaths = new Set();
  const skippedPaths = new Set();
  const warnings = [];

  for (const module of installPlan.selectedModules) {
    for (const rawPath of module.paths || []) {
      const { surface, relPath } = classifyModulePath(rawPath);

      if (surface === 'skipped') {
        skippedPaths.add(relPath);
        continue;
      }

      if (surface === 'runtime') {
        if (!includeHooks && (relPath === 'hooks' || relPath === 'scripts/hooks')) {
          skippedPaths.add(relPath);
          continue;
        }
        if (fs.existsSync(path.join(repoRoot, relPath))) {
          runtimePaths.add(relPath);
        } else {
          warnings.push(`Module ${module.id}: missing runtime path ${relPath}`);
        }
        continue;
      }

      if (surface === 'skills') {
        if (relPath === 'skills') {
          listChildDirectories(path.join(repoRoot, 'skills')).forEach(name => skillDirs.add(name));
        } else {
          const skillId = relPath.slice('skills/'.length).split('/')[0];
          if (fs.existsSync(path.join(repoRoot, 'skills', skillId, 'SKILL.md'))) {
            skillDirs.add(skillId);
          } else {
            warnings.push(`Module ${module.id}: missing skill ${skillId}`);
          }
        }
        continue;
      }

      if (surface === 'agents') {
        if (relPath === 'agents') {
          listMarkdownFiles(path.join(repoRoot, 'agents')).forEach(name => agentFiles.add(name));
        } else {
          const fileName = relPath.slice('agents/'.length);
          if (fs.existsSync(path.join(repoRoot, 'agents', fileName))) {
            agentFiles.add(fileName);
          } else {
            warnings.push(`Module ${module.id}: missing agent ${fileName}`);
          }
        }
        continue;
      }

      if (relPath === 'commands') {
        listMarkdownFiles(path.join(repoRoot, 'commands')).forEach(name => commandFiles.add(name));
      } else {
        const fileName = relPath.slice('commands/'.length);
        if (fs.existsSync(path.join(repoRoot, 'commands', fileName))) {
          commandFiles.add(fileName);
        } else {
          warnings.push(`Module ${module.id}: missing command ${fileName}`);
        }
      }
    }
  }

  const rootPackage = readJson(path.join(repoRoot, 'package.json'), 'package.json');

  return {
    repoRoot,
    pluginName,
    profileId: installPlan.profileId,
    version: rootPackage.version,
    selectedModuleIds: installPlan.selectedModuleIds,
    skills: [...skillDirs].sort(),
    agents: [...agentFiles].sort(),
    commands: [...commandFiles].sort(),
    runtimePaths: [...runtimePaths].sort(),
    skippedPaths: [...skippedPaths].sort(),
    warnings,
  };
}

/**
 * Sum frontmatter tokens for a plan's skills, agents, and commands — the
 * portion of the plugin that Claude Code injects into every session.
 */
function estimatePlanCatalogTokens(plan) {
  const { repoRoot } = plan;
  let total = 0;

  for (const skillId of plan.skills) {
    const skillPath = path.join(repoRoot, 'skills', skillId, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      total += estimateTokens(parseFrontmatter(fs.readFileSync(skillPath, 'utf8')).raw);
    }
  }
  for (const agentFile of plan.agents) {
    const agentPath = path.join(repoRoot, 'agents', agentFile);
    if (fs.existsSync(agentPath)) {
      total += estimateTokens(parseFrontmatter(fs.readFileSync(agentPath, 'utf8')).raw);
    }
  }
  for (const commandFile of plan.commands) {
    const commandPath = path.join(repoRoot, 'commands', commandFile);
    if (fs.existsSync(commandPath)) {
      total += estimateTokens(parseFrontmatter(fs.readFileSync(commandPath, 'utf8')).raw);
    }
  }

  return total;
}

/**
 * Write the generated ecc-catalog escape-hatch skill: a cheap frontmatter
 * entry whose body indexes the FULL upstream skill catalog, so a slim
 * profile never loses access to a skill — it loads on demand instead.
 */
function writeCatalogSkill(plan, pluginRoot) {
  const { repoRoot } = plan;
  const installed = new Set(plan.skills);
  const rows = [];

  for (const skillId of listChildDirectories(path.join(repoRoot, 'skills'))) {
    const skillPath = path.join(repoRoot, 'skills', skillId, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const { description } = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
    const summary = description.length > 140 ? `${description.slice(0, 137)}...` : description;
    const status = installed.has(skillId) ? 'installed' : 'on demand';
    rows.push(`| ${skillId} | ${status} | ${summary.replace(/\|/g, '\\|')} |`);
  }

  const sourceRoot = toPosix(repoRoot);
  const body = [
    '---',
    `name: ${CATALOG_SKILL_ID}`,
    'description: Index of the full ECC skill catalog for this slim profile plugin. Use when a task needs an ECC skill that is not installed in this profile - find it in the table, then Read its SKILL.md from the listed source root and follow it.',
    '---',
    '',
    '# ECC Full Skill Catalog',
    '',
    `This plugin is a slim ECC profile (\`${plan.profileId || 'custom'}\`). The full catalog below stays available on demand.`,
    '',
    `**Source root:** \`${sourceRoot}\``,
    '',
    'To use a skill marked "on demand", read its definition from',
    `\`${sourceRoot}/skills/<skill-id>/SKILL.md\` and follow it as if it were installed.`,
    '',
    '| Skill | Status | Description |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  const catalogDir = path.join(pluginRoot, 'skills', CATALOG_SKILL_ID);
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(path.join(catalogDir, 'SKILL.md'), body);
  return rows.length;
}

function buildPluginManifest(plan) {
  const rootPluginPath = path.join(plan.repoRoot, '.claude-plugin', 'plugin.json');
  const rootPlugin = fs.existsSync(rootPluginPath)
    ? readJson(rootPluginPath, '.claude-plugin/plugin.json')
    : {};

  // Claude Code's plugin validator rejects `agents` and v2.1+ auto-loads
  // hooks/hooks.json, so neither field may appear here (see
  // tests/plugin-manifest.test.js). mcpServers stays explicitly empty so a
  // root .mcp.json copy is never auto-bundled.
  return {
    name: plan.pluginName,
    version: plan.version,
    description: `ECC profile plugin "${plan.profileId || 'custom'}" generated from ecc@${plan.version} - `
      + `${plan.skills.length} skills, ${plan.agents.length} agents, ${plan.commands.length} commands. `
      + 'The full skill catalog stays available on demand via the ecc-catalog skill.',
    author: rootPlugin.author,
    homepage: rootPlugin.homepage,
    repository: rootPlugin.repository,
    license: rootPlugin.license || 'MIT',
    mcpServers: {},
    skills: ['./skills/'],
    commands: ['./commands/'],
  };
}

/**
 * Materialize a resolved plan as a plugin directory under outRoot.
 * Existing content for the same plugin name is replaced.
 */
function generateProfilePlugin(options = {}) {
  const plan = options.plan;
  if (!plan || !plan.pluginName) {
    throw new Error('generateProfilePlugin requires a resolved plan');
  }
  const outRoot = options.outRoot;
  if (!outRoot) {
    throw new Error('generateProfilePlugin requires outRoot');
  }
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const { repoRoot } = plan;
  const pluginRoot = path.join(outRoot, plan.pluginName);

  fs.rmSync(pluginRoot, { recursive: true, force: true });
  fs.mkdirSync(pluginRoot, { recursive: true });

  for (const skillId of plan.skills) {
    fs.cpSync(path.join(repoRoot, 'skills', skillId), path.join(pluginRoot, 'skills', skillId), { recursive: true });
  }
  for (const agentFile of plan.agents) {
    fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
    fs.cpSync(path.join(repoRoot, 'agents', agentFile), path.join(pluginRoot, 'agents', agentFile));
  }
  for (const commandFile of plan.commands) {
    fs.mkdirSync(path.join(pluginRoot, 'commands'), { recursive: true });
    fs.cpSync(path.join(repoRoot, 'commands', commandFile), path.join(pluginRoot, 'commands', commandFile));
  }
  for (const runtimePath of plan.runtimePaths) {
    fs.cpSync(
      path.join(repoRoot, ...runtimePath.split('/')),
      path.join(pluginRoot, ...runtimePath.split('/')),
      { recursive: true }
    );
  }

  const catalogSkillCount = includeCatalogSkill ? writeCatalogSkill(plan, pluginRoot) : 0;

  const manifest = buildPluginManifest(plan);
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  return {
    pluginRoot,
    manifest,
    catalogSkillCount,
    estimatedCatalogTokens: estimatePlanCatalogTokens(plan),
    counts: {
      skills: plan.skills.length + (includeCatalogSkill ? 1 : 0),
      agents: plan.agents.length,
      commands: plan.commands.length,
      runtimePaths: plan.runtimePaths.length,
    },
  };
}

/**
 * Scan outRoot for generated plugin directories and (re)write the local
 * marketplace manifest so `claude plugin marketplace add <outRoot>` serves
 * every generated profile.
 */
function writeMarketplaceManifest(options = {}) {
  const outRoot = options.outRoot;
  if (!outRoot) {
    throw new Error('writeMarketplaceManifest requires outRoot');
  }
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const marketplaceName = options.marketplaceName || DEFAULT_MARKETPLACE_NAME;

  const rootMarketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
  const owner = fs.existsSync(rootMarketplacePath)
    ? readJson(rootMarketplacePath, '.claude-plugin/marketplace.json').owner
    : undefined;

  const plugins = [];
  for (const dirName of listChildDirectories(outRoot)) {
    const manifestPath = path.join(outRoot, dirName, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const manifest = readJson(manifestPath, `${dirName}/.claude-plugin/plugin.json`);
    plugins.push({
      name: manifest.name,
      source: `./${dirName}`,
      description: manifest.description,
      version: manifest.version,
      license: manifest.license,
      category: 'workflow',
    });
  }

  const marketplace = {
    name: marketplaceName,
    ...(owner ? { owner } : {}),
    metadata: {
      description: 'Generated ECC profile plugins - slim per-project alternatives to the full ecc plugin',
    },
    plugins,
  };

  const manifestDir = path.join(outRoot, '.claude-plugin');
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'marketplace.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(marketplace, null, 2)}\n`);

  return { manifestPath, marketplace };
}

module.exports = {
  CATALOG_SKILL_ID,
  DEFAULT_MARKETPLACE_NAME,
  classifyModulePath,
  parseFrontmatter,
  estimateTokens,
  estimatePlanCatalogTokens,
  resolvePluginProfilePlan,
  generateProfilePlugin,
  writeMarketplaceManifest,
};
