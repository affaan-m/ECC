/**
 * Carrier materialization: copy operations, the staged tree, its
 * verification, the atomic swap, and the receipt.
 *
 * Generation never writes into the target directory. The tree is built in a
 * dot-prefixed staging directory beside the target, verified, and swapped in;
 * an existing target is parked until the swap succeeds and restored if it
 * fails.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  CATALOG_SKILL_ID,
  ON_DEMAND_DIR,
  PLUGIN_NAME_PATTERN,
  PROFILE_METADATA_FILE,
  PROFILE_GENERATOR_ID,
  RECEIPT_SCHEMA_VERSION,
} = require('./constants');
const {
  sha256,
  readJson,
  resolveModuleCandidate,
  listChildDirectories,
  listFilesRecursive,
  findSymlinksUnder,
  flattenLine,
} = require('./fs-utils');
const { parseFrontmatter } = require('./frontmatter');
const { extractRequireSpecifiers } = require('./require-graph');
const { catalogSkillFrontmatter, measureContextLedger } = require('./ledger');
const { collectBlockers } = require('./plan');

/**
 * Read {id, name, description, sha256} for every skill in the source catalog.
 *
 * @param {string} repoRoot Absolute repository root.
 * @returns {Array<{id: string, name: string, description: string, sha256: string}>}
 */
function readCatalogEntries(repoRoot) {
  const entries = [];
  for (const skillId of listChildDirectories(path.join(repoRoot, 'skills'))) {
    const skillPath = path.join(repoRoot, 'skills', skillId, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const source = fs.readFileSync(skillPath);
    const { name, description } = parseFrontmatter(source.toString('utf8'));
    entries.push({ id: skillId, name: name || skillId, description, sha256: sha256(source) });
  }
  return entries;
}

/**
 * Digest of the exact context surface: every installed skill, agent, and
 * command with the hash of its file.
 *
 * @param {object} plan Resolved plan.
 * @returns {string} sha256 hex digest.
 */
function computeContextDigest(plan) {
  const { repoRoot } = plan;
  const lines = [];
  for (const skillId of plan.skills) {
    lines.push(`skill:${skillId}:${sha256(fs.readFileSync(path.join(repoRoot, 'skills', skillId, 'SKILL.md')))}`);
  }
  for (const agentFile of plan.agents) {
    lines.push(`agent:${agentFile}:${sha256(fs.readFileSync(path.join(repoRoot, 'agents', agentFile)))}`);
  }
  for (const commandFile of plan.commands) {
    lines.push(`command:${commandFile}:${sha256(fs.readFileSync(path.join(repoRoot, 'commands', commandFile)))}`);
  }
  return sha256(lines.sort().join('\n'));
}

/**
 * Digest of a generated tree: every file path and content hash, excluding
 * the receipt itself so the receipt can carry the digest.
 *
 * @param {string} pluginRoot Directory to digest.
 * @returns {string} sha256 hex digest.
 */
function computeTreeDigest(pluginRoot) {
  const lines = [];
  for (const relPath of listFilesRecursive(pluginRoot)) {
    if (relPath === PROFILE_METADATA_FILE) {
      continue;
    }
    lines.push(`${relPath}:${sha256(fs.readFileSync(path.join(pluginRoot, ...relPath.split('/'))))}`);
  }
  return sha256(lines.join('\n'));
}

/**
 * Write the `ecc-catalog` skill into a carrier. Rows point at content
 * inside the carrier only; no source-tree path is written.
 *
 * @param {object} plan Resolved plan.
 * @param {string} pluginRoot Destination plugin directory.
 * @param {Array<object>} catalogRows Catalog rows with carrier-relative paths.
 * @returns {number} Number of rows written.
 */
function writeCatalogSkill(plan, pluginRoot, catalogRows) {
  const rows = catalogRows.map(row => {
    const description = flattenLine(row.description);
    const summary = description.length > 140 ? `${description.slice(0, 137)}...` : description;
    return `| ${row.id} | ${row.installed ? 'installed' : 'on demand'} | ${summary.replace(/\|/g, '\\|')} | \`${row.path}\` |`;
  });

  const { name, description } = catalogSkillFrontmatter();
  const body = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    '# ECC Skill Catalog',
    '',
    `This plugin is a slim ECC profile carrier (\`${plan.profileId || 'custom'}\`, ecc@${plan.version}).`,
    'Installed skills are listed by Claude Code as usual. Skills marked "on demand"',
    `are copies carried inside this plugin under \`${ON_DEMAND_DIR}/\`; each path below is`,
    'relative to this plugin\'s root (`${CLAUDE_PLUGIN_ROOT}`). Read the file when the',
    'task needs that skill. Nothing outside this plugin is referenced.',
    '',
    '| Skill | Status | Description | Path |',
    '|---|---|---|---|',
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
 * @param {object} plan Resolved plan.
 * @param {{hasSkills: boolean, hasCommands: boolean}} shape Which keys apply.
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
    ...(rootPlugin.license ? { license: rootPlugin.license } : {}),
    mcpServers: {},
    ...(hasSkills ? { skills: ['./skills/'] } : {}),
    ...(hasCommands ? { commands: ['./commands/'] } : {}),
  };
}

