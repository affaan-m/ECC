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
const PROFILE_METADATA_FILE = 'ecc-profile.json';

// Commands whose Markdown ships via the `commands` module path but whose
// backing code lives outside it. Without these, a profile that carries the
// command file gets a slash command that fails on first use — the `minimal`
// and `opencode` profiles omit `hooks-runtime` (and with it `scripts/lib`)
// entirely. Runtime paths add zero session context, so shipping the
// dependency closure is cheap; the alternative is a broken command.
//
// `script` entry points have their transitive require() graph resolved at
// generation time rather than listed by hand — a hardcoded list silently
// rots the first time someone adds a require to the chain. `data` paths are
// non-code inputs the CLI reads at runtime.
const COMMAND_RUNTIME_CLOSURE = {
  'plugin-profiles.md': {
    scripts: ['scripts/plugin-profiles.js'],
    data: ['manifests'],
  },
};

const RELATIVE_REQUIRE_PATTERN = /require\(\s*['"](\.[^'"]*)['"]\s*\)/g;

/**
 * Walk the transitive require() graph of one or more entry scripts.
 *
 * Only relative specifiers are followed — bare specifiers are Node builtins
 * or npm packages, neither of which lives in the repo tree. Resolution
 * mirrors CommonJS: exact path, then `.js`, then `/index.js`. Anything that
 * escapes repoRoot or fails to resolve is skipped rather than thrown on, so
 * a generation never dies over one unresolvable dynamic require.
 *
 * @param {Array<string>} entryPaths Repo-relative entry scripts.
 * @param {string} repoRoot Absolute repository root.
 * @returns {Array<string>} Sorted repo-relative paths of every reachable file.
 */
function resolveScriptClosure(entryPaths, repoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  const seen = new Set();
  const queue = [];

  const toRelative = absPath => toPosix(path.relative(resolvedRoot, absPath));
  const resolveCandidate = absPath => {
    for (const candidate of [absPath, `${absPath}.js`, path.join(absPath, 'index.js')]) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // try the next candidate shape
      }
    }
    return null;
  };

  for (const entryPath of entryPaths) {
    const resolved = resolveCandidate(path.join(resolvedRoot, ...entryPath.split('/')));
    if (resolved) {
      queue.push(resolved);
    }
  }

  while (queue.length > 0) {
    const current = queue.pop();
    const relative = toRelative(current);
    if (seen.has(relative) || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    seen.add(relative);

    let source;
    try {
      source = fs.readFileSync(current, 'utf8');
    } catch {
      continue;
    }

    RELATIVE_REQUIRE_PATTERN.lastIndex = 0;
    let match = RELATIVE_REQUIRE_PATTERN.exec(source);
    while (match !== null) {
      const next = resolveCandidate(path.resolve(path.dirname(current), match[1]));
      if (next) {
        queue.push(next);
      }
      match = RELATIVE_REQUIRE_PATTERN.exec(source);
    }
  }

  return [...seen].sort();
}

/**
 * Read and parse a JSON file, reporting the logical name on failure.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @param {string} label Human-readable name used in the error message.
 * @returns {object} Parsed JSON.
 * @throws {Error} When the file cannot be read or parsed.
 */
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

/**
 * Read a `description:` out of YAML frontmatter without a YAML dependency.
 *
 * Handles the three shapes that actually occur across the catalog: an inline
 * scalar, a quoted scalar, and a block scalar (`>`, `>-`, `|`, `|-`, and the
 * `+` keep variants) whose text lives on the following indented lines. The
 * block form matters — 16 catalog skills use `>-`, and reading only the
 * first line yields the literal indicator instead of the description, which
 * silently makes those skills unroutable.
 *
 * @param {string} source Full file contents.
 * @returns {{raw: string, description: string}} Frontmatter block and description.
 */
function parseFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) {
    return { raw: '', description: '' };
  }

  const lines = match[1].split(/\r?\n/);
  const startIndex = lines.findIndex(line => /^description:/.test(line));
  if (startIndex === -1) {
    return { raw: match[0], description: '' };
  }

  const inline = lines[startIndex].slice('description:'.length).trim();
  const blockScalar = /^([>|])([-+]?)$/.exec(inline);
  if (!blockScalar) {
    return { raw: match[0], description: inline.replace(/^["']|["']$/g, '') };
  }

  // Block scalar: consume the following lines that are indented deeper than
  // the key, stopping at the next top-level key. Folded (`>`) joins on
  // spaces with blank lines as paragraph breaks; literal (`|`) keeps them.
  const isFolded = blockScalar[1] === '>';
  const body = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    body.push(line.trim());
  }

  while (body.length > 0 && body[body.length - 1] === '') {
    body.pop();
  }

  let description = '';
  for (const line of body) {
    if (line === '') {
      description += '\n';
    } else if (description === '' || description.endsWith('\n')) {
      description += line;
    } else {
      description += isFolded ? ` ${line}` : `\n${line}`;
    }
  }

  return { raw: match[0], description: description.trim() };
}

/**
 * Approximate token count for a block of frontmatter (~4 chars per token).
 *
 * @param {string} text Text to measure.
 * @returns {number} Estimated tokens.
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Normalize a filesystem path to forward slashes.
 *
 * @param {string} relPath Path in platform-native form.
 * @returns {string} Path with POSIX separators.
 */
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

/**
 * List immediate child directory names.
 *
 * @param {string} rootDir Directory to scan.
 * @returns {Array<string>} Sorted names, empty when the directory is absent.
 */
function listChildDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * List Markdown file names directly inside a directory.
 *
 * @param {string} rootDir Directory to scan.
 * @returns {Array<string>} Sorted `.md` file names, empty when absent.
 */
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

  // Pull in the backing code for any shipped command that needs it, so a
  // generated profile never carries a slash command it cannot run.
  for (const commandFile of commandFiles) {
    const closure = COMMAND_RUNTIME_CLOSURE[commandFile];
    if (!closure) {
      continue;
    }
    const depPaths = [
      ...resolveScriptClosure(closure.scripts || [], repoRoot),
      ...(closure.data || []),
    ];
    for (const depPath of depPaths) {
      // Already covered when the path itself, or a parent directory of it,
      // is being copied (e.g. `scripts/lib` subsumes `scripts/lib/*.js`).
      const covered = [...runtimePaths].some(
        existing => existing === depPath || depPath.startsWith(`${existing}/`)
      );
      if (covered) {
        continue;
      }
      if (fs.existsSync(path.join(repoRoot, ...depPath.split('/')))) {
        runtimePaths.add(depPath);
      } else {
        warnings.push(`Command ${commandFile}: missing runtime dependency ${depPath}`);
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
/**
 * Read {id, description} for every skill in the source catalog. Consumed by
 * the catalog skill, and embedded in ecc-profile.json so the skill-router
 * hook never has to re-scan the source tree at prompt time.
 */
function readCatalogEntries(repoRoot) {
  const entries = [];
  for (const skillId of listChildDirectories(path.join(repoRoot, 'skills'))) {
    const skillPath = path.join(repoRoot, 'skills', skillId, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const { description } = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
    entries.push({ id: skillId, description });
  }
  return entries;
}

/**
 * Write the `ecc-catalog` escape-hatch skill into a generated plugin.
 *
 * One cheap frontmatter entry whose body indexes the FULL upstream catalog,
 * so a slim profile never loses access to a skill — it loads on demand from
 * the recorded source root instead of being installed.
 *
 * @param {object} plan Resolved plugin plan.
 * @param {string} pluginRoot Destination plugin directory.
 * @param {Array<{id: string, description: string}>} catalogEntries Full catalog.
 * @returns {number} Number of catalog rows written.
 */
function writeCatalogSkill(plan, pluginRoot, catalogEntries) {
  const installed = new Set(plan.skills);
  const rows = [];

  for (const { id: skillId, description } of catalogEntries) {
    const summary = description.length > 140 ? `${description.slice(0, 137)}...` : description;
    const status = installed.has(skillId) ? 'installed' : 'on demand';
    rows.push(`| ${skillId} | ${status} | ${summary.replace(/\|/g, '\\|')} |`);
  }

  const sourceRoot = toPosix(plan.repoRoot);
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

/**
 * Build the `.claude-plugin/plugin.json` document for a generated plugin.
 *
 * @param {object} plan Resolved plugin plan.
 * @param {object} surfaces Which optional surfaces exist on disk.
 * @param {boolean} surfaces.hasSkills Declare a `skills` directory.
 * @param {boolean} surfaces.hasCommands Declare a `commands` directory.
 * @returns {object} Plugin manifest.
 */
function buildPluginManifest(plan, { hasSkills, hasCommands }) {
  const rootPluginPath = path.join(plan.repoRoot, '.claude-plugin', 'plugin.json');
  const rootPlugin = fs.existsSync(rootPluginPath)
    ? readJson(rootPluginPath, '.claude-plugin/plugin.json')
    : {};

  // Claude Code's plugin validator rejects `agents` and v2.1+ auto-loads
  // hooks/hooks.json, so neither field may appear here (see
  // tests/plugin-manifest.test.js). mcpServers stays explicitly empty so a
  // root .mcp.json copy is never auto-bundled, and skills/commands are only
  // declared when the corresponding directory actually exists on disk.
  return {
    name: plan.pluginName,
    version: plan.version,
    description: `ECC profile plugin "${plan.profileId || 'custom'}" generated from ecc@${plan.version} - `
      + `${plan.skills.length} skills, ${plan.agents.length} agents, ${plan.commands.length} commands. `
      + 'The full skill catalog stays available on demand via the ecc-catalog skill.',
    author: rootPlugin.author,
    homepage: rootPlugin.homepage,
    repository: rootPlugin.repository,
    ...(rootPlugin.license ? { license: rootPlugin.license } : {}),
    mcpServers: {},
    ...(hasSkills ? { skills: ['./skills/'] } : {}),
    ...(hasCommands ? { commands: ['./commands/'] } : {}),
  };
}

/**
 * True when a directory looks like output this generator previously wrote.
 *
 * Regeneration deletes the target tree, so it must first prove the target is
 * a generated profile plugin and not a directory the user happens to own.
 * The `ecc-profile.json` marker is written by every generated plugin and by
 * nothing else, which makes it a reliable ownership signal.
 *
 * @param {string} pluginRoot Candidate plugin directory.
 * @returns {boolean} Whether the directory is safe to replace.
 */
function isGeneratedProfilePlugin(pluginRoot) {
  try {
    const metadata = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, PROFILE_METADATA_FILE), 'utf8')
    );
    return metadata && metadata.generatedFrom === 'everything-claude-code';
  } catch {
    return false;
  }
}

/**
 * Materialize a resolved plan as a plugin directory under outRoot.
 *
 * A previously generated plugin of the same name is replaced. Any other
 * existing directory is refused unless `force` is set, so a stray
 * `--name`/`--out` combination cannot silently delete unrelated files.
 *
 * @param {object} options Generation options.
 * @param {object} options.plan Resolved plan from resolvePluginProfilePlan().
 * @param {string} options.outRoot Marketplace root to write into.
 * @param {boolean} [options.includeCatalogSkill=true] Emit the ecc-catalog skill.
 * @param {boolean} [options.force=false] Replace a non-generated directory.
 * @returns {object} Generation result including pluginRoot and manifest.
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

  if (fs.existsSync(pluginRoot) && !options.force && !isGeneratedProfilePlugin(pluginRoot)) {
    throw new Error(
      `Refusing to overwrite ${pluginRoot}: it is not a generated profile plugin `
      + `(no ${PROFILE_METADATA_FILE} marker). Choose another --name/--out, or pass --force to replace it.`
    );
  }

  fs.rmSync(pluginRoot, { recursive: true, force: true });
  fs.mkdirSync(pluginRoot, { recursive: true });

  for (const skillId of plan.skills) {
    fs.cpSync(path.join(repoRoot, 'skills', skillId), path.join(pluginRoot, 'skills', skillId), { recursive: true });
  }
  if (plan.agents.length > 0) {
    fs.mkdirSync(path.join(pluginRoot, 'agents'), { recursive: true });
  }
  for (const agentFile of plan.agents) {
    fs.cpSync(path.join(repoRoot, 'agents', agentFile), path.join(pluginRoot, 'agents', agentFile));
  }
  if (plan.commands.length > 0) {
    fs.mkdirSync(path.join(pluginRoot, 'commands'), { recursive: true });
  }
  for (const commandFile of plan.commands) {
    fs.cpSync(path.join(repoRoot, 'commands', commandFile), path.join(pluginRoot, 'commands', commandFile));
  }
  for (const runtimePath of plan.runtimePaths) {
    fs.cpSync(
      path.join(repoRoot, ...runtimePath.split('/')),
      path.join(pluginRoot, ...runtimePath.split('/')),
      { recursive: true }
    );
  }

  const catalogEntries = readCatalogEntries(repoRoot);
  const catalogSkillCount = includeCatalogSkill ? writeCatalogSkill(plan, pluginRoot, catalogEntries) : 0;

  const manifest = buildPluginManifest(plan, {
    hasSkills: plan.skills.length > 0 || includeCatalogSkill,
    hasCommands: plan.commands.length > 0,
  });
  fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  // Router metadata: the skill-router hook reads this to route prompts over
  // the FULL source catalog even when only this slim profile is enabled. The
  // catalog snapshot is embedded so routing never re-scans the source tree
  // at prompt time; sourceRoot is machine-local, so generated plugins must
  // be regenerated rather than copied between machines.
  fs.writeFileSync(
    path.join(pluginRoot, PROFILE_METADATA_FILE),
    `${JSON.stringify({
      generatedFrom: 'everything-claude-code',
      profileId: plan.profileId,
      version: plan.version,
      sourceRoot: toPosix(path.resolve(repoRoot)),
      catalog: catalogEntries,
    }, null, 2)}\n`
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
  const marketplaceName = options.marketplaceName || DEFAULT_MARKETPLACE_NAME;

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
      ...(manifest.license ? { license: manifest.license } : {}),
      category: 'workflow',
    });
  }

  // Deliberately generic owner: these plugins are generated locally, so the
  // marketplace must not claim upstream ECC maintainers as its publisher.
  const marketplace = {
    name: marketplaceName,
    owner: { name: 'Generated locally by ecc plugin-profiles' },
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
  PROFILE_METADATA_FILE,
  COMMAND_RUNTIME_CLOSURE,
  resolveScriptClosure,
  isGeneratedProfilePlugin,
  classifyModulePath,
  parseFrontmatter,
  estimateTokens,
  estimatePlanCatalogTokens,
  resolvePluginProfilePlan,
  generateProfilePlugin,
  writeMarketplaceManifest,
};