/**
 * Read a carrier's receipt, or null when absent or unparseable.
 *
 * @param {string} pluginRoot Plugin directory.
 * @returns {object|null} Parsed receipt.
 */
function readProfileReceipt(pluginRoot) {
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(pluginRoot, PROFILE_METADATA_FILE), 'utf8'));
    return receipt && typeof receipt === 'object' ? receipt : null;
  } catch {
    return null;
  }
}

/**
 * True when a directory is output this generator previously wrote and has
 * not been modified since: the receipt must name this generator AND its
 * recorded tree digest must match the directory's current contents. A
 * copied-in marker file alone does not make a directory replaceable.
 *
 * @param {string} pluginRoot Candidate plugin directory.
 * @returns {boolean} Whether the directory is safe to replace.
 */
function isGeneratedProfilePlugin(pluginRoot) {
  const receipt = readProfileReceipt(pluginRoot);
  if (!receipt || receipt.generatedFrom !== PROFILE_GENERATOR_ID || typeof receipt.treeDigest !== 'string') {
    return false;
  }
  try {
    return computeTreeDigest(pluginRoot) === receipt.treeDigest;
  } catch {
    return false;
  }
}

/**
 * Resolve and bound the output location for a plan.
 *
 * @param {object} plan Resolved plan.
 * @param {string} outRoot Marketplace root.
 * @returns {{outRoot: string, pluginRoot: string}} Absolute paths.
 */
function resolveOutputPaths(plan, outRoot) {
  if (!plan || typeof plan.pluginName !== 'string' || !PLUGIN_NAME_PATTERN.test(plan.pluginName)) {
    throw new Error(`Invalid plugin name "${plan && plan.pluginName}"; expected lowercase letters, digits, and hyphens`);
  }
  if (!outRoot) {
    throw new Error('generateProfilePlugin requires outRoot');
  }
  const resolvedOut = path.resolve(outRoot);
  const pluginRoot = path.resolve(resolvedOut, plan.pluginName);
  if (!pluginRoot.startsWith(resolvedOut + path.sep)) {
    throw new Error(`Refusing to write outside ${resolvedOut}: ${pluginRoot}`);
  }
  return { outRoot: resolvedOut, pluginRoot };
}

/**
 * Enumerate every copy operation a plan implies, as {source, destination}
 * pairs relative to repoRoot and the plugin root. Shared by generation and
 * dry-run preview so the preview is exact.
 *
 * @param {object} plan Resolved plan.
 * @param {object} options Options.
 * @param {boolean} options.includeCatalogSkill Copy on-demand skills.
 * @param {Array<object>} options.catalogEntries Full catalog.
 * @returns {Array<{source: string, destination: string}>} Copy operations.
 */
function collectCopyOperations(plan, { includeCatalogSkill, catalogEntries }) {
  const operations = [];
  const installed = new Set(plan.skills);
  for (const skillId of plan.skills) {
    operations.push({ source: `skills/${skillId}`, destination: `skills/${skillId}` });
  }
  for (const agentFile of plan.agents) {
    operations.push({ source: `agents/${agentFile}`, destination: `agents/${agentFile}` });
  }
  for (const commandFile of plan.commands) {
    operations.push({ source: `commands/${commandFile}`, destination: `commands/${commandFile}` });
  }
  for (const runtimePath of plan.runtimePaths) {
    operations.push({ source: runtimePath, destination: runtimePath });
  }
  if (includeCatalogSkill) {
    for (const entry of catalogEntries) {
      if (!installed.has(entry.id)) {
        operations.push({ source: `skills/${entry.id}`, destination: `${ON_DEMAND_DIR}/${entry.id}` });
      }
    }
  }
  return operations;
}

/**
 * Verify a staged tree is internally resolvable: every relative require in
 * every copied script must resolve inside the staged tree. This is the
 * fail-closed check that catches a command whose dependency closure was
 * incomplete before anything is swapped into place.
 *
 * @param {string} stagedRoot Staged plugin directory.
 * @returns {Array<{from: string, specifier: string}>} Unresolved requires.
 */
function verifyStagedRuntime(stagedRoot) {
  const unresolved = [];
  for (const relPath of listFilesRecursive(stagedRoot)) {
    if (!relPath.endsWith('.js')) {
      continue;
    }
    const absPath = path.join(stagedRoot, ...relPath.split('/'));
    const { specifiers } = extractRequireSpecifiers(fs.readFileSync(absPath, 'utf8'));
    for (const specifier of specifiers) {
      const target = path.resolve(path.dirname(absPath), specifier);
      if (!target.startsWith(path.resolve(stagedRoot) + path.sep) || !resolveModuleCandidate(target)) {
        unresolved.push({ from: relPath, specifier });
      }
    }
  }
  return unresolved;
}

/**
 * Run every staged-tree verification and throw on the first failure.
 *
 * @param {string} stagingRoot Staged plugin directory.
 * @returns {void}
 */
function verifyStagedCarrier(stagingRoot) {
  const unresolved = verifyStagedRuntime(stagingRoot);
  if (unresolved.length > 0) {
    throw new Error('Staged carrier failed runtime verification; unresolved requires:\n'
      + unresolved.map(item => `  ${item.from} -> ${item.specifier}`).join('\n'));
  }
}

/**
 * Describe what `generate` would do without writing anything.
 *
 * @param {object} [options] Same options as generateProfilePlugin.
 * @returns {object} Preview: paths, operations, deletion, ledger, blockers.
 */
function previewProfilePlugin(options = {}) {
  const { plan } = options;
  const { outRoot, pluginRoot } = resolveOutputPaths(plan, options.outRoot);
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const catalogEntries = includeCatalogSkill ? readCatalogEntries(plan.repoRoot) : [];
  const operations = collectCopyOperations(plan, { includeCatalogSkill, catalogEntries });
  const symlinkPaths = operations
    .flatMap(operation => findSymlinksUnder(path.join(plan.repoRoot, ...operation.source.split('/'))))
    .sort();
  const ledger = measureContextLedger(plan, { includeCatalogSkill, measurer: options.measurer, budget: options.budget });
  const existing = fs.existsSync(pluginRoot);
  const existingReceipt = existing ? readProfileReceipt(pluginRoot) : null;
  const existingIsGenerated = existing && isGeneratedProfilePlugin(pluginRoot);

  const blockers = collectBlockers({
    plan,
    symlinkPaths,
    ledger,
    pluginRoot,
    existing,
    existingIsGenerated,
    allowOverBudget: options.allowOverBudget,
    force: options.force,
  });

  return {
    outRoot,
    pluginRoot,
    operations,
    generatedFiles: [
      '.claude-plugin/plugin.json',
      PROFILE_METADATA_FILE,
      ...(includeCatalogSkill ? [`skills/${CATALOG_SKILL_ID}/SKILL.md`] : []),
      ...(plan.hooks.decision === 'enabled' ? ['ecc/setup.json'] : []),
    ],
    willReplace: existing,
    existingIsGenerated,
    existingReceipt: existingReceipt
      ? { treeDigest: existingReceipt.treeDigest || null, createdAt: existingReceipt.createdAt || null }
      : null,
    ledger,
    blockers,
  };
}

/**
 * Copy every planned source into the staging tree and write the files the
 * generator synthesizes: the catalog skill, the plugin manifest, and the
 * pinned hook profile.
 *
 * @param {object} plan Resolved plan.
 * @param {string} stagingRoot Staging directory (already created).
 * @param {object} context Operations, catalog entries, and catalog toggle.
 * @returns {{catalogRows: Array<object>, catalogSkillCount: number, manifest: object}}
 */
function buildStagingTree(plan, stagingRoot, { operations, catalogEntries, includeCatalogSkill }) {
  for (const operation of operations) {
    fs.cpSync(
      path.join(plan.repoRoot, ...operation.source.split('/')),
      path.join(stagingRoot, ...operation.destination.split('/')),
      { recursive: true }
    );
  }

  const installed = new Set(plan.skills);
  const catalogRows = catalogEntries.map(entry => ({
    id: entry.id,
    installed: installed.has(entry.id),
    description: entry.description,
    sha256: entry.sha256,
    path: installed.has(entry.id) ? `skills/${entry.id}/SKILL.md` : `${ON_DEMAND_DIR}/${entry.id}/SKILL.md`,
  }));
  const catalogSkillCount = includeCatalogSkill ? writeCatalogSkill(plan, stagingRoot, catalogRows) : 0;

  const manifest = buildPluginManifest(plan, {
    hasSkills: plan.skills.length > 0 || includeCatalogSkill,
    hasCommands: plan.commands.length > 0,
  });
  fs.mkdirSync(path.join(stagingRoot, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(stagingRoot, '.claude-plugin', 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (plan.hooks.decision === 'enabled') {
    // Pin the hook profile inside the carrier through the managed-config
    // fallback hook-flags.js already honours (env and plugin options still
    // take precedence, in that order).
    fs.mkdirSync(path.join(stagingRoot, 'ecc'), { recursive: true });
    fs.writeFileSync(
      path.join(stagingRoot, 'ecc', 'setup.json'),
      `${JSON.stringify({ hooks: { enabled: true, profile: plan.hooks.profile } }, null, 2)}\n`
    );
  }

  return { catalogRows, catalogSkillCount, manifest };
}

/**
 * Assemble the generation receipt. `treeDigest` is filled in by writeReceipt,
 * which is the only thing that knows the tree is final.
 *
 * @param {object} plan Resolved plan.
 * @param {object} context Ledger, catalog rows, and the replaced receipt.
 * @returns {object} Receipt with a null treeDigest.
 */
function buildReceipt(plan, { ledger, catalogRows, previousReceipt }) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    generatedFrom: PROFILE_GENERATOR_ID,
    generatorVersion: plan.version,
    eccVersion: plan.version,
    createdAt: new Date().toISOString(),
    pluginName: plan.pluginName,
    profileId: plan.profileId,
    version: plan.version,
    profileInput: plan.profileInput,
    selectedModuleIds: plan.selectedModuleIds,
    context: {
      skills: plan.skills,
      agents: plan.agents,
      commands: plan.commands,
      digest: computeContextDigest(plan),
    },
    capabilities: { hooks: plan.hooks },
    runtime: {
      paths: plan.runtimePaths,
      held: plan.heldRuntimePaths,
      closureEntries: plan.closure.entries,
      dynamicRequires: plan.closure.dynamic,
    },
    tokenLedger: ledger,
    catalog: catalogRows,
    treeDigest: null,
    previous: previousReceipt,
  };
}

/**
 * Digest the staged tree and write the receipt into it. The receipt is
 * excluded from its own digest, so it must be the last file written.
 *
 * @param {string} stagingRoot Staged plugin directory.
 * @param {object} receipt Receipt from buildReceipt.
 * @returns {object} The receipt, with treeDigest filled in.
 */
function writeReceipt(stagingRoot, receipt) {
  receipt.treeDigest = computeTreeDigest(stagingRoot);
  fs.writeFileSync(path.join(stagingRoot, PROFILE_METADATA_FILE), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

/**
 * Atomic swap: park the existing target, move staging in, then discard the
 * parked tree. If the move fails the parked tree is restored.
 *
 * @param {object} context Staging, target, and parking paths plus keepPrevious.
 * @returns {string|null} The parked tree's path when kept, else null.
 */
function swapIntoPlace({ stagingRoot, pluginRoot, previousRoot, keepPrevious }) {
  fs.rmSync(previousRoot, { recursive: true, force: true });
  if (fs.existsSync(pluginRoot)) {
    fs.renameSync(pluginRoot, previousRoot);
  }
  try {
    fs.renameSync(stagingRoot, pluginRoot);
  } catch (error) {
    if (fs.existsSync(previousRoot) && !fs.existsSync(pluginRoot)) {
      fs.renameSync(previousRoot, pluginRoot);
    }
    throw error;
  }
  if (!keepPrevious) {
    fs.rmSync(previousRoot, { recursive: true, force: true });
    return null;
  }
  return fs.existsSync(previousRoot) ? previousRoot : null;
}

/**
 * Assemble the value generateProfilePlugin returns.
 *
 * @param {object} plan Resolved plan.
 * @param {object} context Paths, staged tree, receipt, and ledger.
 * @returns {object} Generation result.
 */
function buildGenerationResult(plan, context) {
  const { pluginRoot, previousRoot, staged, receipt, ledger, includeCatalogSkill } = context;
  return {
    pluginRoot,
    previousRoot,
    manifest: staged.manifest,
    receipt,
    ledger,
    catalogSkillCount: staged.catalogSkillCount,
    estimatedCatalogTokens: ledger.tokens,
    counts: {
      skills: plan.skills.length + (includeCatalogSkill ? 1 : 0),
      agents: plan.agents.length,
      commands: plan.commands.length,
      runtimePaths: plan.runtimePaths.length,
      onDemandSkills: staged.catalogRows.filter(row => !row.installed).length,
    },
  };
}

/**
 * Materialize a resolved plan as a plugin directory under outRoot.
 *
 * Refuses when the hook decision is pending, when the runtime closure is
 * unresolved, when the ledger exceeds its budget (unless allowOverBudget),
 * or when the target is not an unmodified generated plugin (unless force).
 *
 * @param {object} options Generation options.
 * @param {object} options.plan Resolved plan from resolvePluginProfilePlan().
 * @param {string} options.outRoot Marketplace root to write into.
 * @param {boolean} [options.includeCatalogSkill=true] Emit the catalog skill and on-demand copies.
 * @param {boolean} [options.force=false] Replace a non-generated directory.
 * @param {boolean} [options.allowOverBudget=false] Proceed past the budget gate.
 * @param {boolean} [options.keepPrevious=false] Keep the replaced tree beside the target.
 * @param {object} [options.measurer] Token measurer override.
 * @param {number} [options.budget] Budget override.
 * @returns {object} Generation result including pluginRoot, receipt, and ledger.
 */
function generateProfilePlugin(options = {}) {
  const { plan } = options;
  if (!plan || !plan.pluginName) {
    throw new Error('generateProfilePlugin requires a resolved plan');
  }
  const preview = previewProfilePlugin(options);
  if (preview.blockers.length > 0) {
    throw new Error(preview.blockers.join('\n\n'));
  }

  const { outRoot, pluginRoot, ledger } = preview;
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const stagingRoot = path.join(outRoot, `.staging-${plan.pluginName}-${process.pid}`);
  const previousRoot = path.join(outRoot, `.prev-${plan.pluginName}-${process.pid}`);

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  const state = { swapped: false };
  try {
    return stageVerifyAndSwap(plan, {
      preview, options, ledger, includeCatalogSkill, stagingRoot, previousRoot, pluginRoot, state,
    });
  } finally {
    if (!state.swapped) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Build the staged tree, verify it, receipt it, and swap it into place.
 *
 * `state.swapped` is the caller's cleanup signal: until the swap succeeds the
 * staging directory is the caller's to remove, and after it succeeds the
 * directory no longer exists under that name.
 *
 * @param {object} plan Resolved plan.
 * @param {object} context Preview, options, and the resolved paths.
 * @returns {object} Generation result.
 */
function stageVerifyAndSwap(plan, context) {
  const { preview, options, ledger, includeCatalogSkill, stagingRoot, previousRoot, pluginRoot, state } = context;
  const catalogEntries = includeCatalogSkill ? readCatalogEntries(plan.repoRoot) : [];

  const staged = buildStagingTree(plan, stagingRoot, {
    operations: preview.operations,
    catalogEntries,
    includeCatalogSkill,
  });
  verifyStagedCarrier(stagingRoot);

  const receipt = writeReceipt(stagingRoot, buildReceipt(plan, {
    ledger,
    catalogRows: staged.catalogRows,
    previousReceipt: preview.existingReceipt,
  }));

  const keptPreviousRoot = swapIntoPlace({
    stagingRoot,
    pluginRoot,
    previousRoot,
    keepPrevious: Boolean(options.keepPrevious),
  });
  state.swapped = true;

  return buildGenerationResult(plan, {
    pluginRoot, previousRoot: keptPreviousRoot, staged, receipt, ledger, includeCatalogSkill,
  });
}

module.exports = {
  readCatalogEntries,
  computeContextDigest,
  computeTreeDigest,
  writeCatalogSkill,
  buildPluginManifest,
  readProfileReceipt,
  isGeneratedProfilePlugin,
  resolveOutputPaths,
  collectCopyOperations,
  verifyStagedRuntime,
  verifyStagedCarrier,
  buildStagingTree,
  buildReceipt,
  writeReceipt,
  swapIntoPlace,
  previewProfilePlugin,
  generateProfilePlugin,
};
